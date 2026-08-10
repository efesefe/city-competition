package social_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/social"
)

type failBroadcaster struct {
	calls atomic.Int64
}

func (f *failBroadcaster) Publish(ctx context.Context, channel, payload string) error {
	f.calls.Add(1)
	return errors.New("broadcast unavailable")
}

type recordingBroadcaster struct {
	calls atomic.Int64
}

func (r *recordingBroadcaster) Publish(ctx context.Context, channel, payload string) error {
	r.calls.Add(1)
	return nil
}

type alwaysUnrestricted struct{}

func (alwaysUnrestricted) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	return false, nil
}

func cleanupMessages(t *testing.T, pool *pgxpool.Pool, userIDs ...uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		for _, id := range userIDs {
			_, _ = pool.Exec(context.Background(), `DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1`, id)
		}
	})
}

func TestDM_PersistsWhenBroadcastFails(t *testing.T) {
	pool := testPool(t)
	from := seedUser(t, pool)
	to := seedUser(t, pool)
	cleanupMessages(t, pool, from, to)

	fail := &failBroadcaster{}
	h := &social.Handler{
		Store:       &social.PoolStore{Pool: pool},
		Users:       alwaysUnrestricted{},
		Broadcaster: fail,
	}

	msg, err := h.SendDM(context.Background(), from, to, "merhaba dostum")
	if err != nil {
		t.Fatalf("SendDM: %v", err)
	}
	if msg.ID == uuid.Nil {
		t.Fatal("expected persisted message id")
	}
	if fail.calls.Load() < 1 {
		t.Fatal("expected broadcast attempt")
	}

	var count int
	err = pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM messages WHERE id = $1 AND flagged = false AND kind = 'dm'
	`, msg.ID).Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("message count=%d want 1", count)
	}
}

func TestDM_ProfanityFlaggedNotBroadcast(t *testing.T) {
	pool := testPool(t)
	from := seedUser(t, pool)
	to := seedUser(t, pool)
	cleanupMessages(t, pool, from, to)

	rec := &recordingBroadcaster{}
	h := &social.Handler{
		Store:       &social.PoolStore{Pool: pool},
		Users:       alwaysUnrestricted{},
		Broadcaster: rec,
	}

	msg, err := h.SendDM(context.Background(), from, to, "siktir git")
	if err != nil {
		t.Fatalf("SendDM: %v", err)
	}
	if !msg.Flagged {
		t.Fatal("expected flagged=true")
	}
	if rec.calls.Load() != 0 {
		t.Fatalf("broadcast calls=%d want 0", rec.calls.Load())
	}

	var flagged bool
	err = pool.QueryRow(context.Background(), `SELECT flagged FROM messages WHERE id = $1`, msg.ID).Scan(&flagged)
	if err != nil {
		t.Fatal(err)
	}
	if !flagged {
		t.Fatal("expected DB flagged=true")
	}
}

func TestDM_BlockedRejectedPreWrite(t *testing.T) {
	pool := testPool(t)
	from := seedUser(t, pool)
	to := seedUser(t, pool)
	cleanupMessages(t, pool, from, to)

	store := &social.PoolStore{Pool: pool}
	if _, err := store.Block(context.Background(), to, from); err != nil {
		t.Fatal(err)
	}

	h := &social.Handler{
		Store:       store,
		Users:       alwaysUnrestricted{},
		Broadcaster: &recordingBroadcaster{},
	}
	_, err := h.SendDM(context.Background(), from, to, "selam")
	if !errors.Is(err, social.ErrBlocked) {
		t.Fatalf("err=%v want ErrBlocked", err)
	}
	var count int
	_ = pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM messages WHERE sender_id = $1 AND recipient_id = $2
	`, from, to).Scan(&count)
	if count != 0 {
		t.Fatalf("expected no write, got %d", count)
	}
}

func TestCreateDM_HTTP(t *testing.T) {
	pool := testPool(t)
	from := seedUser(t, pool)
	to := seedUser(t, pool)
	cleanupMessages(t, pool, from, to)

	_, sessions := newSocialMux(t, pool)

	fail := &failBroadcaster{}
	h := &social.Handler{
		Store:       &social.PoolStore{Pool: pool},
		Users:       alwaysUnrestricted{},
		Broadcaster: fail,
	}
	mux := http.NewServeMux()
	mux.Handle("POST /v1/dms", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateDM)))

	token, err := sessions.Create(context.Background(), from)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"user_id": to, "body": "selam"})
	req := httptest.NewRequest(http.MethodPost, "/v1/dms", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
