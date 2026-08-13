package conquest_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/conquest"
)

func TestActivityFeed_SinceID_NoDuplicatesNoGaps(t *testing.T) {
	pool := testPool(t)
	const il = "63"
	seedBoundary(t, pool, il, "Feedil", "Feedil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 500)
	grantCredits(t, pool, userB, 500)

	guest := seedTribe(t, pool)
	derbyID := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO derbies (
			id, host_tribe_id, guest_tribe_id, il_code, starts_at, ends_at, status, created_by_admin_id
		) VALUES (
			$1, $2, $3, $4, now() - interval '1 hour', now() + interval '100 years', 'active', $5
		)
	`, derbyID, tribeA, guest, il, userA)
	if err != nil {
		t.Fatalf("seed derby: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, derbyID)
	})

	// Far-future clock so these events sit at the front of the shared-DB feed.
	clock := time.Date(2126, 6, 1, 12, 0, 0, 0, time.UTC)
	svc := newSpendService(pool)
	svc.Now = func() time.Time { return clock }
	svc.ActivityLargeSupportMin = 50
	svc.MultiplierFn = func(_ context.Context, _, tribe uuid.UUID, _ string, _ time.Time) (float64, *uuid.UUID, string) {
		if tribe == tribeA {
			id := derbyID
			return 2, &id, "host"
		}
		return 1, nil, ""
	}

	ctx := context.Background()
	store := &conquest.ActivityStore{Pool: pool, LargeSupportMin: 50}

	advance := func() {
		clock = clock.Add(time.Second)
	}

	// E1: first capture (conquest). MultiplierFn returns derby for tribe A, so this
	// flip is a conquest with was_derbi_bonus — the causing spend is not a separate support event.
	if _, err := svc.Apply(ctx, userA, il, 10); err != nil {
		t.Fatalf("E1: %v", err)
	}
	advance()
	// E2: same-tribe derby support, no flip.
	if _, err := svc.Apply(ctx, userA, il, 5); err != nil {
		t.Fatalf("E2: %v", err)
	}
	advance()
	// Temporarily disable derby so E3 is a large_support, not derby_support.
	svc.MultiplierFn = nil
	if _, err := svc.Apply(ctx, userA, il, 50); err != nil {
		t.Fatalf("E3: %v", err)
	}

	page1, err := store.List(ctx, nil, 10)
	if err != nil {
		t.Fatalf("list page1: %v", err)
	}
	ours1 := filterIl(page1, il)
	if len(ours1) != 3 {
		t.Fatalf("page1 for %s=%d want 3 kinds=%v", il, len(ours1), kinds(ours1))
	}
	// Newest first: E3 large_support, E2 derby_support, E1 conquest.
	if ours1[0].Kind != conquest.KindLargeSupport || ours1[1].Kind != conquest.KindDerbySupport || ours1[2].Kind != conquest.KindConquest {
		t.Fatalf("page1 kinds=%v want large_support, derby_support, conquest", kinds(ours1))
	}
	e3 := ours1[0]

	advance()
	if _, err := svc.Apply(ctx, userB, il, 200); err != nil {
		t.Fatalf("E4 flip: %v", err)
	}
	advance()
	if _, err := svc.Apply(ctx, userB, il, 60); err != nil {
		t.Fatalf("E5 large: %v", err)
	}

	page2, err := store.List(ctx, &e3.ID, 20)
	if err != nil {
		t.Fatalf("list since E3: %v", err)
	}
	ours2 := filterIl(page2, il)
	if len(ours2) != 2 {
		t.Fatalf("since E3 for %s=%d want 2 events=%+v", il, len(ours2), ours2)
	}
	if ours2[0].Kind != conquest.KindLargeSupport || ours2[1].Kind != conquest.KindConquest {
		t.Fatalf("since E3 kinds=%v want large_support, conquest", kinds(ours2))
	}
	seen := map[uuid.UUID]int{}
	for _, e := range ours2 {
		seen[e.ID]++
		if e.ID == e3.ID {
			t.Fatal("since_id page included the cursor event")
		}
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("id %s appeared %d times", id, n)
		}
	}
	if ours2[0].OccurredAt.Before(ours2[1].OccurredAt) {
		t.Fatal("expected newest-first order on since_id page")
	}

	// Sequential poll from the newest seen id should be empty (no gaps, no dupes).
	newest := ours2[0].ID
	page3, err := store.List(ctx, &newest, 20)
	if err != nil {
		t.Fatalf("list since newest: %v", err)
	}
	if extras := filterIl(page3, il); len(extras) != 0 {
		t.Fatalf("poll after newest returned %d events: %+v", len(extras), extras)
	}
}

func TestActivityFeedHTTP_SinceIDAndAuth(t *testing.T) {
	pool := testPool(t)
	const il = "65"
	seedBoundary(t, pool, il, "Feedhttp", "Feedhttp")
	tribeA := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	grantCredits(t, pool, userA, 100)

	clock := time.Date(2126, 7, 1, 12, 0, 0, 0, time.UTC)
	svc := newSpendService(pool)
	svc.Now = func() time.Time { return clock }
	if _, err := svc.Apply(context.Background(), userA, il, 10); err != nil {
		t.Fatalf("capture: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), userA)
	if err != nil {
		t.Fatal(err)
	}

	h := &conquest.Handler{
		Store:    &conquest.Store{Pool: pool},
		Activity: &conquest.ActivityStore{Pool: pool, LargeSupportMin: 50},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/activity-feed", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListActivityFeed)))

	unauth := httptest.NewRequest(http.MethodGet, "/v1/activity-feed", nil)
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauth)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth status=%d want 401", unauthRec.Code)
	}

	bad := httptest.NewRequest(http.MethodGet, "/v1/activity-feed?since_id="+uuid.New().String(), nil)
	bad.Header.Set("Authorization", "Bearer "+token)
	badRec := httptest.NewRecorder()
	mux.ServeHTTP(badRec, bad)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("unknown since_id status=%d want 400 body=%s", badRec.Code, badRec.Body.String())
	}

	okReq := httptest.NewRequest(http.MethodGet, "/v1/activity-feed?limit=20", nil)
	okReq.Header.Set("Authorization", "Bearer "+token)
	okRec := httptest.NewRecorder()
	mux.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", okRec.Code, okRec.Body.String())
	}
	var body struct {
		Events []conquest.FeedItem `json:"events"`
	}
	if err := json.NewDecoder(okRec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range body.Events {
		if e.IlCode == il && e.Kind == conquest.KindConquest {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected conquest event for seeded city")
	}
}

func TestActivityFeed_PublishOnFlip(t *testing.T) {
	pool := testPool(t)
	const il = "66"
	seedBoundary(t, pool, il, "Pubil", "Pubil")
	tribeA := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	grantCredits(t, pool, userA, 50)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	ctx := context.Background()
	sub := rdb.Subscribe(ctx, conquest.ActivityFeedChannel)
	t.Cleanup(func() { _ = sub.Close() })
	if _, err := sub.Receive(ctx); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	ch := sub.Channel()

	svc := newSpendService(pool)
	svc.RDB = rdb
	if _, err := svc.Apply(ctx, userA, il, 10); err != nil {
		t.Fatalf("apply: %v", err)
	}

	select {
	case msg := <-ch:
		var item conquest.FeedItem
		if err := json.Unmarshal([]byte(msg.Payload), &item); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if item.Kind != conquest.KindConquest || item.IlCode != il {
			t.Fatalf("published %+v", item)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected activity:feed publish on flip")
	}
}

func filterIl(items []conquest.FeedItem, il string) []conquest.FeedItem {
	out := make([]conquest.FeedItem, 0)
	for _, e := range items {
		if e.IlCode == il {
			out = append(out, e)
		}
	}
	return out
}

func kinds(items []conquest.FeedItem) []string {
	out := make([]string, len(items))
	for i, e := range items {
		out[i] = e.Kind
	}
	return out
}
