package support

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ControlPctPoints returns each tribe's share of total effective support as
// percentage points (0–100). Shares sum to ~100 within floating-point tolerance
// when total > 0. A single-tribe province yields exactly 100.
func ControlPctPoints(scores []TribeControlScore) []TribeControlScore {
	out := make([]TribeControlScore, len(scores))
	copy(out, scores)
	if len(out) == 0 {
		return out
	}
	var total float64
	for _, s := range out {
		total += s.EffectiveSupportSum
	}
	if total <= 0 {
		return out
	}
	for i := range out {
		out[i].ControlPct = (out[i].EffectiveSupportSum / total) * 100
	}
	return out
}

// LeadingControlPct returns the leading tribe's control percentage (0–100),
// or 0 when there are no positive scores.
func LeadingControlPct(scores []TribeControlScore) float64 {
	pcts := ControlPctPoints(scores)
	if len(pcts) == 0 {
		return 0
	}
	return pcts[0].ControlPct
}

// ProvinceControlRow is one il's leading-tribe snapshot for the choropleth API.
type ProvinceControlRow struct {
	IlCode              string     `json:"il_code"`
	LeadingTribeID      *uuid.UUID `json:"leading_tribe_id"`
	ControlPct          float64    `json:"control_pct"`
	EffectiveSupportSum float64    `json:"effective_support_sum"`
	PrimaryColor        *string    `json:"primary_color"`
	RefreshedAt         time.Time  `json:"refreshed_at"`
}

type controlListResponse struct {
	Provinces []ProvinceControlRow `json:"provinces"`
}

// SummaryStore reads and refreshes province_control_summary.
// Pool is used for refresh writes; Read (when set) for choropleth list reads.
type SummaryStore struct {
	Pool *pgxpool.Pool
	Read *pgxpool.Pool
}

func (s *SummaryStore) readPool() *pgxpool.Pool {
	if s != nil && s.Read != nil {
		return s.Read
	}
	if s != nil {
		return s.Pool
	}
	return nil
}

// RefreshAll rebuilds province_control_summary from tribe_province_scores for
// every admin_boundaries row. No ST_Area / geometry work — scores only.
func (s *SummaryStore) RefreshAll(ctx context.Context) error {
	if s == nil || s.Pool == nil {
		return fmt.Errorf("province control summary: no pool configured")
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO province_control_summary (
			il_code, tribe_id, effective_support_sum, control_pct, refreshed_at
		)
		SELECT
			b.il_code,
			lead.tribe_id,
			COALESCE(lead.effective_support_sum, 0),
			CASE
				WHEN COALESCE(tot.total_sum, 0) <= 0 THEN 0
				ELSE (lead.effective_support_sum / tot.total_sum) * 100
			END,
			now()
		FROM admin_boundaries b
		LEFT JOIN LATERAL (
			SELECT tribe_id, effective_support_sum
			FROM tribe_province_scores tps
			WHERE tps.il_code = b.il_code
			ORDER BY effective_support_sum DESC, tribe_id ASC
			LIMIT 1
		) lead ON true
		LEFT JOIN LATERAL (
			SELECT SUM(effective_support_sum) AS total_sum
			FROM tribe_province_scores tps
			WHERE tps.il_code = b.il_code
		) tot ON true
		ON CONFLICT (il_code) DO UPDATE SET
			tribe_id = EXCLUDED.tribe_id,
			effective_support_sum = EXCLUDED.effective_support_sum,
			control_pct = EXCLUDED.control_pct,
			refreshed_at = EXCLUDED.refreshed_at
	`)
	if err != nil {
		return fmt.Errorf("refresh province_control_summary: %w", err)
	}
	return nil
}

// ListControl returns all summary rows joined with the leading tribe's primary_color.
func (s *SummaryStore) ListControl(ctx context.Context) ([]ProvinceControlRow, error) {
	pool := s.readPool()
	if pool == nil {
		return nil, fmt.Errorf("province control summary: no pool configured")
	}
	rows, err := pool.Query(ctx, `
		SELECT
			s.il_code,
			s.tribe_id,
			s.control_pct::float8,
			s.effective_support_sum::float8,
			t.primary_color,
			s.refreshed_at
		FROM province_control_summary s
		LEFT JOIN tribes t ON t.id = s.tribe_id
		ORDER BY s.il_code ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list province_control_summary: %w", err)
	}
	defer rows.Close()

	out := make([]ProvinceControlRow, 0)
	for rows.Next() {
		var row ProvinceControlRow
		var tribeID *uuid.UUID
		var color *string
		if err := rows.Scan(
			&row.IlCode,
			&tribeID,
			&row.ControlPct,
			&row.EffectiveSupportSum,
			&color,
			&row.RefreshedAt,
		); err != nil {
			return nil, fmt.Errorf("scan province_control_summary: %w", err)
		}
		row.LeadingTribeID = tribeID
		row.PrimaryColor = color
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate province_control_summary: %w", err)
	}
	return out, nil
}

// Refresher periodically materializes province_control_summary from
// tribe_province_scores. Chosen over incremental-on-spend so the hot spend path
// stays lean (it already updates tribe_province_scores + Redis invalidation).
// Choropleth HTTP reads hit the summary table only; staleness ≈ Interval.
type Refresher struct {
	Store    *SummaryStore
	Interval time.Duration
	Logger   *slog.Logger
}

func (r *Refresher) interval() time.Duration {
	if r.Interval > 0 {
		return r.Interval
	}
	return 30 * time.Second
}

// Run refreshes immediately, then on each tick until ctx is cancelled.
func (r *Refresher) Run(ctx context.Context) {
	if r == nil || r.Store == nil {
		return
	}
	log := r.Logger
	if log == nil {
		log = slog.Default()
	}

	refresh := func() {
		if err := r.Store.RefreshAll(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Error("province control summary refresh failed", "error", err)
			return
		}
		log.Debug("province control summary refreshed")
	}

	refresh()

	ticker := time.NewTicker(r.interval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refresh()
		}
	}
}
