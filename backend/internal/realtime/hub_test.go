package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/geo"
)

type fixedResolver struct {
	codes []string
	err   error
}

func (f fixedResolver) IlCodesIntersectingBBox(_ context.Context, _ geo.BBox) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return append([]string(nil), f.codes...), nil
}

type selectiveResolver struct {
	byBBox map[geo.BBox][]string
}

func (s selectiveResolver) IlCodesIntersectingBBox(_ context.Context, b geo.BBox) ([]string, error) {
	if codes, ok := s.byBBox[b]; ok {
		return append([]string(nil), codes...), nil
	}
	return []string{}, nil
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

func TestFanOut_OutsideViewportNotDelivered(t *testing.T) {
	_, rdb := startMiniRedis(t)
	hub := NewHub(rdb, fixedResolver{codes: []string{"34"}}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	client := newClient()
	hub.Register(client)
	defer hub.Unregister(client)

	if err := hub.SetViewport(ctx, client, geo.BBox{28, 40, 30, 42}); err != nil {
		t.Fatalf("viewport: %v", err)
	}
	if !client.InterestContains("34") {
		t.Fatal("expected interest in 34")
	}

	outside, _ := json.Marshal(redisPayload{TribeID: uuid.New(), Delta: 1})
	hub.DeliverForTest("06", outside)

	select {
	case msg := <-client.Send:
		t.Fatalf("unexpected delivery for outside viewport: %s", msg)
	case <-time.After(150 * time.Millisecond):
	}

	inside, _ := json.Marshal(redisPayload{TribeID: uuid.New(), Delta: 2.5})
	hub.DeliverForTest("34", inside)

	select {
	case msg := <-client.Send:
		var ev SupportAppliedEvent
		if err := json.Unmarshal(msg, &ev); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if ev.Type != "support_applied" || ev.IlCode != "34" || ev.Delta != 2.5 {
			t.Fatalf("unexpected event: %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("expected delivery for in-viewport province")
	}
}

func TestDisconnect_ClearsClientInterestWithin1s(t *testing.T) {
	_, rdb := startMiniRedis(t)
	hub := NewHub(rdb, fixedResolver{codes: []string{"34"}}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	client := newClient()
	hub.Register(client)
	if err := hub.SetViewport(ctx, client, geo.BBox{28, 40, 30, 42}); err != nil {
		t.Fatalf("viewport: %v", err)
	}
	if hub.ClientCount() != 1 {
		t.Fatalf("client count=%d", hub.ClientCount())
	}

	hub.Unregister(client)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if hub.ClientCount() == 0 && !hub.HasClient(client.ID) && len(client.InterestSnapshot()) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() != 0 {
		t.Fatalf("client still registered after disconnect: count=%d", hub.ClientCount())
	}
	if len(client.InterestSnapshot()) != 0 {
		t.Fatalf("interest not cleared: %v", client.InterestSnapshot())
	}

	// Publishing after disconnect must not panic or resurrect the client.
	payload, _ := json.Marshal(redisPayload{TribeID: uuid.New(), Delta: 1})
	hub.DeliverForTest("34", payload)
	if hub.ClientCount() != 0 {
		t.Fatal("unexpected client after deliver")
	}
}

func TestChatFanOut_TribeAndDM(t *testing.T) {
	_, rdb := startMiniRedis(t)
	hub := NewHub(rdb, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	time.Sleep(50 * time.Millisecond)

	userID := uuid.New()
	tribeID := uuid.New()
	client := newClient()
	hub.BindUser(client, userID)
	hub.JoinRoom(client, TribeChannel(tribeID))
	hub.Register(client)
	defer hub.Unregister(client)

	outsider := newClient()
	hub.Register(outsider)
	defer hub.Unregister(outsider)

	tribePayload := []byte(`{"type":"tribe_message","body":"selam"}`)
	if err := rdb.Publish(ctx, TribeChannel(tribeID), string(tribePayload)).Err(); err != nil {
		t.Fatalf("publish tribe: %v", err)
	}
	select {
	case msg := <-client.Send:
		if string(msg) != string(tribePayload) {
			t.Fatalf("tribe payload=%s", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for tribe fan-out")
	}
	select {
	case msg := <-outsider.Send:
		t.Fatalf("outsider got tribe message: %s", msg)
	case <-time.After(100 * time.Millisecond):
	}

	dmPayload := []byte(`{"type":"dm","body":"merhaba"}`)
	if err := rdb.Publish(ctx, DMChannel(userID), string(dmPayload)).Err(); err != nil {
		t.Fatalf("publish dm: %v", err)
	}
	select {
	case msg := <-client.Send:
		if string(msg) != string(dmPayload) {
			t.Fatalf("dm payload=%s", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for dm fan-out")
	}
}

func TestRedisPubSub_DeliversToInterestedClient(t *testing.T) {
	_, rdb := startMiniRedis(t)
	hub := NewHub(rdb, fixedResolver{codes: []string{"34"}}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	// Allow PSubscribe to attach.
	time.Sleep(50 * time.Millisecond)

	client := newClient()
	hub.Register(client)
	defer hub.Unregister(client)
	if err := hub.SetViewport(ctx, client, geo.BBox{28, 40, 30, 42}); err != nil {
		t.Fatalf("viewport: %v", err)
	}

	tribeID := uuid.New()
	payload, _ := json.Marshal(redisPayload{TribeID: tribeID, Delta: 3})
	if err := rdb.Publish(ctx, "support_applied:34", string(payload)).Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case msg := <-client.Send:
		var ev SupportAppliedEvent
		if err := json.Unmarshal(msg, &ev); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if ev.IlCode != "34" || ev.TribeID != tribeID {
			t.Fatalf("unexpected event: %+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for redis fan-out")
	}
}

func TestWS_OutsideViewportNotDelivered(t *testing.T) {
	_, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatalf("session: %v", err)
	}

	resolver := selectiveResolver{
		byBBox: map[geo.BBox][]string{
			{28.5, 40.8, 29.5, 41.3}: {"34"},
		},
	}
	hub := NewHub(rdb, resolver, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	time.Sleep(50 * time.Millisecond)

	h := &Handler{Hub: hub, Sessions: sessions}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	wsURL := "ws" + srv.URL[len("http"):] + "/v1/ws/map?token=" + token
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	viewport, _ := json.Marshal(map[string]any{
		"type": "viewport",
		"bbox": []float64{28.5, 40.8, 29.5, 41.3},
	})
	if err := conn.Write(context.Background(), websocket.MessageText, viewport); err != nil {
		t.Fatalf("write viewport: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		for _, c := range hub.clients {
			if c.InterestContains("34") {
				ready = true
				break
			}
		}
		hub.mu.RUnlock()
		if ready {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatal("viewport interest never set")
	}

	outside, _ := json.Marshal(redisPayload{TribeID: uuid.New(), Delta: 1})
	if err := rdb.Publish(context.Background(), "support_applied:06", string(outside)).Err(); err != nil {
		t.Fatalf("publish outside: %v", err)
	}
	inside, _ := json.Marshal(redisPayload{TribeID: uuid.New(), Delta: 9})
	if err := rdb.Publish(context.Background(), "support_applied:34", string(inside)).Err(); err != nil {
		t.Fatalf("publish inside: %v", err)
	}

	// One message expected (inside only). Avoid canceling Read mid-flight — that can
	// leave the coder/websocket conn unusable for a follow-up Read.
	readCtx, readCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer readCancel()
	_, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var ev SupportAppliedEvent
	if err := json.Unmarshal(data, &ev); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ev.IlCode != "34" || ev.Delta != 9 {
		t.Fatalf("expected in-viewport event only, got %+v", ev)
	}

	extraCtx, extraCancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer extraCancel()
	if _, _, err := conn.Read(extraCtx); err == nil {
		t.Fatal("unexpected second message (outside-viewport event leaked)")
	}
}

func TestWS_DisconnectClearsHubWithin1s(t *testing.T) {
	_, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("session: %v", err)
	}

	hub := NewHub(rdb, fixedResolver{codes: []string{"34"}}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	h := &Handler{Hub: hub, Sessions: sessions}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	wsURL := "ws" + srv.URL[len("http"):] + "/v1/ws/map?token=" + token
	conn, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	viewport, _ := json.Marshal(map[string]any{
		"type": "viewport",
		"bbox": []float64{28.5, 40.8, 29.5, 41.3},
	})
	if err := conn.Write(context.Background(), websocket.MessageText, viewport); err != nil {
		t.Fatalf("write viewport: %v", err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() < 1 {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.ClientCount() < 1 {
		t.Fatal("client never registered")
	}

	_ = conn.Close(websocket.StatusNormalClosure, "")

	deadline = time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if hub.ClientCount() == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("client still on hub after disconnect: count=%d", hub.ClientCount())
}

func TestWS_Unauthorized(t *testing.T) {
	_, rdb := startMiniRedis(t)
	hub := NewHub(rdb, fixedResolver{}, nil)
	h := &Handler{Hub: hub, Sessions: &auth.SessionService{RDB: rdb}}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/v1/ws/map?token=bad")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestLoad_GoroutineGrowthBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping load-ish goroutine check in short mode")
	}

	_, rdb := startMiniRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	hub := NewHub(rdb, fixedResolver{codes: []string{"34"}}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	h := &Handler{Hub: hub, Sessions: sessions}
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	t.Cleanup(srv.Close)

	const n = 200
	tokens := make([]string, n)
	for i := 0; i < n; i++ {
		tok, err := sessions.Create(context.Background(), uuid.New())
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		tokens[i] = tok
	}

	runtime.GC()
	before := runtime.NumGoroutine()

	var mu sync.Mutex
	conns := make([]*websocket.Conn, 0, n)
	wsBase := "ws" + srv.URL[len("http"):] + "/v1/ws/map?token="

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			conn, _, err := websocket.Dial(context.Background(), wsBase+token, nil)
			if err != nil {
				t.Errorf("dial: %v", err)
				return
			}
			mu.Lock()
			conns = append(conns, conn)
			mu.Unlock()
		}(tokens[i])
	}
	wg.Wait()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() < n {
		time.Sleep(20 * time.Millisecond)
	}
	if hub.ClientCount() != n {
		t.Fatalf("connected=%d want=%d", hub.ClientCount(), n)
	}

	runtime.GC()
	afterConnect := runtime.NumGoroutine()
	// Budget: read+write pumps per conn, plus coder/websocket / httptest overhead.
	maxDelta := n*3 + 100
	if afterConnect-before > maxDelta {
		t.Fatalf("goroutine growth unbounded: before=%d after=%d delta=%d max=%d",
			before, afterConnect, afterConnect-before, maxDelta)
	}

	for _, c := range conns {
		_ = c.Close(websocket.StatusNormalClosure, "")
	}

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && hub.ClientCount() > 0 {
		time.Sleep(20 * time.Millisecond)
	}
	if hub.ClientCount() != 0 {
		t.Fatalf("leaked clients: %d", hub.ClientCount())
	}

	var afterClose int
	reclaimDeadline := time.Now().Add(5 * time.Second)
	for {
		runtime.GC()
		afterClose = runtime.NumGoroutine()
		// Must reclaim roughly one goroutine per connection (pumps exiting).
		if afterClose <= afterConnect-n {
			break
		}
		if time.Now().After(reclaimDeadline) {
			t.Fatalf("goroutines not reclaimed after disconnect: before=%d peak=%d afterClose=%d",
				before, afterConnect, afterClose)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
