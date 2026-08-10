package erasure_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/erasure"
	"github.com/city-competition-remastered/backend/internal/httpserver"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/migrate"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1666" + id.String()[24:]
	username := "e" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, email)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, id.String()+"@example.test")
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM analytics_deletion_events WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM erasure_jobs WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM consent_events WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestErasureJob_RemovesCreditsAndTombstonesUser(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO credit_accounts (user_id, balance) VALUES ($1, 25)
	`, userID)
	if err != nil {
		t.Fatalf("seed credits: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO credit_ledger (user_id, delta, balance_after, reason, idempotency_key)
		VALUES ($1, 25, 25, 'stub_grant', $2)
	`, userID, "erase-seed-"+userID.String())
	if err != nil {
		t.Fatalf("seed ledger: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO consent_events (user_id, consent_type, consent_version, granted, ip_address, user_agent)
		VALUES ($1, 'aydinlatma_metni', 'v1', true, '127.0.0.1', 'test-agent')
	`, userID)
	if err != nil {
		t.Fatalf("seed consent: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	_ = rdb.Set(ctx, "ratelimit:"+userID.String()+":support-spend", "1", time.Minute)

	store := &erasure.Store{Pool: pool}
	job, err := store.Enqueue(ctx, userID, "req-erase-int")
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	worker := &erasure.Worker{
		Store:         store,
		RDB:           rdb,
		Sessions:      sessions,
		ObjectStorage: erasure.StubObjectStorage{},
		Logger:        logging.New("worker-erasure", false),
	}
	ok, err := worker.ProcessOnce(ctx)
	if err != nil || !ok {
		t.Fatalf("process once ok=%v err=%v", ok, err)
	}

	got, err := store.Get(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != erasure.StatusCompleted {
		t.Fatalf("status=%s last_error=%v steps=%v", got.Status, got.LastError, got.CompletedSteps)
	}
	if got.RequestID != "req-erase-int" {
		t.Fatalf("request_id=%q", got.RequestID)
	}

	var creditN int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM credit_accounts WHERE user_id = $1`, userID).Scan(&creditN)
	if creditN != 0 {
		t.Fatalf("credit_accounts remaining=%d", creditN)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger WHERE user_id = $1`, userID).Scan(&creditN)
	if creditN != 0 {
		t.Fatalf("credit_ledger remaining=%d", creditN)
	}

	var phone *string
	var email *string
	var status string
	var ua *string
	err = pool.QueryRow(ctx, `SELECT phone, email, status FROM users WHERE id = $1`, userID).Scan(&phone, &email, &status)
	if err != nil {
		t.Fatal(err)
	}
	if phone != nil || email != nil || status != "erased" {
		t.Fatalf("user tombstone phone=%v email=%v status=%s", phone, email, status)
	}
	_ = pool.QueryRow(ctx, `
		SELECT user_agent FROM consent_events WHERE user_id = $1 LIMIT 1
	`, userID).Scan(&ua)
	if ua != nil {
		t.Fatalf("consent user_agent still set: %v", ua)
	}

	if mr.Exists("session:" + token) {
		t.Fatal("session should be revoked")
	}
	if mr.Exists("ratelimit:" + userID.String() + ":support-spend") {
		t.Fatal("ratelimit key should be deleted")
	}

	var evtReq string
	err = pool.QueryRow(ctx, `
		SELECT request_id FROM analytics_deletion_events WHERE job_id = $1
	`, job.ID).Scan(&evtReq)
	if err != nil {
		t.Fatalf("analytics event: %v", err)
	}
	if evtReq != "req-erase-int" {
		t.Fatalf("analytics request_id=%q", evtReq)
	}
}

func TestErasureRequest_HTTP_PropagatesRequestID(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	store := &erasure.Store{Pool: pool}
	h := &erasure.Handler{Store: store}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/account/erasure-request", func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.ContextWithUserID(r.Context(), userID)
		h.Request(w, r.WithContext(ctx))
	})
	handler := httpserver.RequestID(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/account/erasure-request", nil)
	req.Header.Set("X-Request-ID", "trace-erasure-42")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["request_id"] != "trace-erasure-42" {
		t.Fatalf("body=%v", body)
	}

	jobID, err := uuid.Parse(body["job_id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.Get(context.Background(), jobID)
	if err != nil {
		t.Fatal(err)
	}
	if job.RequestID != "trace-erasure-42" {
		t.Fatalf("stored request_id=%q", job.RequestID)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM analytics_deletion_events WHERE job_id = $1`, jobID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM erasure_jobs WHERE id = $1`, jobID)
	})
}
