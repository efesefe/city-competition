package social_test

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
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/social"
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
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_reports WHERE reporter_id = $1 OR reported_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_relations WHERE from_user_id = $1 OR to_user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newSocialMux(t *testing.T, pool *pgxpool.Pool) (*http.ServeMux, *auth.SessionService) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	h := &social.Handler{Store: &social.PoolStore{Pool: pool}}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/friends/requests", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateFriendRequest)))
	mux.Handle("GET /v1/friends/requests", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListFriendRequests)))
	mux.Handle("POST /v1/friends/requests/{id}/accept", auth.RequireSession(sessions, nil, http.HandlerFunc(h.AcceptFriendRequest)))
	mux.Handle("POST /v1/friends/requests/{id}/reject", auth.RequireSession(sessions, nil, http.HandlerFunc(h.RejectFriendRequest)))
	mux.Handle("DELETE /v1/friends/requests/{id}", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CancelFriendRequest)))
	mux.Handle("GET /v1/friends", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListFriends)))
	mux.Handle("DELETE /v1/friends/{user_id}", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Unfriend)))
	mux.Handle("POST /v1/blocks", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateBlock)))
	mux.Handle("GET /v1/blocks", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListBlocks)))
	mux.Handle("DELETE /v1/blocks/{user_id}", auth.RequireSession(sessions, nil, http.HandlerFunc(h.DeleteBlock)))
	mux.Handle("POST /v1/mutes", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateMute)))
	mux.Handle("GET /v1/mutes", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListMutes)))
	mux.Handle("DELETE /v1/mutes/{user_id}", auth.RequireSession(sessions, nil, http.HandlerFunc(h.DeleteMute)))
	mux.Handle("POST /v1/reports", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateReport)))
	return mux, sessions
}

func TestBlockedUserFriendRequest_RejectedPreInsert(t *testing.T) {
	pool := testPool(t)
	blocker := seedUser(t, pool)
	blocked := seedUser(t, pool)
	mux, sessions := newSocialMux(t, pool)

	blockerToken, err := sessions.Create(context.Background(), blocker)
	if err != nil {
		t.Fatal(err)
	}
	blockedToken, err := sessions.Create(context.Background(), blocked)
	if err != nil {
		t.Fatal(err)
	}

	blockBody, _ := json.Marshal(map[string]any{"user_id": blocked})
	blockReq := httptest.NewRequest(http.MethodPost, "/v1/blocks", bytes.NewReader(blockBody))
	blockReq.Header.Set("Authorization", "Bearer "+blockerToken)
	blockRec := httptest.NewRecorder()
	mux.ServeHTTP(blockRec, blockReq)
	if blockRec.Code != http.StatusCreated {
		t.Fatalf("block status=%d want 201 body=%s", blockRec.Code, blockRec.Body.String())
	}

	reqBody, _ := json.Marshal(map[string]any{"user_id": blocker})
	req := httptest.NewRequest(http.MethodPost, "/v1/friends/requests", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+blockedToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != social.ErrBlocked.Error() {
		t.Fatalf("error=%q want %q", errBody["error"], social.ErrBlocked.Error())
	}

	var count int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM user_relations
		WHERE type = 'friend_request'
		  AND (
		    (from_user_id = $1 AND to_user_id = $2)
		    OR (from_user_id = $2 AND to_user_id = $1)
		  )
	`, blocked, blocker).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("friend_request rows=%d want 0", count)
	}
}

func TestReport_DefaultsToPending(t *testing.T) {
	pool := testPool(t)
	reporter := seedUser(t, pool)
	reported := seedUser(t, pool)
	mux, sessions := newSocialMux(t, pool)

	token, err := sessions.Create(context.Background(), reporter)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"reported_id":  reported,
		"reason":       "harassment",
		"context_type": "profile",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/reports", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d want 201 body=%s", rec.Code, rec.Body.String())
	}

	var created social.Report
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Status != "pending" {
		t.Fatalf("response status=%q want pending", created.Status)
	}

	var status string
	if err := pool.QueryRow(context.Background(), `
		SELECT status FROM user_reports WHERE id = $1
	`, created.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("db status=%q want pending", status)
	}
}
