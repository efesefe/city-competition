package conquest_test

import (
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
	"github.com/city-competition-remastered/backend/internal/user"
)

func TestSupporters_RanksAttributedWindowNotLifetime(t *testing.T) {
	pool := testPool(t)
	const il = "78"
	seedBoundary(t, pool, il, "Attril", "Attril")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	a1 := seedUser(t, pool, &tribeA)
	a2 := seedUser(t, pool, &tribeA)
	b1 := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, a1, 100)
	grantCredits(t, pool, a2, 100)
	grantCredits(t, pool, b1, 100)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, a1, il, 30); err != nil {
		t.Fatalf("a1 first: %v", err)
	}
	if _, err := svc.Apply(ctx, a2, il, 10); err != nil {
		t.Fatalf("a2 first: %v", err)
	}
	if _, err := svc.Apply(ctx, b1, il, 50); err != nil {
		t.Fatalf("b capture: %v", err)
	}
	if _, err := svc.Apply(ctx, a1, il, 5); err != nil {
		t.Fatalf("a1 recapture spend: %v", err)
	}
	if _, err := svc.Apply(ctx, a2, il, 20); err != nil {
		t.Fatalf("a2 recapture: %v", err)
	}

	logs := listLogsAsc(t, pool, il)
	if len(logs) != 3 {
		t.Fatalf("logs=%d want 3", len(logs))
	}
	store := &conquest.Store{Pool: pool}

	first, err := store.Supporters(ctx, logs[0].ID, a1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.TotalContributorCount != 1 {
		t.Fatalf("first capture contributors=%d want 1 (only a1 spent before the flip)", first.TotalContributorCount)
	}
	if len(first.Supporters) != 1 || first.Supporters[0].UserID != a1 || first.Supporters[0].Contribution != 30 {
		t.Fatalf("first capture supporters=%+v", first.Supporters)
	}

	recapture, err := store.Supporters(ctx, logs[2].ID, a2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if recapture.TotalContributorCount != 2 {
		t.Fatalf("recapture contributors=%d want 2", recapture.TotalContributorCount)
	}
	if len(recapture.Supporters) != 2 {
		t.Fatalf("recapture len=%d want 2", len(recapture.Supporters))
	}
	if recapture.Supporters[0].UserID != a2 || recapture.Supporters[0].Contribution != 20 {
		t.Fatalf("rank1=%+v want a2 contribution 20 (not lifetime 30)", recapture.Supporters[0])
	}
	if recapture.Supporters[1].UserID != a1 || recapture.Supporters[1].Contribution != 5 {
		t.Fatalf("rank2=%+v want a1 contribution 5 (not lifetime 35)", recapture.Supporters[1])
	}
}

func TestCausedFlip_OnlyThresholdCrossingSupport(t *testing.T) {
	pool := testPool(t)
	const il = "79"
	seedBoundary(t, pool, il, "Flipil", "Flipil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	a1 := seedUser(t, pool, &tribeA)
	a2 := seedUser(t, pool, &tribeA)
	b1 := seedUser(t, pool, &tribeB)
	outsider := seedUser(t, pool, &tribeA)
	grantCredits(t, pool, a1, 100)
	grantCredits(t, pool, a2, 100)
	grantCredits(t, pool, b1, 100)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, a1, il, 30); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Apply(ctx, a2, il, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Apply(ctx, b1, il, 50); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Apply(ctx, a1, il, 5); err != nil {
		t.Fatal(err)
	}
	res, err := svc.Apply(ctx, a2, il, 20)
	if err != nil {
		t.Fatal(err)
	}

	logs := listLogsAsc(t, pool, il)
	recapture := logs[len(logs)-1]
	store := &conquest.Store{Pool: pool}

	var causing uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT causing_support_id FROM conquest_log WHERE id = $1
	`, recapture.ID).Scan(&causing); err != nil {
		t.Fatalf("causing_support_id: %v", err)
	}
	if causing != res.SupportID {
		t.Fatalf("causing_support_id=%s want the recapture spend %s", causing, res.SupportID)
	}

	var tagged int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM supports WHERE conquest_log_id = $1
	`, recapture.ID).Scan(&tagged); err != nil {
		t.Fatal(err)
	}
	if tagged != 2 {
		t.Fatalf("attributed rows=%d want 2", tagged)
	}

	asA2, err := store.Supporters(ctx, recapture.ID, a2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if !asA2.CausedFlip {
		t.Fatal("caused_flip=false for a2; a2's spend crossed the threshold")
	}
	asA1, err := store.Supporters(ctx, recapture.ID, a1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if asA1.CausedFlip {
		t.Fatal("caused_flip=true for a1; a1 only contributed")
	}
	asOut, err := store.Supporters(ctx, recapture.ID, outsider, 10)
	if err != nil {
		t.Fatal(err)
	}
	if asOut.CausedFlip {
		t.Fatal("caused_flip=true for non-contributor")
	}

	entries, err := store.List(ctx, a2, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, e := range entries {
		if e.ID == recapture.ID {
			found = true
			if !e.CausedFlip {
				t.Fatal("list entry caused_flip=false for the flipper")
			}
		}
	}
	if !found {
		t.Fatal("recapture missing from list")
	}
	entriesA1, err := store.List(ctx, a1, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entriesA1 {
		if e.ID == recapture.ID && e.CausedFlip {
			t.Fatal("list entry caused_flip=true for a contributor who did not cross the threshold")
		}
	}
}

func TestSupporters_AvatarFallbackDeterministic(t *testing.T) {
	pool := testPool(t)
	const il = "80"
	seedBoundary(t, pool, il, "Avil", "Avil")
	tribeA := seedTribe(t, pool)
	a1 := seedUser(t, pool, &tribeA)
	grantCredits(t, pool, a1, 50)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, a1, il, 10); err != nil {
		t.Fatal(err)
	}
	logs := listLogsAsc(t, pool, il)
	store := &conquest.Store{Pool: pool}

	first, err := store.Supporters(ctx, logs[0].ID, a1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Supporters) != 1 {
		t.Fatalf("supporters=%d want 1", len(first.Supporters))
	}
	url := first.Supporters[0].AvatarURL
	if url == "" {
		t.Fatal("avatar_url empty; fallback must never be null/empty")
	}
	want := user.CanonicalAvatarURL(a1)
	if url != want {
		t.Fatalf("avatar_url=%q want %q", url, want)
	}
	second, err := store.Supporters(ctx, logs[0].ID, a1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if second.Supporters[0].AvatarURL != url {
		t.Fatalf("avatar_url not deterministic: %q vs %q", second.Supporters[0].AvatarURL, url)
	}

	h := &user.Handler{Pool: pool, Blobs: user.NewDirBlobStore(t.TempDir())}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/users/{user_id}/avatar", h.GetAvatar)
	req := httptest.NewRequest(http.MethodGet, "/v1/users/"+a1.String()+"/avatar", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get avatar status=%d body=%s", rec.Code, rec.Body.String())
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "image/svg+xml; charset=utf-8" && ct != "image/svg+xml" {
		t.Fatalf("content-type=%q want image/svg+xml", ct)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty svg body")
	}
}

func TestSupportersHTTP_AuthUnknownAndIsYou(t *testing.T) {
	pool := testPool(t)
	const il = "70"
	seedBoundary(t, pool, il, "Httpattr", "Httpattr")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	flipper := seedUser(t, pool, &tribeA)
	helper := seedUser(t, pool, &tribeA)
	leader := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, leader, 200)
	grantCredits(t, pool, helper, 200)
	grantCredits(t, pool, flipper, 200)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, leader, il, 119); err != nil {
		t.Fatal(err)
	}
	// 11 helpers + flipper all spend while B leads; the last spend crosses 119.
	for i := 0; i < 10; i++ {
		u := seedUser(t, pool, &tribeA)
		grantCredits(t, pool, u, 50)
		if _, err := svc.Apply(ctx, u, il, 10); err != nil {
			t.Fatalf("pre-flip spend %d: %v", i, err)
		}
	}
	if _, err := svc.Apply(ctx, helper, il, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Apply(ctx, flipper, il, 20); err != nil {
		t.Fatal(err)
	}

	logs := listLogsAsc(t, pool, il)
	capture := logs[len(logs)-1]

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(ctx, flipper)
	if err != nil {
		t.Fatal(err)
	}

	h := &conquest.Handler{Store: &conquest.Store{Pool: pool}}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/conquest-log/{log_id}/supporters", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Supporters)))

	unauth := httptest.NewRequest(http.MethodGet, "/v1/conquest-log/"+capture.ID.String()+"/supporters", nil)
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauth)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth status=%d want 401", unauthRec.Code)
	}

	bad := httptest.NewRequest(http.MethodGet, "/v1/conquest-log/not-a-uuid/supporters", nil)
	bad.Header.Set("Authorization", "Bearer "+token)
	badRec := httptest.NewRecorder()
	mux.ServeHTTP(badRec, bad)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad id status=%d want 400", badRec.Code)
	}

	missing := httptest.NewRequest(http.MethodGet, "/v1/conquest-log/"+uuid.New().String()+"/supporters", nil)
	missing.Header.Set("Authorization", "Bearer "+token)
	missingRec := httptest.NewRecorder()
	mux.ServeHTTP(missingRec, missing)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("unknown log status=%d want 404", missingRec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/conquest-log/"+capture.ID.String()+"/supporters", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body conquest.SupportersResult
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.CausedFlip {
		t.Fatal("flipper should have caused_flip=true")
	}
	if body.TotalContributorCount != 12 {
		t.Fatalf("total_contributor_count=%d want 12", body.TotalContributorCount)
	}
	if len(body.Supporters) != 10 {
		t.Fatalf("default cap len=%d want 10", len(body.Supporters))
	}
	var sawSelf bool
	for _, s := range body.Supporters {
		if s.IsYou {
			sawSelf = true
			if s.UserID != flipper {
				t.Fatalf("is_you on %s want %s", s.UserID, flipper)
			}
		}
		if s.AvatarURL == "" {
			t.Fatal("avatar_url empty")
		}
		if s.DisplayName == "" {
			t.Fatal("display_name empty")
		}
	}
	if !sawSelf {
		t.Fatal("flipper not in top-10 or is_you not set")
	}
}
