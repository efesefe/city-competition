package season

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ArchiveEntry is one ZSET member snapshot.
type ArchiveEntry struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

// Store persists season archive rows.
type Store struct {
	Pool *pgxpool.Pool
}

// InsertArchive upserts a scope snapshot. ON CONFLICT DO NOTHING for crash-safe re-runs.
// Returns true when a new row was inserted.
func (s *Store) InsertArchive(ctx context.Context, seasonID, redisKey, scopeType string, entries []ArchiveEntry) (bool, error) {
	if s == nil || s.Pool == nil {
		return false, fmt.Errorf("season store: pool nil")
	}
	if entries == nil {
		entries = []ArchiveEntry{}
	}
	raw, err := json.Marshal(entries)
	if err != nil {
		return false, fmt.Errorf("marshal entries: %w", err)
	}
	tag, err := s.Pool.Exec(ctx, `
		INSERT INTO season_archive (season_id, redis_key, scope_type, entries, member_count)
		VALUES ($1, $2, $3, $4::jsonb, $5)
		ON CONFLICT (season_id, redis_key) DO NOTHING
	`, seasonID, redisKey, scopeType, raw, len(entries))
	if err != nil {
		return false, fmt.Errorf("insert season_archive: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// CountBySeason returns how many archive rows exist for seasonID.
func (s *Store) CountBySeason(ctx context.Context, seasonID string) (int64, error) {
	if s == nil || s.Pool == nil {
		return 0, fmt.Errorf("season store: pool nil")
	}
	var n int64
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM season_archive WHERE season_id = $1
	`, seasonID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count season_archive: %w", err)
	}
	return n, nil
}
