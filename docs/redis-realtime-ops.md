# Redis for realtime ops (Upstash-compatible)

**Date:** 2026-11-16  
**Branch:** `cursor/upstash-redis-realtime-6aea`  
**Tracker:** CC-40 (Wave 2 — Add Upstash Redis for realtime ops)  
**Why:** Wire Redis for ownership pub/sub, OTP/spend rate limits, and 5-min alert coalesce buffers before multi-instance Fly deploy.

## What changed

| Area | Implementation |
|------|----------------|
| Client | `redis` (node-redis) via **`REDIS_URL`** — works with local Redis and Upstash `rediss://` |
| Pub/sub | Channel `cc:ownership` fans flip + digest JSON to every API process → local WS clients |
| Rate limits | Redis Lua token bucket: `support-spend`, `otp-start`, `otp-verify` |
| Coalesce | 5-min `SET NX EX` windows + buffer hashes; first event enqueues `notif_queue` (push worker later) |
| Health | `GET /health` → `{ redis: "PONG", db: "postgres" }` |

**Not required for local demo:** Upstash cloud account. Local `redis-server` or `docker compose` Redis is enough.

## Run

```bash
cd apps/api
docker compose up -d          # postgres + redis
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
npm install && npm run dev
```

Upstash / managed: set `REDIS_URL` to the TLS URL (`rediss://…`).

## Keys / channels

| Key / channel | Purpose |
|---------------|---------|
| `cc:ownership` | Pub/sub: `{type:"flip"\|"digest",…}` |
| `ratelimit:{subject}:{group}` | Token-bucket HASH |
| `coalesce:{kind}:{plate}:{audience}` | Window lock (TTL 300s) |
| `coalesce:buf:…` | Burst counters + metadata |
| `notif_queue` | LPUSH queue for future push worker |

## Real vs stub

| Piece | Status |
|-------|--------|
| Redis connect + ping | **Real** |
| Multi-instance WS fan-out via pub/sub | **Real** |
| Spend / OTP rate limits (429 + Retry-After) | **Real** |
| 5-min coalesce buffers + `notif_queue` enqueue | **Real hooks** |
| Expo Push / APNs / FCM delivery | **Stub** (worker leaf later) |
| Digest cache warm path | Key reserved; spend still reads Postgres digest |

## Follow-up

CC-35: harden Postgres ledger + `FOR UPDATE` flips; keep publishing through this bus.
