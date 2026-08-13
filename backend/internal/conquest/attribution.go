package conquest

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/city-competition-remastered/backend/internal/user"
)

const (
	defaultSupporterLimit = 10
	maxSupporterLimit     = 50
)

// Attribution identifies the flip whose in-window supports should be tagged.
type Attribution struct {
	LogID            uuid.UUID
	IlCode           string
	WinningTribeID   uuid.UUID
	CausingSupportID uuid.UUID
	OccurredAt       time.Time
}

// Supporter is one ranked contributor to a specific capture.
type Supporter struct {
	UserID       uuid.UUID `json:"user_id"`
	DisplayName  string    `json:"display_name"`
	AvatarURL    string    `json:"avatar_url"`
	Contribution int64     `json:"contribution"`
	IsYou        bool      `json:"is_you"`
}

// SupportersResult is the GET /v1/conquest-log/{log_id}/supporters payload.
type SupportersResult struct {
	LogID                 uuid.UUID   `json:"log_id"`
	CausedFlip            bool        `json:"caused_flip"`
	Supporters            []Supporter `json:"supporters"`
	TotalContributorCount int         `json:"total_contributor_count"`
}

// AttributeSupportsOnTx tags the winning tribe's in-window supports with this
// conquest_log id and records which single spend crossed the flip threshold.
//
// Windowing rule (product decision): attribute every supports row for
// (winning_tribe_id, il_code) whose created_at is after the winning tribe last
// *lost* this city, up through the flipping spend (created_at <= occurred_at),
// and only rows that still have conquest_log_id IS NULL.
//
// "Last lost" is MAX(occurred_at) on conquest_log where previous_tribe_id is
// the winning tribe for this il_code (excluding the row just inserted). If they
// never lost the city (first capture), the window is all of that tribe's
// supports on this city. This is not lifetime totals: a recapture only includes
// spends since the opponent took the city, not the tribe's earlier tenure.
func (s *Store) AttributeSupportsOnTx(ctx context.Context, tx pgx.Tx, rec Attribution) error {
	if tx == nil {
		return fmt.Errorf("conquest attribution: nil tx")
	}
	if rec.LogID == uuid.Nil {
		return fmt.Errorf("conquest attribution: missing log id")
	}
	if rec.CausingSupportID == uuid.Nil {
		return fmt.Errorf("conquest attribution: missing causing support id")
	}

	var lastLost *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT MAX(occurred_at)
		FROM conquest_log
		WHERE il_code = $1
		  AND previous_tribe_id = $2
		  AND id <> $3
	`, rec.IlCode, rec.WinningTribeID, rec.LogID).Scan(&lastLost); err != nil {
		return fmt.Errorf("conquest attribution last-lost: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE supports
		SET conquest_log_id = $1
		WHERE tribe_id = $2
		  AND il_code = $3
		  AND conquest_log_id IS NULL
		  AND ($4::timestamptz IS NULL OR created_at > $4)
		  AND created_at <= $5
	`, rec.LogID, rec.WinningTribeID, rec.IlCode, lastLost, rec.OccurredAt); err != nil {
		return fmt.Errorf("conquest attribution tag supports: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE conquest_log
		SET causing_support_id = $2
		WHERE id = $1
	`, rec.LogID, rec.CausingSupportID); err != nil {
		return fmt.Errorf("conquest attribution causing support: %w", err)
	}
	return nil
}

// Supporters returns the winning tribe's contributors for one capture, ranked
// by summed credits_spent in the attributed window (not lifetime city totals).
func (s *Store) Supporters(ctx context.Context, logID, viewerID uuid.UUID, limit int) (SupportersResult, error) {
	out := SupportersResult{
		LogID:      logID,
		Supporters: []Supporter{},
	}
	pool := s.readPool()
	if pool == nil {
		return out, fmt.Errorf("conquest attribution: no pool configured")
	}
	limit = clampSupporterLimit(limit)

	var causedFlip bool
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(s.user_id = $2, false)
		FROM conquest_log cl
		LEFT JOIN supports s ON s.id = cl.causing_support_id
		WHERE cl.id = $1
	`, logID, viewerID).Scan(&causedFlip)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, ErrUnknownLog
		}
		return out, fmt.Errorf("conquest supporters lookup: %w", err)
	}
	out.CausedFlip = causedFlip

	rows, err := pool.Query(ctx, `
		SELECT s.user_id, u.username, u.avatar_url,
		       SUM(s.credits_spent)::bigint AS contribution,
		       COUNT(*) OVER() AS total_contributor_count
		FROM supports s
		JOIN users u ON u.id = s.user_id
		WHERE s.conquest_log_id = $1
		GROUP BY s.user_id, u.username, u.avatar_url
		ORDER BY SUM(s.credits_spent) DESC, s.user_id ASC
		LIMIT $2
	`, logID, limit)
	if err != nil {
		return out, fmt.Errorf("conquest supporters list: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var row Supporter
		var stored *string
		var total int
		if err := rows.Scan(&row.UserID, &row.DisplayName, &stored, &row.Contribution, &total); err != nil {
			return out, fmt.Errorf("scan conquest supporter: %w", err)
		}
		row.AvatarURL = user.ResolveAvatarURL(row.UserID, stored)
		row.IsYou = row.UserID == viewerID
		out.Supporters = append(out.Supporters, row)
		out.TotalContributorCount = total
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("iterate conquest supporters: %w", err)
	}
	if len(out.Supporters) == 0 {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT COUNT(DISTINCT user_id) FROM supports WHERE conquest_log_id = $1
		`, logID).Scan(&n); err != nil {
			return out, fmt.Errorf("conquest supporters count: %w", err)
		}
		out.TotalContributorCount = n
	}
	return out, nil
}

func clampSupporterLimit(limit int) int {
	if limit <= 0 {
		return defaultSupporterLimit
	}
	if limit > maxSupporterLimit {
		return maxSupporterLimit
	}
	return limit
}
