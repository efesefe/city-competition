package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Route group names used in Redis keys and logs.
const (
	GroupSupportSpend = "support-spend"
	GroupCreditWrite  = "credit-write"
)

// Limit describes a token-bucket policy (sustained rate + burst capacity).
type Limit struct {
	Rate  float64 // tokens per second
	Burst int64
}

// Result is the outcome of an Allow call.
type Result struct {
	Allowed    bool
	RetryAfter time.Duration
}

// Bucket is a Redis-backed token bucket limiter.
type Bucket struct {
	RDB redis.Cmdable
}

// Lua: atomic refill + take-one. HASH fields: tokens, last_ms.
// Uses Redis TIME so miniredis FastForward advances the bucket clock.
// KEYS[1] = ratelimit key
// ARGV[1] = rate (tokens/sec), ARGV[2] = burst
// Returns: {allowed (0|1), retry_after_sec}
var tokenBucketScript = redis.NewScript(`
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])

local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local data = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens = tonumber(data[1])
local last_ms = tonumber(data[2])

if tokens == nil or last_ms == nil then
  tokens = burst
  last_ms = now_ms
else
  local elapsed = (now_ms - last_ms) / 1000.0
  if elapsed < 0 then
    elapsed = 0
  end
  tokens = math.min(burst, tokens + elapsed * rate)
  last_ms = now_ms
end

local allowed = 0
local retry_after = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  local need = 1 - tokens
  retry_after = math.ceil(need / rate)
  if retry_after < 1 then
    retry_after = 1
  end
end

redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
-- TTL: enough to hold a full bucket refill plus idle slack
local ttl = math.ceil(burst / rate) + 60
if ttl < 60 then
  ttl = 60
end
redis.call('EXPIRE', key, ttl)

return {allowed, retry_after}
`)

func bucketKey(userID, routeGroup string) string {
	return fmt.Sprintf("ratelimit:%s:%s", userID, routeGroup)
}

// Allow attempts to consume one token for userID in routeGroup under lim.
func (b *Bucket) Allow(ctx context.Context, userID, routeGroup string, lim Limit) (Result, error) {
	if lim.Rate <= 0 || lim.Burst < 1 {
		return Result{}, fmt.Errorf("invalid limit: rate=%v burst=%d", lim.Rate, lim.Burst)
	}

	raw, err := tokenBucketScript.Run(ctx, b.RDB, []string{bucketKey(userID, routeGroup)},
		lim.Rate, lim.Burst,
	).Result()
	if err != nil {
		return Result{}, err
	}

	arr, ok := raw.([]interface{})
	if !ok || len(arr) != 2 {
		return Result{}, fmt.Errorf("unexpected script result: %T %#v", raw, raw)
	}

	allowed, err := toInt64(arr[0])
	if err != nil {
		return Result{}, err
	}
	retrySec, err := toInt64(arr[1])
	if err != nil {
		return Result{}, err
	}

	if allowed == 1 {
		return Result{Allowed: true}, nil
	}
	return Result{
		Allowed:    false,
		RetryAfter: time.Duration(retrySec) * time.Second,
	}, nil
}

func toInt64(v interface{}) (int64, error) {
	switch n := v.(type) {
	case int64:
		return n, nil
	case int:
		return int64(n), nil
	case float64:
		return int64(n), nil
	default:
		return 0, fmt.Errorf("not an int: %T", v)
	}
}
