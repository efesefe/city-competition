package support_test

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/support"
)

func TestRefreshAll_TwoTribes_ControlPctsSumTo100(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "35", "İzmir", "Izmir")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)

	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, '35', 75), ($2, '35', 25)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = EXCLUDED.effective_support_sum
	`, tribeA, tribeB)
	if err != nil {
		t.Fatalf("seed scores: %v", err)
	}

	store := &support.SummaryStore{Pool: pool}
	if err := store.RefreshAll(context.Background()); err != nil {
		t.Fatalf("RefreshAll: %v", err)
	}

	var leading *string
	var pct float64
	var effSum float64
	err = pool.QueryRow(context.Background(), `
		SELECT tribe_id::text, control_pct::float8, effective_support_sum::float8
		FROM province_control_summary
		WHERE il_code = '35'
	`).Scan(&leading, &pct, &effSum)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if leading == nil || *leading != tribeA.String() {
		t.Fatalf("leading_tribe=%v want %s", leading, tribeA)
	}
	if math.Abs(pct-75) > 0.01 {
		t.Fatalf("control_pct=%v want 75", pct)
	}
	if math.Abs(effSum-75) > 0.01 {
		t.Fatalf("effective_support_sum=%v want 75", effSum)
	}

	rows, err := pool.Query(context.Background(), `
		SELECT tribe_id, effective_support_sum::float8
		FROM tribe_province_scores
		WHERE il_code = '35'
		ORDER BY effective_support_sum DESC, tribe_id ASC
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var scores []support.TribeControlScore
	for rows.Next() {
		var s support.TribeControlScore
		if err := rows.Scan(&s.TribeID, &s.EffectiveSupportSum); err != nil {
			t.Fatal(err)
		}
		scores = append(scores, s)
	}
	pcts := support.ControlPctPoints(scores)
	var sum float64
	for _, p := range pcts {
		sum += p.ControlPct
	}
	if math.Abs(sum-100) > 0.01 {
		t.Fatalf("tribe control_pct sum=%v want ~100", sum)
	}
}

func TestListControl_Handler_RequiresSession(t *testing.T) {
	pool := testPool(t)
	h := &support.Handler{Summary: &support.SummaryStore{Pool: pool}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/provinces/control", h.Control)

	req := httptest.NewRequest(http.MethodGet, "/v1/provinces/control", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}

func TestListControl_AfterRefresh_IncludesIl(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "06", "Ankara", "Ankara")
	tribeID := seedTribe(t, pool)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, '06', 10)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = EXCLUDED.effective_support_sum
	`, tribeID)
	if err != nil {
		t.Fatal(err)
	}
	store := &support.SummaryStore{Pool: pool}
	if err := store.RefreshAll(context.Background()); err != nil {
		t.Fatal(err)
	}

	h, sessions, _ := newSupportHandler(t, pool)
	h.Summary = store
	token, err := sessions.Create(context.Background(), seedUser(t, pool, &tribeID))
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/provinces/control", auth.RequireSession(sessions, http.HandlerFunc(h.Control)))

	req := httptest.NewRequest(http.MethodGet, "/v1/provinces/control", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var body struct {
		Provinces []support.ProvinceControlRow `json:"provinces"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range body.Provinces {
		if p.IlCode == "06" {
			found = true
			if p.LeadingTribeID == nil || *p.LeadingTribeID != tribeID {
				t.Fatalf("leading=%v want %s", p.LeadingTribeID, tribeID)
			}
			if math.Abs(p.ControlPct-100) > 0.01 {
				t.Fatalf("control_pct=%v want 100", p.ControlPct)
			}
			if p.PrimaryColor == nil || *p.PrimaryColor == "" {
				t.Fatalf("expected primary_color")
			}
		}
	}
	if !found {
		t.Fatalf("il 06 missing from control response (%d provinces)", len(body.Provinces))
	}
}
