# Harden idempotent spend API (CC-37)

**Date:** 2026-11-16  
**Branch:** `cursor/harden-idempotent-spend-6b74`  
**Tracker:** CC-37  
**Why:** Prove concurrent spends stay idempotent with correct tallies under load; close HTTP retry gaps on top of CC-35.

## Already on main (do not redo)

From **#35** / [persist-ledger-live-flips.md](persist-ledger-live-flips.md) (merged):

- Append-only `support_ledger` + `UNIQUE (idempotency_key)`
- One Postgres transaction: debit + `city_support` upsert + optional strict-lead flip + ledger insert
- `SELECT … FOR UPDATE` on city, city support rows, and user
- Idempotency: pre-check + in-tx check + unique violation `23505` → replay
- Redis live flip / digest fan-out

**#38** (open) is WebSocket city digest only — not spend-ledger work. Map client left untouched.

## What this leaf adds

| Hardening | Detail |
|-----------|--------|
| Process single-flight | Concurrent same `idempotencyKey` shares one in-process pipeline (`src/lib/idempotency.ts`) |
| HTTP rate-limit skip | Committed keys skip the spend token bucket so retries are not 429’d |
| HTTP single-flight | `userId + key` coalesces double-taps before rate limit |
| Replay payload | Replay returns original `energySpent` / `supportCredited` / boost snapshot |
| `buildApp` export | `src/app.ts` shared by server boot and inject-based smoke tests |
| Load / smoke tests | `npm run test:spend-load` — same-key, distinct-key, rival contention, HTTP inject |

## Run tests

```bash
cd apps/api
docker compose up -d   # or local Postgres 16 + Redis 7
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
export PG_POOL_MAX=40
npm install
npm run migrate
npm run test:spend-load
npm run typecheck
```

## Still stub / later

- Personal / match-day boost values (snapshot helpers still `1.0`)
- Cross-instance single-flight (DB UNIQUE remains the authority)
- Map / Expo client changes (out of scope — parallel map harden)
