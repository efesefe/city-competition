package leaderboard

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/moderation"
)

// UserProfile is the public display row for a leaderboard member.
type UserProfile struct {
	Username       string
	RestrictedMode bool
	Status         string
}

// ProfileLookup loads username + restricted_mode for user IDs.
type ProfileLookup interface {
	Profiles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]UserProfile, error)
}

// PoolProfiles loads profiles from Postgres.
type PoolProfiles struct {
	Pool *pgxpool.Pool
}

// Profiles returns a map keyed by user id. Missing users are omitted.
func (p *PoolProfiles) Profiles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]UserProfile, error) {
	out := make(map[uuid.UUID]UserProfile, len(ids))
	if p == nil || p.Pool == nil || len(ids) == 0 {
		return out, nil
	}
	rows, err := p.Pool.Query(ctx, `
		SELECT id, username, restricted_mode, status
		FROM users
		WHERE id = ANY($1)
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("load leaderboard profiles: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var profile UserProfile
		if err := rows.Scan(&id, &profile.Username, &profile.RestrictedMode, &profile.Status); err != nil {
			return nil, err
		}
		out[id] = profile
	}
	return out, rows.Err()
}

// PublicVisible reports whether a profile may appear on public boards.
// Excludes age-gate restricted_mode and shadow_banned / banned accounts.
func PublicVisible(p UserProfile) bool {
	_ = auth.LeaderboardExcludeRestrictedSQL
	if p.RestrictedMode {
		return false
	}
	switch p.Status {
	case moderation.StatusShadowBanned, moderation.StatusBanned:
		return false
	default:
		return true
	}
}

func parseUserIDs(members []string) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(members))
	seen := make(map[uuid.UUID]struct{}, len(members))
	for _, m := range members {
		id, err := uuid.Parse(strings.TrimSpace(m))
		if err != nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}
