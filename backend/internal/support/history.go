package support

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultHistoryLimit = 20
	maxHistoryLimit     = 100
)

// SupportHistoryItem is one row of the authenticated user's support ledger.
type SupportHistoryItem struct {
	ID               uuid.UUID `json:"id"`
	IlCode           string    `json:"il_code"`
	TribeID          uuid.UUID `json:"tribe_id"`
	CreditsSpent     int64     `json:"credits_spent"`
	Multiplier       float64   `json:"multiplier"`
	EffectiveSupport float64   `json:"effective_support"`
	CreatedAt        time.Time `json:"created_at"`
}

type historyListResponse struct {
	Supports   []SupportHistoryItem `json:"supports"`
	NextOffset *int                 `json:"next_offset"`
}

// HistoryStore lists support history for a single user.
type HistoryStore struct {
	Pool *pgxpool.Pool
}

// ListMine returns the given user's supports newest-first. Caller must pass the
// session user id; client-supplied user ids are never used.
func (s *HistoryStore) ListMine(ctx context.Context, userID uuid.UUID, limit, offset int) ([]SupportHistoryItem, error) {
	if s == nil || s.Pool == nil {
		return nil, fmt.Errorf("support history: no pool configured")
	}
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	if limit > maxHistoryLimit {
		limit = maxHistoryLimit
	}
	if offset < 0 {
		offset = 0
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT id, il_code, tribe_id, credits_spent, multiplier::float8,
		       effective_support::float8, created_at
		FROM supports
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list support history: %w", err)
	}
	defer rows.Close()

	out := make([]SupportHistoryItem, 0)
	for rows.Next() {
		var item SupportHistoryItem
		if err := rows.Scan(
			&item.ID,
			&item.IlCode,
			&item.TribeID,
			&item.CreditsSpent,
			&item.Multiplier,
			&item.EffectiveSupport,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan support history: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate support history: %w", err)
	}
	return out, nil
}

func parseHistoryLimit(raw string) int {
	if raw == "" {
		return defaultHistoryLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultHistoryLimit
	}
	if n > maxHistoryLimit {
		return maxHistoryLimit
	}
	return n
}

func parseHistoryOffset(raw string) int {
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}
