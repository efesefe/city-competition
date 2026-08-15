package support_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/support"
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

func seedBoundary(t *testing.T, pool *pgxpool.Pool, ilCode, nameTR, nameEN string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			$1, $2, $3,
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET
			name_tr = EXCLUDED.name_tr,
			name_en = EXCLUDED.name_en,
			geom = EXCLUDED.geom
	`, ilCode, nameTR, nameEN)
	if err != nil {
		t.Fatalf("seed boundary: %v", err)
	}
}

func seedTribe(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	slug := "t" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
		VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
	`, id, slug, "Tribe "+slug, "T")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID *uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, tribeID)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newSupportHandler(t *testing.T, pool *pgxpool.Pool) (*support.Handler, *auth.SessionService, redis.Cmdable) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	provinceStore := &geo.Store{Pool: pool}
	svc := &support.Service{
		Pool:      pool,
		Wallet:    &credits.Wallet{Pool: pool},
		Provinces: provinceStore,
		RDB:       rdb,
	}
	return &support.Handler{Service: svc}, sessions, rdb
}

func TestSupport_WithoutTribe_Returns409(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "34", "İstanbul", "Istanbul")
	userID := seedUser(t, pool, nil)
	h, sessions, _ := newSupportHandler(t, pool)
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Create)))

	body, _ := json.Marshal(map[string]any{"il_code": "34", "credits": 5})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d want 409 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != support.ErrTribeRequired.Error() {
		t.Fatalf("error=%q want tribe_required", errBody["error"])
	}
}

func TestSupport_InsufficientCredits_Returns402_NoRows(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "34", "İstanbul", "Istanbul")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)
	h, sessions, _ := newSupportHandler(t, pool)
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Create)))

	body, _ := json.Marshal(map[string]any{"il_code": "34", "credits": 5})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status=%d want 402 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != credits.ErrInsufficientCredits.Error() {
		t.Fatalf("error=%q want insufficient_credits", errBody["error"])
	}

	var count int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM supports WHERE user_id = $1
	`, userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("supports rows=%d want 0", count)
	}
}

func TestSupport_Success_DecrementsBalance_AndIncrementsScores(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "06", "Ankara", "Ankara")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)
	wallet := &credits.Wallet{Pool: pool}
	if _, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         100,
		Reason:         credits.ReasonStubGrant,
		IdempotencyKey: "grant-" + userID.String(),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}

	h, sessions, _ := newSupportHandler(t, pool)
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Create)))

	const spend int64 = 25
	body, _ := json.Marshal(map[string]any{"il_code": "06", "credits": spend})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}

	var result support.Result
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.CreditsSpent != spend {
		t.Fatalf("credits_spent=%d want %d", result.CreditsSpent, spend)
	}
	if result.EffectiveSupport != float64(spend) {
		t.Fatalf("effective_support=%v want %d", result.EffectiveSupport, spend)
	}
	if result.BalanceAfter != 100-spend {
		t.Fatalf("balance_after=%d want %d", result.BalanceAfter, 100-spend)
	}
	if result.CausedFlip {
		t.Fatal("caused_flip=true without a wired RecordFlip / logged flip")
	}

	bal, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 100-spend {
		t.Fatalf("stored balance=%d want %d", bal, 100-spend)
	}

	var scoreSum float64
	if err := pool.QueryRow(context.Background(), `
		SELECT effective_support_sum::float8
		FROM tribe_province_scores
		WHERE tribe_id = $1 AND il_code = '06'
	`, tribeID).Scan(&scoreSum); err != nil {
		t.Fatalf("score: %v", err)
	}
	if scoreSum != float64(spend) {
		t.Fatalf("effective_support_sum=%v want %d", scoreSum, spend)
	}
}
