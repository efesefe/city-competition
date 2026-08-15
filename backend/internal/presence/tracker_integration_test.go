package presence_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/presence"
	"github.com/city-competition-remastered/backend/internal/realtime"
)

type memMemberships map[uuid.UUID]*uuid.UUID

func (m memMemberships) TribeID(_ context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	return m[userID], nil
}

func startMiniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return mr, rdb
}

func waitCount(t *testing.T, tracker *presence.Tracker, want int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		n, err := tracker.OnlineCount(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	n, _ := tracker.OnlineCount(context.Background())
	t.Fatalf("online count=%d want %d", n, want)
}

func TestDroppedConnectionAgesOutWithoutCleanup(t *testing.T) {
	mr, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	tribeID := uuid.New()
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatalf("session: %v", err)
	}

	ttl := 2 * time.Second
	tracker := &presence.Tracker{
		RDB:         rdb,
		TTL:         ttl,
		Memberships: memMemberships{userID: &tribeID},
	}
	hub := realtime.NewHub(rdb, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	h := &realtime.Handler{Hub: hub, Sessions: sessions, Presence: tracker}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	wsURL := "ws" + srv.URL[len("http"):] + "/v1/ws/map?token=" + token
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	waitCount(t, tracker, 1)
	if !mr.Exists(presence.UserKey(userID)) {
		t.Fatal("expected TTL key while connected")
	}

	// Drop the TCP connection without a WebSocket close handshake.
	if err := conn.CloseNow(); err != nil {
		t.Fatalf("CloseNow: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() > 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() != 0 {
		t.Fatalf("hub still has %d clients after drop", hub.ClientCount())
	}

	// Unregister must not DEL the presence key; TTL is the cleanup mechanism.
	if !mr.Exists(presence.UserKey(userID)) {
		t.Fatal("TTL key was deleted on unclean close; expected it to remain until expiry")
	}

	mr.FastForward(ttl + time.Second)

	n, err := tracker.OnlineCount(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("count after TTL=%d want 0", n)
	}
	members, err := tracker.OnlineMembers(context.Background(), tribeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 0 {
		t.Fatalf("tribe members after TTL=%v want empty", members)
	}
}

func TestPingRefreshesTTL(t *testing.T) {
	mr, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatalf("session: %v", err)
	}

	ttl := 2 * time.Second
	tracker := &presence.Tracker{RDB: rdb, TTL: ttl}
	hub := realtime.NewHub(rdb, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	h := &realtime.Handler{Hub: hub, Sessions: sessions, Presence: tracker}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	wsURL := "ws" + srv.URL[len("http"):] + "/v1/ws/map?token=" + token
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.CloseNow()

	waitCount(t, tracker, 1)

	mr.FastForward(ttl / 2)
	if err := conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatalf("ping: %v", err)
	}
	time.Sleep(50 * time.Millisecond)

	mr.FastForward(ttl/2 + 200*time.Millisecond)
	n, err := tracker.OnlineCount(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("count after ping refresh=%d want 1", n)
	}
}

func TestHTTP_OnlineCountUnauthorized(t *testing.T) {
	_, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	tracker := &presence.Tracker{RDB: rdb, TTL: time.Minute}
	handler := &presence.Handler{Tracker: tracker}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/presence/online-count", auth.RequireSession(sessions, nil, http.HandlerFunc(handler.OnlineCount)))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/v1/presence/online-count")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", res.StatusCode)
	}
}

func TestHTTP_OnlineCountAndTribeMembersConsistent(t *testing.T) {
	_, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	tribeA, tribeB := uuid.New(), uuid.New()
	userA, userB, userNone := uuid.New(), uuid.New(), uuid.New()
	memberships := memMemberships{
		userA:    &tribeA,
		userB:    &tribeB,
		userNone: nil,
	}
	tracker := &presence.Tracker{RDB: rdb, TTL: time.Minute, Memberships: memberships}
	handler := &presence.Handler{
		Tracker:     tracker,
		Memberships: memberships,
		TribeExists: func(_ context.Context, id uuid.UUID) (bool, error) {
			return id == tribeA || id == tribeB, nil
		},
	}

	ctx := context.Background()
	tracker.Heartbeat(ctx, userA)
	tracker.Heartbeat(ctx, userB)
	tracker.Heartbeat(ctx, userNone)

	mux := http.NewServeMux()
	mux.Handle("GET /v1/presence/online-count", auth.RequireSession(sessions, nil, http.HandlerFunc(handler.OnlineCount)))
	mux.Handle("GET /v1/tribes/{tribe_id}/online-members", auth.RequireSession(sessions, nil, http.HandlerFunc(handler.OnlineMembers)))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	tokenA, err := sessions.Create(ctx, userA)
	if err != nil {
		t.Fatal(err)
	}

	getJSON := func(path string, token string, dest any) int {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if dest != nil && res.StatusCode == http.StatusOK {
			if err := json.NewDecoder(res.Body).Decode(dest); err != nil {
				t.Fatal(err)
			}
		}
		return res.StatusCode
	}

	var countBody struct {
		ApproximateCount int64 `json:"approximate_count"`
	}
	if status := getJSON("/v1/presence/online-count", tokenA, &countBody); status != http.StatusOK {
		t.Fatalf("online-count status=%d", status)
	}
	if countBody.ApproximateCount != 3 {
		t.Fatalf("approximate_count=%d want 3", countBody.ApproximateCount)
	}

	var membersBody struct {
		UserIDs          []uuid.UUID `json:"user_ids"`
		ApproximateCount int         `json:"approximate_count"`
	}
	if status := getJSON("/v1/tribes/"+tribeA.String()+"/online-members", tokenA, &membersBody); status != http.StatusOK {
		t.Fatalf("online-members status=%d", status)
	}
	if membersBody.ApproximateCount != 1 || len(membersBody.UserIDs) != 1 || membersBody.UserIDs[0] != userA {
		t.Fatalf("tribe A members=%+v", membersBody)
	}
	for _, id := range membersBody.UserIDs {
		if rdb.Exists(ctx, presence.UserKey(id)).Val() != 1 {
			t.Fatalf("tribe member %s absent from global TTL keys", id)
		}
	}

	tokenB, err := sessions.Create(ctx, userB)
	if err != nil {
		t.Fatal(err)
	}
	if status := getJSON("/v1/tribes/"+tribeA.String()+"/online-members", tokenB, nil); status != http.StatusForbidden {
		t.Fatalf("other-tribe caller status=%d want 403", status)
	}

	if status := getJSON("/v1/tribes/"+uuid.New().String()+"/online-members", tokenA, nil); status != http.StatusNotFound {
		t.Fatalf("missing tribe status=%d want 404", status)
	}
	if status := getJSON("/v1/tribes/not-a-uuid/online-members", tokenA, nil); status != http.StatusBadRequest {
		t.Fatalf("bad uuid status=%d want 400", status)
	}
}
