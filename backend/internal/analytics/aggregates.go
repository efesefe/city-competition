// Package analytics provides anonymized funnel/cohort rollups and dashboard reads (10.1–10.3).
package analytics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dashboard-facing SQL only — inspected by TestDashboardQueriesHaveNoPII.
// Must never select raw user_id / PII or scan supports / consent_events / users / activity_events.
const (
	DashboardFunnelSQL = `
		SELECT
			day,
			installs,
			consented,
			joined_tribe,
			first_support,
			retained_d7,
			computed_at
		FROM analytics_funnel_daily
		WHERE day >= $1::date AND day <= $2::date
		ORDER BY day ASC
	`

	DashboardCohortsSQL = `
		SELECT
			cohort_day,
			cohort_size,
			retained_d1,
			retained_d7,
			retained_d30,
			computed_at
		FROM analytics_cohort_daily
		WHERE cohort_day >= $1::date AND cohort_day <= $2::date
		ORDER BY cohort_day ASC
	`

	DashboardHeatmapSQL = `
		SELECT
			b.il_code,
			COALESCE(tot.effective_support_sum, 0)::float8 AS effective_support_sum,
			COALESCE(s.control_pct, 0)::float8 AS control_pct,
			s.tribe_id,
			t.primary_color,
			s.refreshed_at
		FROM admin_boundaries b
		LEFT JOIN (
			SELECT il_code, SUM(effective_support_sum) AS effective_support_sum
			FROM tribe_province_scores
			GROUP BY il_code
		) tot ON tot.il_code = b.il_code
		LEFT JOIN province_control_summary s ON s.il_code = b.il_code
		LEFT JOIN tribes t ON t.id = s.tribe_id
		ORDER BY b.il_code ASC
	`
)

// DashboardQueries returns every dashboard-facing SQL string for static PII checks.
func DashboardQueries() []string {
	return []string{DashboardFunnelSQL, DashboardCohortsSQL, DashboardHeatmapSQL}
}

// Store reads and writes analytics aggregate tables.
type Store struct {
	Pool *pgxpool.Pool
}

// FunnelDay is one anonymized funnel rollup row.
type FunnelDay struct {
	Day          time.Time `json:"day"`
	Installs     int       `json:"installs"`
	Consented    int       `json:"consented"`
	JoinedTribe  int       `json:"joined_tribe"`
	FirstSupport int       `json:"first_support"`
	RetainedD7   int       `json:"retained_d7"`
	ComputedAt   time.Time `json:"computed_at"`
}

// CohortDay is one anonymized cohort retention row.
type CohortDay struct {
	CohortDay   time.Time `json:"cohort_day"`
	CohortSize  int       `json:"cohort_size"`
	RetainedD1  int       `json:"retained_d1"`
	RetainedD7  int       `json:"retained_d7"`
	RetainedD30 int       `json:"retained_d30"`
	ComputedAt  time.Time `json:"computed_at"`
}

// HeatmapRow is province support intensity from summary tables (no ledger scan).
type HeatmapRow struct {
	IlCode              string     `json:"il_code"`
	EffectiveSupportSum float64    `json:"effective_support_sum"`
	ControlPct          float64    `json:"control_pct"`
	LeadingTribeID      *uuid.UUID `json:"leading_tribe_id"`
	PrimaryColor        *string    `json:"primary_color"`
	RefreshedAt         *time.Time `json:"refreshed_at"`
}

// ComputeDay upserts funnel + cohort aggregates for install cohort day (UTC date).
// Idempotent: re-running for the same day replaces counts via ON CONFLICT DO UPDATE.
// Batch SQL may read raw event tables; only counts are persisted.
func (s *Store) ComputeDay(ctx context.Context, day time.Time) error {
	d := truncateUTCDate(day)

	if err := s.upsertFunnel(ctx, d); err != nil {
		return err
	}
	if err := s.upsertCohort(ctx, d); err != nil {
		return err
	}
	return nil
}

func (s *Store) upsertFunnel(ctx context.Context, day time.Time) error {
	_, err := s.Pool.Exec(ctx, `
		WITH cohort AS (
			SELECT id AS user_id, created_at
			FROM users
			WHERE (created_at AT TIME ZONE 'UTC')::date = $1::date
		),
		consented AS (
			SELECT DISTINCT c.user_id
			FROM cohort c
			INNER JOIN consent_events e ON e.user_id = c.user_id
			WHERE e.consent_type = 'terms_of_service'
			  AND e.granted = true
			  AND e.created_at >= c.created_at
		),
		joined AS (
			SELECT c.user_id
			FROM cohort c
			INNER JOIN users u ON u.id = c.user_id
			WHERE u.tribe_id IS NOT NULL
		),
		first_support AS (
			SELECT DISTINCT c.user_id
			FROM cohort c
			INNER JOIN supports sp ON sp.user_id = c.user_id
		),
		activity AS (
			SELECT sp.user_id, (sp.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM supports sp
			INNER JOIN cohort c ON c.user_id = sp.user_id
			UNION
			SELECT ae.actor_id AS user_id, (ae.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM activity_events ae
			INNER JOIN cohort c ON c.user_id = ae.actor_id
			UNION
			SELECT e.user_id, (e.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM consent_events e
			INNER JOIN cohort c ON c.user_id = e.user_id
		),
		retained_d7 AS (
			SELECT DISTINCT a.user_id
			FROM activity a
			WHERE a.activity_day = $1::date + 7
		)
		INSERT INTO analytics_funnel_daily (
			day, installs, consented, joined_tribe, first_support, retained_d7, computed_at
		)
		SELECT
			$1::date,
			(SELECT COUNT(*)::int FROM cohort),
			(SELECT COUNT(*)::int FROM consented),
			(SELECT COUNT(*)::int FROM joined),
			(SELECT COUNT(*)::int FROM first_support),
			(SELECT COUNT(*)::int FROM retained_d7),
			now()
		ON CONFLICT (day) DO UPDATE SET
			installs = EXCLUDED.installs,
			consented = EXCLUDED.consented,
			joined_tribe = EXCLUDED.joined_tribe,
			first_support = EXCLUDED.first_support,
			retained_d7 = EXCLUDED.retained_d7,
			computed_at = EXCLUDED.computed_at
	`, day)
	if err != nil {
		return fmt.Errorf("upsert analytics_funnel_daily: %w", err)
	}
	return nil
}

func (s *Store) upsertCohort(ctx context.Context, day time.Time) error {
	_, err := s.Pool.Exec(ctx, `
		WITH cohort AS (
			SELECT id AS user_id, created_at
			FROM users
			WHERE (created_at AT TIME ZONE 'UTC')::date = $1::date
		),
		activity AS (
			SELECT sp.user_id, (sp.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM supports sp
			INNER JOIN cohort c ON c.user_id = sp.user_id
			UNION
			SELECT ae.actor_id AS user_id, (ae.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM activity_events ae
			INNER JOIN cohort c ON c.user_id = ae.actor_id
			UNION
			SELECT e.user_id, (e.created_at AT TIME ZONE 'UTC')::date AS activity_day
			FROM consent_events e
			INNER JOIN cohort c ON c.user_id = e.user_id
		)
		INSERT INTO analytics_cohort_daily (
			cohort_day, cohort_size, retained_d1, retained_d7, retained_d30, computed_at
		)
		SELECT
			$1::date,
			(SELECT COUNT(*)::int FROM cohort),
			(SELECT COUNT(DISTINCT user_id)::int FROM activity WHERE activity_day = $1::date + 1),
			(SELECT COUNT(DISTINCT user_id)::int FROM activity WHERE activity_day = $1::date + 7),
			(SELECT COUNT(DISTINCT user_id)::int FROM activity WHERE activity_day = $1::date + 30),
			now()
		ON CONFLICT (cohort_day) DO UPDATE SET
			cohort_size = EXCLUDED.cohort_size,
			retained_d1 = EXCLUDED.retained_d1,
			retained_d7 = EXCLUDED.retained_d7,
			retained_d30 = EXCLUDED.retained_d30,
			computed_at = EXCLUDED.computed_at
	`, day)
	if err != nil {
		return fmt.Errorf("upsert analytics_cohort_daily: %w", err)
	}
	return nil
}

// ListFunnel returns funnel rows in [from, to] (inclusive UTC dates) from summary table only.
func (s *Store) ListFunnel(ctx context.Context, from, to time.Time) ([]FunnelDay, error) {
	rows, err := s.Pool.Query(ctx, DashboardFunnelSQL, truncateUTCDate(from), truncateUTCDate(to))
	if err != nil {
		return nil, fmt.Errorf("list analytics_funnel_daily: %w", err)
	}
	defer rows.Close()

	out := make([]FunnelDay, 0)
	for rows.Next() {
		var r FunnelDay
		if err := rows.Scan(
			&r.Day, &r.Installs, &r.Consented, &r.JoinedTribe, &r.FirstSupport, &r.RetainedD7, &r.ComputedAt,
		); err != nil {
			return nil, fmt.Errorf("scan analytics_funnel_daily: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate analytics_funnel_daily: %w", err)
	}
	return out, nil
}

// ListCohorts returns cohort retention rows in [from, to] from summary table only.
func (s *Store) ListCohorts(ctx context.Context, from, to time.Time) ([]CohortDay, error) {
	rows, err := s.Pool.Query(ctx, DashboardCohortsSQL, truncateUTCDate(from), truncateUTCDate(to))
	if err != nil {
		return nil, fmt.Errorf("list analytics_cohort_daily: %w", err)
	}
	defer rows.Close()

	out := make([]CohortDay, 0)
	for rows.Next() {
		var r CohortDay
		if err := rows.Scan(
			&r.CohortDay, &r.CohortSize, &r.RetainedD1, &r.RetainedD7, &r.RetainedD30, &r.ComputedAt,
		); err != nil {
			return nil, fmt.Errorf("scan analytics_cohort_daily: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate analytics_cohort_daily: %w", err)
	}
	return out, nil
}

// ListHeatmap reads province support aggregates + control summary (no supports ledger).
func (s *Store) ListHeatmap(ctx context.Context) ([]HeatmapRow, error) {
	rows, err := s.Pool.Query(ctx, DashboardHeatmapSQL)
	if err != nil {
		return nil, fmt.Errorf("list analytics heatmap: %w", err)
	}
	defer rows.Close()

	out := make([]HeatmapRow, 0)
	for rows.Next() {
		var r HeatmapRow
		if err := rows.Scan(
			&r.IlCode,
			&r.EffectiveSupportSum,
			&r.ControlPct,
			&r.LeadingTribeID,
			&r.PrimaryColor,
			&r.RefreshedAt,
		); err != nil {
			return nil, fmt.Errorf("scan analytics heatmap: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate analytics heatmap: %w", err)
	}
	return out, nil
}

func truncateUTCDate(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}
