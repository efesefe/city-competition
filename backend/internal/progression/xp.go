// Package progression implements XP ranks and event-driven quests (05.7 / 05.8).
package progression

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Event XP grants (not rank thresholds — those live in rank_tiers).
const (
	XPSupportApplied = 10
	XPDerbyResolved  = 25
	XPStreakAdvance  = 5
)

// RankTier is a content row from rank_tiers.
type RankTier struct {
	ID        uuid.UUID
	MinXP     int
	BadgeName string
	SortOrder int
}

// LookupRank returns the highest tier whose MinXP <= totalXP.
// If tiers is empty, returns a zero RankTier. Tiers need not be pre-sorted.
func LookupRank(tiers []RankTier, totalXP int) RankTier {
	var best RankTier
	found := false
	for _, t := range tiers {
		if t.MinXP > totalXP {
			continue
		}
		if !found || t.MinXP > best.MinXP || (t.MinXP == best.MinXP && t.SortOrder > best.SortOrder) {
			best = t
			found = true
		}
	}
	return best
}

// AwardResult is the outcome of AwardXP.
type AwardResult struct {
	TotalXP int
	Rank    RankTier
}

// Store loads tiers and mutates user_xp.
type Store struct {
	Pool *pgxpool.Pool
}

// LoadRankTiers returns all rank_tiers ordered by min_xp ascending.
func (s *Store) LoadRankTiers(ctx context.Context) ([]RankTier, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, min_xp, badge_name, sort_order
		FROM rank_tiers
		ORDER BY min_xp ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load rank_tiers: %w", err)
	}
	defer rows.Close()

	var out []RankTier
	for rows.Next() {
		var t RankTier
		if err := rows.Scan(&t.ID, &t.MinXP, &t.BadgeName, &t.SortOrder); err != nil {
			return nil, fmt.Errorf("scan rank_tier: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// AwardXP upserts user_xp by amount and returns the new total with resolved rank.
// amount <= 0 is a no-op that still returns current total + rank.
func (s *Store) AwardXP(ctx context.Context, userID uuid.UUID, amount int, _ string) (AwardResult, error) {
	tiers, err := s.LoadRankTiers(ctx)
	if err != nil {
		return AwardResult{}, err
	}

	var total int
	if amount > 0 {
		err = s.Pool.QueryRow(ctx, `
			INSERT INTO user_xp (user_id, total_xp, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (user_id) DO UPDATE SET
				total_xp = user_xp.total_xp + EXCLUDED.total_xp,
				updated_at = now()
			RETURNING total_xp
		`, userID, amount).Scan(&total)
	} else {
		err = s.Pool.QueryRow(ctx, `
			SELECT total_xp FROM user_xp WHERE user_id = $1
		`, userID).Scan(&total)
		if err == pgx.ErrNoRows {
			total = 0
			err = nil
		}
	}
	if err != nil {
		return AwardResult{}, fmt.Errorf("award xp: %w", err)
	}

	return AwardResult{
		TotalXP: total,
		Rank:    LookupRank(tiers, total),
	}, nil
}

// GetTotalXP returns the user's total XP (0 if no row).
func (s *Store) GetTotalXP(ctx context.Context, userID uuid.UUID) (int, error) {
	var total int
	err := s.Pool.QueryRow(ctx, `SELECT total_xp FROM user_xp WHERE user_id = $1`, userID).Scan(&total)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("get user_xp: %w", err)
	}
	return total, nil
}

// istanbul is used for quest period keys (same zone as support streaks).
var istanbul *time.Location

func init() {
	var err error
	istanbul, err = time.LoadLocation("Europe/Istanbul")
	if err != nil {
		istanbul = time.FixedZone("Europe/Istanbul", 3*60*60)
	}
}

// Istanbul returns the Europe/Istanbul location used for quest periods.
func Istanbul() *time.Location {
	return istanbul
}
