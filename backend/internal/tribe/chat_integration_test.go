package tribe_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/realtime"
	"github.com/city-competition-remastered/backend/internal/tribe"
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

func seedUser(t *testing.T, pool *pgxpool.Pool, restricted bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1556" + id.String()[24:]
	username := "t" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, restricted_mode)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, restricted)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM messages WHERE sender_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func seedTribe(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	slug := "chat-" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color, is_active)
		VALUES ($1, $2, $3, $4, '#112233', '#445566', true)
	`, id, slug, "Chat Tribe "+slug, "CT")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM messages WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func joinTribe(t *testing.T, pool *pgxpool.Pool, userID, tribeID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		UPDATE users SET tribe_id = $2, tribe_switched_at = now() WHERE id = $1
	`, userID, tribeID)
	if err != nil {
		t.Fatalf("join: %v", err)
	}
}

type recordingBroadcaster struct {
	calls atomic.Int64
}

func (r *recordingBroadcaster) Publish(ctx context.Context, channel, payload string) error {
	r.calls.Add(1)
	return nil
}

type poolUsers struct {
	pool *pgxpool.Pool
}

func (p poolUsers) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	var restricted bool
	err := p.pool.QueryRow(ctx, `SELECT restricted_mode FROM users WHERE id = $1`, userID).Scan(&restricted)
	return restricted, err
}

func TestTribeChat_ProfanityFlaggedNotDelivered(t *testing.T) {
	pool := testPool(t)
	tribeID := seedTribe(t, pool)
	sender := seedUser(t, pool, false)
	peer := seedUser(t, pool, false)
	joinTribe(t, pool, sender, tribeID)
	joinTribe(t, pool, peer, tribeID)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	hub := realtime.NewHub(rdb, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	time.Sleep(50 * time.Millisecond)

	// Peer joins tribe room (simulates WS join).
	client := realtime.NewTestClient()
	hub.BindUser(client, peer)
	hub.JoinRoom(client, realtime.TribeChannel(tribeID))
	hub.Register(client)
	t.Cleanup(func() { hub.Unregister(client) })

	rec := &recordingBroadcaster{}
	h := &tribe.Handler{
		Store:       &tribe.PoolStore{Pool: pool},
		Broadcaster: rec,
	}

	msg, err := h.SendTribeMessage(context.Background(), sender, tribeID, "siktir buradan")
	if err != nil {
		t.Fatalf("SendTribeMessage: %v", err)
	}
	if !msg.Flagged {
		t.Fatal("expected flagged")
	}
	if rec.calls.Load() != 0 {
		t.Fatalf("broadcast calls=%d want 0", rec.calls.Load())
	}

	select {
	case got := <-client.Send:
		t.Fatalf("peer received flagged tribe message: %s", got)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestTribeChat_RestrictedRejectedPreWrite(t *testing.T) {
	pool := testPool(t)
	tribeID := seedTribe(t, pool)
	restricted := seedUser(t, pool, true)
	joinTribe(t, pool, restricted, tribeID)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), restricted)
	if err != nil {
		t.Fatal(err)
	}

	h := &tribe.Handler{
		Store:       &tribe.PoolStore{Pool: pool},
		Broadcaster: &recordingBroadcaster{},
	}
	users := poolUsers{pool: pool}
	mux := http.NewServeMux()
	mux.Handle("POST /v1/tribes/{id}/messages",
		auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(h.CreateTribeMessage))))

	body, _ := json.Marshal(map[string]string{"body": "selam kabile"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tribes/"+tribeID.String()+"/messages", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &errBody)
	if errBody["error"] != "error_restricted_mode" {
		t.Fatalf("error=%q", errBody["error"])
	}

	var count int
	err = pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM messages WHERE tribe_id = $1 AND sender_id = $2
	`, tribeID, restricted).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected pre-write rejection, got %d rows", count)
	}
}
