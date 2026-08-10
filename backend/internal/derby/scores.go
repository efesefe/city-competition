package derby

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const ActiveDerbiesKey = "active_derbies"

// ScoreKey returns derby_score:{id}:host or :guest.
func ScoreKey(derbyID uuid.UUID, side string) string {
	return "derby_score:" + derbyID.String() + ":" + side
}

// InitScores zeros host/guest counters and marks the derby active in Redis.
func InitScores(ctx context.Context, rdb redis.Cmdable, derbyID uuid.UUID) error {
	if rdb == nil {
		return nil
	}
	pipe := rdb.Pipeline()
	pipe.Set(ctx, ScoreKey(derbyID, "host"), "0", 0)
	pipe.Set(ctx, ScoreKey(derbyID, "guest"), "0", 0)
	pipe.SAdd(ctx, ActiveDerbiesKey, derbyID.String())
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("init derby scores: %w", err)
	}
	return nil
}

// GetScores reads host/guest Redis counters (missing keys → 0).
func GetScores(ctx context.Context, rdb redis.Cmdable, derbyID uuid.UUID) (host, guest float64, err error) {
	if rdb == nil {
		return 0, 0, nil
	}
	vals, err := rdb.MGet(ctx, ScoreKey(derbyID, "host"), ScoreKey(derbyID, "guest")).Result()
	if err != nil {
		return 0, 0, fmt.Errorf("get derby scores: %w", err)
	}
	host, err = parseScore(vals[0])
	if err != nil {
		return 0, 0, err
	}
	guest, err = parseScore(vals[1])
	if err != nil {
		return 0, 0, err
	}
	return host, guest, nil
}

func parseScore(v any) (float64, error) {
	if v == nil {
		return 0, nil
	}
	switch t := v.(type) {
	case string:
		if t == "" {
			return 0, nil
		}
		return strconv.ParseFloat(t, 64)
	case []byte:
		if len(t) == 0 {
			return 0, nil
		}
		return strconv.ParseFloat(string(t), 64)
	default:
		return strconv.ParseFloat(fmt.Sprint(t), 64)
	}
}

// IncrScore adds delta to the host or guest counter. Exported for Sprint 5 multiplier path.
func IncrScore(ctx context.Context, rdb redis.Cmdable, derbyID uuid.UUID, side string, delta float64) error {
	if rdb == nil || delta == 0 {
		return nil
	}
	if side != "host" && side != "guest" {
		return fmt.Errorf("invalid derby score side %q", side)
	}
	if err := rdb.IncrByFloat(ctx, ScoreKey(derbyID, side), delta).Err(); err != nil {
		return fmt.Errorf("incr derby score: %w", err)
	}
	return nil
}

// ExpireScores sets TTL on score keys and removes the derby from active_derbies.
// Keys are not deleted immediately so resolve can be retried after a crash.
func ExpireScores(ctx context.Context, rdb redis.Cmdable, derbyID uuid.UUID, ttl time.Duration) error {
	if rdb == nil {
		return nil
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	pipe := rdb.Pipeline()
	pipe.Expire(ctx, ScoreKey(derbyID, "host"), ttl)
	pipe.Expire(ctx, ScoreKey(derbyID, "guest"), ttl)
	pipe.SRem(ctx, ActiveDerbiesKey, derbyID.String())
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("expire derby scores: %w", err)
	}
	return nil
}
