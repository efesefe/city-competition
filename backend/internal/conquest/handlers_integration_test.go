package conquest_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/conquest"
)

func TestConquestLogHTTP_ListUnreadAndMarkRead(t *testing.T) {
	pool := testPool(t)
	const il = "77"
	seedBoundary(t, pool, il, "Httil", "Httil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	reader := seedUser(t, pool, &tribeA)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 100)
	grantCredits(t, pool, userB, 100)

	store := &conquest.Store{Pool: pool}
	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, userA, il, 10); err != nil {
		t.Fatalf("flip 1: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 20); err != nil {
		t.Fatalf("flip 2: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}

	h := &conquest.Handler{Store: store}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/conquest-log", auth.RequireSession(sessions, nil, http.HandlerFunc(h.List)))
	mux.Handle("GET /v1/conquest-log/unread-count", auth.RequireSession(sessions, nil, http.HandlerFunc(h.UnreadCount)))
	mux.Handle("POST /v1/conquest-log/mark-read", auth.RequireSession(sessions, nil, http.HandlerFunc(h.MarkRead)))

	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}
	post := func(path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	listRec := get("/v1/conquest-log?limit=100")
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var listBody struct {
		Entries    []conquest.Entry `json:"entries"`
		NextOffset *int             `json:"next_offset"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listBody); err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, e := range listBody.Entries {
		if e.IlCode == il {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("list entries for %s=%d want 2 (total page=%d)", il, found, len(listBody.Entries))
	}

	unreadRec := get("/v1/conquest-log/unread-count")
	if unreadRec.Code != http.StatusOK {
		t.Fatalf("unread status=%d body=%s", unreadRec.Code, unreadRec.Body.String())
	}
	var unreadBody struct {
		UnreadCount int `json:"unread_count"`
	}
	if err := json.NewDecoder(unreadRec.Body).Decode(&unreadBody); err != nil {
		t.Fatal(err)
	}
	if unreadBody.UnreadCount < 2 {
		t.Fatalf("unread_count=%d want at least 2", unreadBody.UnreadCount)
	}

	markRec := post("/v1/conquest-log/mark-read", map[string]any{"all": true})
	if markRec.Code != http.StatusOK {
		t.Fatalf("mark-read status=%d body=%s", markRec.Code, markRec.Body.String())
	}
	unreadRec = get("/v1/conquest-log/unread-count")
	if err := json.NewDecoder(unreadRec.Body).Decode(&unreadBody); err != nil {
		t.Fatal(err)
	}
	if unreadBody.UnreadCount != 0 {
		t.Fatalf("unread after mark-all=%d want 0", unreadBody.UnreadCount)
	}

	if _, err := svc.Apply(ctx, userA, il, 30); err != nil {
		t.Fatalf("flip 3: %v", err)
	}
	unreadRec = get("/v1/conquest-log/unread-count")
	if err := json.NewDecoder(unreadRec.Body).Decode(&unreadBody); err != nil {
		t.Fatal(err)
	}
	if unreadBody.UnreadCount != 1 {
		t.Fatalf("unread after new flip=%d want 1", unreadBody.UnreadCount)
	}

	logs := listLogsAsc(t, pool, il)
	latest := logs[len(logs)-1]
	markRec = post("/v1/conquest-log/mark-read", map[string]any{"up_to_id": latest.ID.String()})
	if markRec.Code != http.StatusOK {
		t.Fatalf("mark up_to status=%d body=%s", markRec.Code, markRec.Body.String())
	}
	unreadRec = get("/v1/conquest-log/unread-count")
	if err := json.NewDecoder(unreadRec.Body).Decode(&unreadBody); err != nil {
		t.Fatal(err)
	}
	if unreadBody.UnreadCount != 0 {
		t.Fatalf("unread after up_to=%d want 0", unreadBody.UnreadCount)
	}
}

func TestConquestLogHTTP_Unauthorized(t *testing.T) {
	pool := testPool(t)
	h := &conquest.Handler{Store: &conquest.Store{Pool: pool}}
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/conquest-log", auth.RequireSession(sessions, nil, http.HandlerFunc(h.List)))
	req := httptest.NewRequest(http.MethodGet, "/v1/conquest-log", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}

func TestConquestLogHTTP_UnknownMarkReadID(t *testing.T) {
	pool := testPool(t)
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	h := &conquest.Handler{Store: &conquest.Store{Pool: pool}}
	mux := http.NewServeMux()
	mux.Handle("POST /v1/conquest-log/mark-read", auth.RequireSession(sessions, nil, http.HandlerFunc(h.MarkRead)))

	body, _ := json.Marshal(map[string]any{"up_to_id": uuid.New().String()})
	req := httptest.NewRequest(http.MethodPost, "/v1/conquest-log/mark-read", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404 body=%s", rec.Code, rec.Body.String())
	}
}
