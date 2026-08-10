// Package leaderboard implements Redis ZSET supporter boards and standings reads (05.1–05.5).
package leaderboard

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	keyGlobalSupporters = "lb:global:supporters"
	keyTribeFmt         = "lb:tribe:%s:supporters"
	keyProvinceFmt      = "lb:province:%s:supporters"
	keyDerbyFmt         = "lb:derby:%s:supporters"
)

// Entry is one ZSET member with score.
type Entry struct {
	Member string
	Score  float64
}

// RankResult is a member's reverse rank (0-based) and score.
type RankResult struct {
	Rank  int64
	Score float64
}

// LeaderboardStore is a reusable Redis ZSET store parameterized by scope key.
type LeaderboardStore struct {
	RDB redis.Cmdable
}

// GlobalKey returns lb:global:supporters.
func GlobalKey() string { return keyGlobalSupporters }

// TribeKey returns lb:tribe:{tribe_id}:supporters.
func TribeKey(tribeID uuid.UUID) string {
	return fmt.Sprintf(keyTribeFmt, tribeID.String())
}

// ProvinceKey returns lb:province:{il_code}:supporters.
func ProvinceKey(ilCode string) string {
	return fmt.Sprintf(keyProvinceFmt, ilCode)
}

// DerbyKey returns lb:derby:{derby_id}:supporters.
func DerbyKey(derbyID uuid.UUID) string {
	return fmt.Sprintf(keyDerbyFmt, derbyID.String())
}

// Incr adds delta to member's score in the given ZSET key.
func (s *LeaderboardStore) Incr(ctx context.Context, key, member string, delta float64) error {
	if s == nil || s.RDB == nil {
		return fmt.Errorf("leaderboard store: redis nil")
	}
	if key == "" || member == "" {
		return fmt.Errorf("leaderboard store: empty key or member")
	}
	if err := s.RDB.ZIncrBy(ctx, key, delta, member).Err(); err != nil {
		return fmt.Errorf("zincrby %s: %w", key, err)
	}
	return nil
}

// Top returns up to limit members ordered by score descending (highest first).
func (s *LeaderboardStore) Top(ctx context.Context, key string, limit int64) ([]Entry, error) {
	if s == nil || s.RDB == nil {
		return nil, fmt.Errorf("leaderboard store: redis nil")
	}
	if limit <= 0 {
		return nil, nil
	}
	vals, err := s.RDB.ZRevRangeWithScores(ctx, key, 0, limit-1).Result()
	if err != nil {
		return nil, fmt.Errorf("zrevrange %s: %w", key, err)
	}
	out := make([]Entry, 0, len(vals))
	for _, z := range vals {
		member, ok := z.Member.(string)
		if !ok {
			member = fmt.Sprint(z.Member)
		}
		out = append(out, Entry{Member: member, Score: z.Score})
	}
	return out, nil
}

// Rank returns 0-based reverse rank and score via ZREVRANK + ZSCORE (no full scan).
// Returns redis.Nil wrapped when the member is absent.
func (s *LeaderboardStore) Rank(ctx context.Context, key, member string) (RankResult, error) {
	if s == nil || s.RDB == nil {
		return RankResult{}, fmt.Errorf("leaderboard store: redis nil")
	}
	pipe := s.RDB.Pipeline()
	rankCmd := pipe.ZRevRank(ctx, key, member)
	scoreCmd := pipe.ZScore(ctx, key, member)
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return RankResult{}, fmt.Errorf("rank pipeline %s: %w", key, err)
	}
	rank, err := rankCmd.Result()
	if err != nil {
		return RankResult{}, err
	}
	score, err := scoreCmd.Result()
	if err != nil {
		return RankResult{}, err
	}
	return RankResult{Rank: rank, Score: score}, nil
}

// Score returns the member's score, or redis.Nil when absent.
func (s *LeaderboardStore) Score(ctx context.Context, key, member string) (float64, error) {
	if s == nil || s.RDB == nil {
		return 0, fmt.Errorf("leaderboard store: redis nil")
	}
	score, err := s.RDB.ZScore(ctx, key, member).Result()
	if err != nil {
		return 0, err
	}
	return score, nil
}
