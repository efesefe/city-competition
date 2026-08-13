package conquest

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	momentumCacheKeyPrefix = "city_momentum:"
	defaultMomentumTTL     = 15 * time.Second
)

// istanbul is the calendar zone for flips_today and holding-streak day boundaries.
var istanbul *time.Location

func init() {
	var err error
	istanbul, err = time.LoadLocation("Europe/Istanbul")
	if err != nil {
		istanbul = time.FixedZone("Europe/Istanbul", 3*60*60)
	}
}

// Istanbul returns the Europe/Istanbul location used for flip-day boundaries.
func Istanbul() *time.Location {
	return istanbul
}

// CityMomentum is derived flip frequency and holding streak for one city.
// Source of truth is conquest_log — Redis is a short TTL cache only.
type CityMomentum struct {
	IlCode            string `json:"il_code"`
	FlipsToday        int    `json:"flips_today"`
	CurrentStreakDays int    `json:"current_streak_days"`
}

// MomentumStore computes per-city flips_today and current_streak_days from conquest_log.
type MomentumStore struct {
	Pool *pgxpool.Pool
	Read *pgxpool.Pool
	RDB  redis.Cmdable
	Now  func() time.Time
	TTL  time.Duration
}

func (s *MomentumStore) readPool() *pgxpool.Pool {
	if s != nil && s.Read != nil {
		return s.Read
	}
	if s != nil {
		return s.Pool
	}
	return nil
}

func (s *MomentumStore) now() time.Time {
	if s != nil && s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

func (s *MomentumStore) ttl() time.Duration {
	if s != nil && s.TTL > 0 {
		return s.TTL
	}
	return defaultMomentumTTL
}

func momentumCacheKey(now time.Time) string {
	d := now.In(istanbul)
	return momentumCacheKeyPrefix + d.Format("2006-01-02")
}

func istanbulDayBounds(now time.Time) (start, end time.Time) {
	in := now.In(istanbul)
	start = time.Date(in.Year(), in.Month(), in.Day(), 0, 0, 0, 0, istanbul)
	end = start.AddDate(0, 0, 1)
	return start, end
}

func istanbulDate(t time.Time) time.Time {
	in := t.In(istanbul)
	return time.Date(in.Year(), in.Month(), in.Day(), 0, 0, 0, 0, istanbul)
}

func streakDays(now, lastFlip time.Time) int {
	start := istanbulDate(lastFlip)
	today := istanbulDate(now)
	if !today.After(start) {
		return 0
	}
	days := int(today.Sub(start) / (24 * time.Hour))
	if days < 0 {
		return 0
	}
	return days
}

// ContestTension is the second-place tribe's committed_credits as a fraction of
// the flip-margin threshold (the current leader's committed_credits). Returns a
// value in [0, 1]. Uncontrolled cities and cities with no challenger are 0.
// Not pre-bucketed — the frontend chooses visual thresholds.
func ContestTension(first, second float64) float64 {
	if first <= 0 || second <= 0 {
		return 0
	}
	t := second / first
	if t > 1 {
		return 1
	}
	return t
}

// Stats returns flips_today and current_streak_days keyed by il_code.
// Cities with no conquest_log rows are omitted (callers treat missing as zeros).
// current_streak_days is Istanbul calendar days since the city's latest flip
// (a capture today → 0; captured 5 Istanbul days ago → 5).
func (s *MomentumStore) Stats(ctx context.Context) (map[string]CityMomentum, error) {
	if s == nil {
		return map[string]CityMomentum{}, nil
	}
	now := s.now()
	if s.RDB != nil {
		raw, err := s.RDB.Get(ctx, momentumCacheKey(now)).Bytes()
		if err == nil {
			var cached map[string]CityMomentum
			if json.Unmarshal(raw, &cached) == nil && cached != nil {
				return cached, nil
			}
		} else if err != redis.Nil {
			// Fall through to Postgres on Redis errors.
		}
	}

	out, err := s.loadStats(ctx, now)
	if err != nil {
		return nil, err
	}
	if s.RDB != nil {
		payload, err := json.Marshal(out)
		if err == nil {
			_ = s.RDB.Set(ctx, momentumCacheKey(now), payload, s.ttl()).Err()
		}
	}
	return out, nil
}

func (s *MomentumStore) loadStats(ctx context.Context, now time.Time) (map[string]CityMomentum, error) {
	pool := s.readPool()
	if pool == nil {
		return nil, fmt.Errorf("momentum: no pool configured")
	}
	start, end := istanbulDayBounds(now)

	rows, err := pool.Query(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (il_code)
				il_code, occurred_at
			FROM conquest_log
			ORDER BY il_code, occurred_at DESC, id DESC
		),
		today AS (
			SELECT il_code, COUNT(*)::int AS flips_today
			FROM conquest_log
			WHERE occurred_at >= $1 AND occurred_at < $2
			GROUP BY il_code
		)
		SELECT
			COALESCE(l.il_code, t.il_code) AS il_code,
			COALESCE(t.flips_today, 0) AS flips_today,
			l.occurred_at
		FROM latest l
		FULL OUTER JOIN today t ON t.il_code = l.il_code
	`, start, end)
	if err != nil {
		return nil, fmt.Errorf("momentum stats: %w", err)
	}
	defer rows.Close()

	out := make(map[string]CityMomentum)
	for rows.Next() {
		var (
			m        CityMomentum
			lastFlip *time.Time
		)
		if err := rows.Scan(&m.IlCode, &m.FlipsToday, &lastFlip); err != nil {
			return nil, fmt.Errorf("scan momentum: %w", err)
		}
		if lastFlip != nil {
			m.CurrentStreakDays = streakDays(now, *lastFlip)
		}
		out[m.IlCode] = m
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate momentum: %w", err)
	}
	return out, nil
}

// Invalidate drops the Redis cache for the current Istanbul day so the next
// Stats call recomputes from conquest_log. Best-effort; a miss is not an error.
func (s *MomentumStore) Invalidate(ctx context.Context) error {
	if s == nil || s.RDB == nil {
		return nil
	}
	return s.RDB.Del(ctx, momentumCacheKey(s.now())).Err()
}
