package support

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	provinceControlKeyFmt     = "province_control:%s"
	provinceControlLockKeyFmt = "province_control_lock:%s"
	provinceControlTTL        = 300 * time.Second
	provinceControlLockTTL    = 2 * time.Second
	stampedeRetryInterval     = 25 * time.Millisecond
	stampedeMaxWait           = 2 * time.Second
)

// TribeControlScore is one tribe's share of effective support in a province.
type TribeControlScore struct {
	TribeID             uuid.UUID `json:"tribe_id"`
	EffectiveSupportSum float64   `json:"effective_support_sum"`
	ControlPct          float64   `json:"control_pct"`
}

// ProvinceControl is the cached control snapshot for one il_code.
type ProvinceControl struct {
	IlCode         string              `json:"il_code"`
	LeadingTribeID *uuid.UUID          `json:"leading_tribe_id"`
	ControlPct     float64             `json:"control_pct"`
	Tribes         []TribeControlScore `json:"tribes"`
}

// ControlCache is a Redis cache-aside layer in front of tribe_province_scores reads.
type ControlCache struct {
	RDB     redis.Cmdable
	Pool    *pgxpool.Pool
	TTL     time.Duration
	LockTTL time.Duration

	// LoadScores is optional; when nil, scores are loaded from Pool.
	LoadScores func(ctx context.Context, ilCode string) ([]TribeControlScore, error)
}

func provinceControlKey(ilCode string) string {
	return fmt.Sprintf(provinceControlKeyFmt, ilCode)
}

func provinceControlLockKey(ilCode string) string {
	return fmt.Sprintf(provinceControlLockKeyFmt, ilCode)
}

func (c *ControlCache) ttl() time.Duration {
	if c.TTL > 0 {
		return c.TTL
	}
	return provinceControlTTL
}

func (c *ControlCache) lockTTL() time.Duration {
	if c.LockTTL > 0 {
		return c.LockTTL
	}
	return provinceControlLockTTL
}

// Get returns province control for il_code, checking Redis first and falling back to Postgres on miss.
func (c *ControlCache) Get(ctx context.Context, ilCode string) (*ProvinceControl, error) {
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return nil, ErrInvalidIlCode
	}
	if c.RDB == nil {
		return c.loadAndBuild(ctx, ilCode)
	}

	key := provinceControlKey(ilCode)
	if pc, ok, err := c.getCached(ctx, key); err != nil {
		return nil, err
	} else if ok {
		return pc, nil
	}

	lockKey := provinceControlLockKey(ilCode)
	acquired, err := c.RDB.SetNX(ctx, lockKey, "1", c.lockTTL()).Result()
	if err != nil {
		return nil, fmt.Errorf("acquire province control lock: %w", err)
	}
	if acquired {
		defer func() { _ = c.RDB.Del(ctx, lockKey) }()
		pc, err := c.loadAndBuild(ctx, ilCode)
		if err != nil {
			return nil, err
		}
		if err := c.setCached(ctx, key, pc); err != nil {
			return nil, err
		}
		return pc, nil
	}

	deadline := time.Now().Add(stampedeMaxWait)
	for time.Now().Before(deadline) {
		if pc, ok, err := c.getCached(ctx, key); err != nil {
			return nil, err
		} else if ok {
			return pc, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(stampedeRetryInterval):
		}
	}

	// Lock holder failed or timed out; try once more to take the lock, else load without caching.
	acquired, err = c.RDB.SetNX(ctx, lockKey, "1", c.lockTTL()).Result()
	if err != nil {
		return nil, fmt.Errorf("re-acquire province control lock: %w", err)
	}
	if acquired {
		defer func() { _ = c.RDB.Del(ctx, lockKey) }()
		pc, err := c.loadAndBuild(ctx, ilCode)
		if err != nil {
			return nil, err
		}
		if err := c.setCached(ctx, key, pc); err != nil {
			return nil, err
		}
		return pc, nil
	}

	return c.loadAndBuild(ctx, ilCode)
}

// Invalidate removes the cached control snapshot for il_code (push-based freshness after spends).
func (c *ControlCache) Invalidate(ctx context.Context, ilCode string) error {
	if c == nil || c.RDB == nil {
		return nil
	}
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return nil
	}
	if err := c.RDB.Del(ctx, provinceControlKey(ilCode)).Err(); err != nil {
		return fmt.Errorf("invalidate province control: %w", err)
	}
	return nil
}

func (c *ControlCache) getCached(ctx context.Context, key string) (*ProvinceControl, bool, error) {
	raw, err := c.RDB.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get province control cache: %w", err)
	}
	var pc ProvinceControl
	if err := json.Unmarshal(raw, &pc); err != nil {
		return nil, false, fmt.Errorf("decode province control cache: %w", err)
	}
	return &pc, true, nil
}

func (c *ControlCache) setCached(ctx context.Context, key string, pc *ProvinceControl) error {
	raw, err := json.Marshal(pc)
	if err != nil {
		return fmt.Errorf("encode province control cache: %w", err)
	}
	if err := c.RDB.Set(ctx, key, raw, c.ttl()).Err(); err != nil {
		return fmt.Errorf("set province control cache: %w", err)
	}
	return nil
}

func (c *ControlCache) loadAndBuild(ctx context.Context, ilCode string) (*ProvinceControl, error) {
	scores, err := c.loadTribeScores(ctx, ilCode)
	if err != nil {
		return nil, err
	}
	return buildProvinceControl(ilCode, scores), nil
}

func (c *ControlCache) loadTribeScores(ctx context.Context, ilCode string) ([]TribeControlScore, error) {
	if c.LoadScores != nil {
		return c.LoadScores(ctx, ilCode)
	}
	if c.Pool == nil {
		return nil, fmt.Errorf("province control cache: no pool configured")
	}
	rows, err := c.Pool.Query(ctx, `
		SELECT tribe_id, effective_support_sum::float8
		FROM tribe_province_scores
		WHERE il_code = $1
		ORDER BY effective_support_sum DESC, tribe_id ASC
	`, ilCode)
	if err != nil {
		return nil, fmt.Errorf("load tribe_province_scores: %w", err)
	}
	defer rows.Close()

	var scores []TribeControlScore
	for rows.Next() {
		var s TribeControlScore
		if err := rows.Scan(&s.TribeID, &s.EffectiveSupportSum); err != nil {
			return nil, fmt.Errorf("scan tribe_province_scores: %w", err)
		}
		scores = append(scores, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tribe_province_scores: %w", err)
	}
	return scores, nil
}

func buildProvinceControl(ilCode string, scores []TribeControlScore) *ProvinceControl {
	pc := &ProvinceControl{
		IlCode: ilCode,
		Tribes: scores,
	}
	if len(scores) == 0 {
		pc.Tribes = []TribeControlScore{}
		return pc
	}

	var total float64
	for _, s := range scores {
		total += s.EffectiveSupportSum
	}
	if total <= 0 {
		pc.Tribes = make([]TribeControlScore, len(scores))
		copy(pc.Tribes, scores)
		return pc
	}

	out := make([]TribeControlScore, len(scores))
	for i, s := range scores {
		s.ControlPct = s.EffectiveSupportSum / total
		out[i] = s
	}
	pc.Tribes = out
	leading := out[0].TribeID
	pc.LeadingTribeID = &leading
	pc.ControlPct = out[0].ControlPct
	return pc
}
