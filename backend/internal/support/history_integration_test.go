package support_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/support"
)

func insertSupport(t *testing.T, pool *pgxpool.Pool, userID, tribeID uuid.UUID, ilCode string, credits int64, at time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO supports (
			id, user_id, tribe_id, il_code, credits_spent, multiplier,
			effective_support, created_at
		) VALUES ($1, $2, $3, $4, $5, 1, $6::numeric, $7)
	`, id, userID, tribeID, ilCode, credits, float64(credits), at)
	if err != nil {
		t.Fatalf("insert support: %v", err)
	}
	return id
}

func TestListMine_IgnoresClientUserID_CannotFetchOtherUser(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "34", "İstanbul", "Istanbul")
	tribeID := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeID)
	userB := seedUser(t, pool, &tribeID)

	now := time.Now().UTC()
	supportA := insertSupport(t, pool, userA, tribeID, "34", 10, now.Add(-time.Minute))
	supportB := insertSupport(t, pool, userB, tribeID, "34", 20, now)

	h, sessions, _ := newSupportHandler(t, pool)
	h.History = &support.HistoryStore{Pool: pool}
	tokenA, err := sessions.Create(context.Background(), userA)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/me/supports", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListMine)))

	// Tamper with user_id=B while authenticated as A — must still only return A's rows.
	req := httptest.NewRequest(
		http.MethodGet,
		"/v1/me/supports?user_id="+userB.String()+"&limit=50",
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+tokenA)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var body struct {
		Supports []support.SupportHistoryItem `json:"supports"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Supports) != 1 {
		t.Fatalf("len=%d want 1 (only user A)", len(body.Supports))
	}
	if body.Supports[0].ID != supportA {
		t.Fatalf("id=%s want %s", body.Supports[0].ID, supportA)
	}
	for _, item := range body.Supports {
		if item.ID == supportB {
			t.Fatalf("leaked user B support %s", supportB)
		}
	}
}

func TestListMine_NewestFirst_Paginated(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "06", "Ankara", "Ankara")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)

	now := time.Now().UTC()
	older := insertSupport(t, pool, userID, tribeID, "06", 5, now.Add(-2*time.Hour))
	newer := insertSupport(t, pool, userID, tribeID, "06", 8, now.Add(-time.Hour))

	h, sessions, _ := newSupportHandler(t, pool)
	h.History = &support.HistoryStore{Pool: pool}
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/me/supports", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListMine)))

	req := httptest.NewRequest(http.MethodGet, "/v1/me/supports?limit=1&offset=0", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var page1 struct {
		Supports   []support.SupportHistoryItem `json:"supports"`
		NextOffset *int                         `json:"next_offset"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&page1); err != nil {
		t.Fatal(err)
	}
	if len(page1.Supports) != 1 || page1.Supports[0].ID != newer {
		t.Fatalf("page1=%v want newer %s", page1.Supports, newer)
	}
	if page1.NextOffset == nil || *page1.NextOffset != 1 {
		t.Fatalf("next_offset=%v want 1", page1.NextOffset)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/v1/me/supports?limit=1&offset=1", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	var page2 struct {
		Supports []support.SupportHistoryItem `json:"supports"`
	}
	if err := json.NewDecoder(rec2.Body).Decode(&page2); err != nil {
		t.Fatal(err)
	}
	if len(page2.Supports) != 1 || page2.Supports[0].ID != older {
		t.Fatalf("page2=%v want older %s", page2.Supports, older)
	}
}
