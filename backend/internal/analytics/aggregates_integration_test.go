package analytics_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/analytics"
	"github.com/city-competition-remastered/backend/internal/migrate"
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

func seedBoundary(t *testing.T, pool *pgxpool.Pool, ilCode string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			$1, $1, $1,
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET
			name_tr = EXCLUDED.name_tr,
			name_en = EXCLUDED.name_en,
			geom = EXCLUDED.geom
	`, ilCode)
	if err != nil {
		t.Fatalf("seed boundary: %v", err)
	}
}

func seedTribe(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	slug := "a" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
		VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
	`, id, slug, "Tribe "+slug, "T")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUserAt(t *testing.T, pool *pgxpool.Pool, tribeID *uuid.UUID, createdAt time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1666" + id.String()[24:]
	username := "a" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id, created_at)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4, $5)
	`, id, phone, username, tribeID, createdAt.UTC())
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM activity_events WHERE actor_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM consent_events WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func grantToS(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, at time.Time) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO consent_events (user_id, consent_type, consent_version, granted, created_at)
		VALUES ($1, 'terms_of_service', 'v1', true, $2)
	`, userID, at.UTC())
	if err != nil {
		t.Fatalf("grant tos: %v", err)
	}
}

func insertSupport(t *testing.T, pool *pgxpool.Pool, userID, tribeID uuid.UUID, ilCode string, at time.Time) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO supports (user_id, tribe_id, il_code, credits_spent, multiplier, effective_support, created_at)
		VALUES ($1, $2, $3, 1, 1, 1, $4)
	`, userID, tribeID, ilCode, at.UTC())
	if err != nil {
		t.Fatalf("insert support: %v", err)
	}
}

func TestComputeDay_FunnelIdempotentSameDay(t *testing.T) {
	pool := testPool(t)
	store := &analytics.Store{Pool: pool}

	day := time.Date(2011, 6, 15, 0, 0, 0, 0, time.UTC)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM analytics_funnel_daily WHERE day = $1`, day)
		_, _ = pool.Exec(context.Background(), `DELETE FROM analytics_cohort_daily WHERE cohort_day = $1`, day)
	})

	seedBoundary(t, pool, "34")
	tribeID := seedTribe(t, pool)

	// 4 installs on day; progressive funnel stages + one D7 retained.
	u1 := seedUserAt(t, pool, nil, day.Add(2*time.Hour))                         // install only
	u2 := seedUserAt(t, pool, nil, day.Add(3*time.Hour))                         // + consent
	u3 := seedUserAt(t, pool, &tribeID, day.Add(4*time.Hour))                    // + tribe
	u4 := seedUserAt(t, pool, &tribeID, day.Add(5*time.Hour))                    // + first support + D7

	grantToS(t, pool, u2, day.Add(6*time.Hour))
	grantToS(t, pool, u3, day.Add(6*time.Hour))
	grantToS(t, pool, u4, day.Add(6*time.Hour))
	insertSupport(t, pool, u4, tribeID, "34", day.Add(8*time.Hour))
	insertSupport(t, pool, u4, tribeID, "34", day.AddDate(0, 0, 7).Add(2*time.Hour))

	_ = u1

	if err := store.ComputeDay(context.Background(), day); err != nil {
		t.Fatalf("ComputeDay #1: %v", err)
	}
	first, err := store.ListFunnel(context.Background(), day, day)
	if err != nil {
		t.Fatalf("ListFunnel #1: %v", err)
	}
	if len(first) != 1 {
		t.Fatalf("funnel rows=%d want 1", len(first))
	}
	want := first[0]

	if want.Installs != 4 {
		t.Fatalf("installs=%d want 4", want.Installs)
	}
	if want.Consented != 3 {
		t.Fatalf("consented=%d want 3", want.Consented)
	}
	if want.JoinedTribe != 2 {
		t.Fatalf("joined_tribe=%d want 2", want.JoinedTribe)
	}
	if want.FirstSupport != 1 {
		t.Fatalf("first_support=%d want 1", want.FirstSupport)
	}
	if want.RetainedD7 != 1 {
		t.Fatalf("retained_d7=%d want 1", want.RetainedD7)
	}

	if err := store.ComputeDay(context.Background(), day); err != nil {
		t.Fatalf("ComputeDay #2: %v", err)
	}
	second, err := store.ListFunnel(context.Background(), day, day)
	if err != nil {
		t.Fatalf("ListFunnel #2: %v", err)
	}
	if len(second) != 1 {
		t.Fatalf("after recompute funnel rows=%d want 1", len(second))
	}
	got := second[0]
	if got.Installs != want.Installs ||
		got.Consented != want.Consented ||
		got.JoinedTribe != want.JoinedTribe ||
		got.FirstSupport != want.FirstSupport ||
		got.RetainedD7 != want.RetainedD7 {
		t.Fatalf("idempotent mismatch: first=%+v second=%+v", want, got)
	}

	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM analytics_funnel_daily WHERE day = $1
	`, day).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("analytics_funnel_daily rows for day=%d want 1", n)
	}
}

func TestListHeatmap_LatencyFlatVsEventVolume(t *testing.T) {
	pool := testPool(t)
	store := &analytics.Store{Pool: pool}

	ilCode := "41"
	seedBoundary(t, pool, ilCode)
	tribeID := seedTribe(t, pool)
	userID := seedUserAt(t, pool, &tribeID, time.Now().UTC())

	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, $2, 10)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = EXCLUDED.effective_support_sum
	`, tribeID, ilCode)
	if err != nil {
		t.Fatalf("seed scores: %v", err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO province_control_summary (
			il_code, tribe_id, effective_support_sum, control_pct, refreshed_at
		) VALUES ($1, $2, 10, 100, now())
		ON CONFLICT (il_code) DO UPDATE SET
			tribe_id = EXCLUDED.tribe_id,
			effective_support_sum = EXCLUDED.effective_support_sum,
			control_pct = EXCLUDED.control_pct,
			refreshed_at = EXCLUDED.refreshed_at
	`, ilCode, tribeID)
	if err != nil {
		t.Fatalf("seed control summary: %v", err)
	}

	// Warm + baseline timing against summary tables.
	startLow := time.Now()
	lowRows, err := store.ListHeatmap(context.Background())
	lowDur := time.Since(startLow)
	if err != nil {
		t.Fatalf("ListHeatmap low: %v", err)
	}
	if len(lowRows) == 0 {
		t.Fatal("expected heatmap rows")
	}

	// Flood raw ledger; scores table stays O(provinces×tribes).
	const n = 4000
	for i := 0; i < n; i++ {
		insertSupport(t, pool, userID, tribeID, ilCode, time.Now().UTC())
	}
	var ledgerCount int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM supports WHERE user_id = $1
	`, userID).Scan(&ledgerCount); err != nil {
		t.Fatal(err)
	}
	if ledgerCount < n {
		t.Fatalf("ledger count=%d want >= %d", ledgerCount, n)
	}

	startHigh := time.Now()
	highRows, err := store.ListHeatmap(context.Background())
	highDur := time.Since(startHigh)
	if err != nil {
		t.Fatalf("ListHeatmap high: %v", err)
	}
	if len(highRows) != len(lowRows) {
		t.Fatalf("heatmap row count changed with ledger volume: low=%d high=%d", len(lowRows), len(highRows))
	}

	var plan strings.Builder
	rows, err := pool.Query(context.Background(), `EXPLAIN `+analytics.DashboardHeatmapSQL)
	if err != nil {
		t.Fatalf("EXPLAIN heatmap: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(plan.String()), "supports") {
		t.Fatalf("heatmap plan must not scan supports:\n%s", plan.String())
	}

	// Same order of magnitude / flat vs ledger volume.
	if highDur > 2*time.Second {
		t.Fatalf("heatmap too slow with large ledger: %v", highDur)
	}
	if lowDur > 0 && highDur > lowDur*20 && highDur > 50*time.Millisecond {
		t.Fatalf("heatmap latency not flat vs event volume: low=%v high=%v", lowDur, highDur)
	}
}
