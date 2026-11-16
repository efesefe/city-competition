# Persist ledger and live flips (CC-35)

**Date:** 2026-11-16  
**Branch:** `cursor/persist-ledger-live-flips-6aea` (stacked on Redis CC-40)  
**Tracker:** CC-35  
**Why:** Harden the Postgres spend path from #33 — race-safe ownership flips, boost snapshot columns, Redis fan-out already from CC-40.

## What #33 already had (do not duplicate)

- `support_ledger` append-only + `UNIQUE (idempotency_key)`
- `city_support` cumulative tallies (persist across flips)
- One transaction: debit + tally + optional owner flip + ledger row

## What this leaf adds

| Hardening | Detail |
|-----------|--------|
| `SELECT … FOR UPDATE` | City row + all `city_support` rows for the plate; user row on debit |
| Incumbent-wins ties | Flip only when challenger support is **strictly greater** than incumbent |
| Upsert tally | `INSERT … ON CONFLICT DO UPDATE` for `city_support` |
| Boost snapshot cols | Migration `002_ledger_boost_snapshot.sql`: `personal_boost_pct`, `team_boost_pct` (default `1.0`) |
| Live fan-out | Flip + digest publish on Redis `cc:ownership` (CC-40); warm `cc:digest:cache` TTL 30s |
| Idempotency | Pre-check + in-tx check + unique violation `23505` → replay |

## Still stub / later

- Personal shop boost and match-day team boost values (snapshot helpers return `1.0`)
- Push delivery worker (coalesce queue from CC-40)
- Client map work (avoid `apps/client` — parallel map PR)

## Run

Same as Redis leaf — both env vars required:

```bash
cd apps/api
docker compose up -d
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
npm install && npm run dev
# boot applies migrations/002_*.sql when pending
```

## Test

1. Spend with new `idempotencyKey` → ledger row + optional flip WS/Redis event  
2. Replay same key → `idempotentReplay: true`, no second debit  
3. Concurrent rivalry: owner only changes on strict lead  
4. `\d support_ledger` shows boost columns after migrate

See also [idempotent-spend.md](idempotent-spend.md) (CC-37 concurrent load/single-flight).
