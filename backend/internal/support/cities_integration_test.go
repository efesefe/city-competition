package support_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/support"
)

func TestListCities_Returns81_WithControllingTribe(t *testing.T) {
	pool := testPool(t)
	for i := 1; i <= 81; i++ {
		code := fmt.Sprintf("%02d", i)
		seedBoundary(t, pool, code, "İl "+code, "Province "+code)
	}

	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)

	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, '06', 100), ($2, '06', 40)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = EXCLUDED.effective_support_sum
	`, tribeA, tribeB)
	if err != nil {
		t.Fatalf("seed scores: %v", err)
	}

	summary := &support.SummaryStore{Pool: pool}
	if err := summary.RefreshAll(context.Background()); err != nil {
		t.Fatalf("refresh summary: %v", err)
	}

	userID := seedUser(t, pool, &tribeA)
	sessions := newSessionService(t)
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	h := &support.Handler{
		Cities: &support.CityStore{Pool: pool},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/cities", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListCities)))

	req := httptest.NewRequest(http.MethodGet, "/v1/cities", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Cities []support.City `json:"cities"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Cities) != 81 {
		t.Fatalf("cities=%d want 81", len(resp.Cities))
	}

	var ankara *support.City
	for i := range resp.Cities {
		c := &resp.Cities[i]
		if c.ID == "" || c.Name == "" {
			t.Fatalf("city missing id/name: %+v", c)
		}
		if c.CompetingTribes == nil {
			t.Fatalf("city %s competing_tribes nil", c.ID)
		}
		if c.ID == "06" {
			ankara = c
		}
	}
	if ankara == nil {
		t.Fatal("missing Ankara (06)")
	}
	if ankara.ControllingTribe == nil || ankara.ControllingTribe.TribeID != tribeA {
		t.Fatalf("controlling tribe=%v want %s", ankara.ControllingTribe, tribeA)
	}
	if len(ankara.CompetingTribes) != 2 {
		t.Fatalf("competing=%d want 2", len(ankara.CompetingTribes))
	}
	if ankara.CompetingTribes[0].TribeID != tribeA || ankara.CompetingTribes[0].CommittedCredits != 100 {
		t.Fatalf("leading competitor=%+v", ankara.CompetingTribes[0])
	}
	if ankara.Centroid.Lng == 0 && ankara.Centroid.Lat == 0 {
		t.Fatalf("centroid empty: %+v", ankara.Centroid)
	}
}

func TestAdjacency_SpotCheckRealBorders(t *testing.T) {
	pool := testPool(t)
	for _, code := range []string{"06", "34", "35", "41", "42", "45"} {
		seedBoundary(t, pool, code, "İl "+code, "Province "+code)
	}

	_, err := pool.Exec(context.Background(), `DELETE FROM region_adjacency`)
	if err != nil {
		t.Fatalf("clear adjacency: %v", err)
	}
	edges := [][2]string{
		{"06", "42"}, // Ankara–Konya
		{"34", "41"}, // İstanbul–Kocaeli
		{"35", "45"}, // İzmir–Manisa
	}
	for _, e := range edges {
		a, b := e[0], e[1]
		if a > b {
			a, b = b, a
		}
		_, err := pool.Exec(context.Background(), `
			INSERT INTO region_adjacency (il_code_a, il_code_b) VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, a, b)
		if err != nil {
			t.Fatalf("insert edge %s-%s: %v", a, b, err)
		}
	}

	store := &support.AdjacencyStore{Pool: pool}

	cases := []struct {
		a, b string
		want bool
	}{
		{"06", "42", true},
		{"42", "06", true},
		{"34", "41", true},
		{"35", "45", true},
		{"06", "34", false},
		{"35", "42", false},
	}
	for _, tc := range cases {
		ok, err := store.AreNeighbors(context.Background(), tc.a, tc.b)
		if err != nil {
			t.Fatalf("AreNeighbors(%s,%s): %v", tc.a, tc.b, err)
		}
		if ok != tc.want {
			t.Fatalf("AreNeighbors(%s,%s)=%v want %v", tc.a, tc.b, ok, tc.want)
		}
	}

	neighbors, err := store.Neighbors(context.Background(), "06")
	if err != nil {
		t.Fatal(err)
	}
	if len(neighbors) != 1 || neighbors[0] != "42" {
		t.Fatalf("Neighbors(06)=%v want [42]", neighbors)
	}
}

func TestCreateByRegion_Integration_UnknownRegion(t *testing.T) {
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
	mux.Handle("POST /v1/region/{il_code}/support", auth.RequireSession(sessions, nil, http.HandlerFunc(h.CreateByRegion)))

	body, _ := json.Marshal(map[string]any{"credits": 5})
	req := httptest.NewRequest(http.MethodPost, "/v1/region/99/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != support.ErrUnknownRegion.Error() {
		t.Fatalf("error=%q want unknown_region", errBody["error"])
	}
}

func newSessionService(t *testing.T) *auth.SessionService {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return &auth.SessionService{RDB: rdb}
}
