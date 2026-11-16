import { getRedis, KEYS } from "./redis.js";

/** Token-bucket policy (sustained rate + burst). Mirrors Go backend shape. */
export type Limit = {
  rate: number; // tokens per second
  burst: number;
};

export type RateResult = {
  allowed: boolean;
  retryAfterSec: number;
};

export const GROUPS = {
  supportSpend: "support-spend",
  otpStart: "otp-start",
  otpVerify: "otp-verify",
} as const;

export const DEFAULT_LIMITS: Record<keyof typeof GROUPS, Limit> = {
  supportSpend: { rate: 2, burst: 8 }, // ~2 spends/sec sustained, burst 8
  otpStart: { rate: 1 / 30, burst: 3 }, // ~1 / 30s, burst 3
  otpVerify: { rate: 1 / 5, burst: 5 },
};

/**
 * Lua: atomic refill + take-one. HASH fields: tokens, last_ms.
 * Uses Redis TIME so clocks stay consistent across instances.
 */
const TOKEN_BUCKET_LUA = `
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
  if elapsed < 0 then elapsed = 0 end
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
  if retry_after < 1 then retry_after = 1 end
end

redis.call('HSET', key, 'tokens', tokens, 'last_ms', last_ms)
local ttl = math.ceil(burst / rate) + 60
if ttl < 60 then ttl = 60 end
redis.call('EXPIRE', key, ttl)

return {allowed, retry_after}
`;

export async function allow(
  subject: string,
  group: string,
  lim: Limit,
): Promise<RateResult> {
  if (lim.rate <= 0 || lim.burst < 1) {
    throw new Error(`invalid limit rate=${lim.rate} burst=${lim.burst}`);
  }
  const r = await getRedis();
  const raw = (await r.eval(TOKEN_BUCKET_LUA, {
    keys: [KEYS.rateLimit(subject, group)],
    arguments: [String(lim.rate), String(lim.burst)],
  })) as [number, number];

  const allowed = Number(raw[0]) === 1;
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Number(raw[1]) || 1,
  };
}
