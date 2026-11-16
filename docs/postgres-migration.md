# API data → Postgres

**Date:** 2026-11-16  
**Branch:** `cursor/migrate-api-postgres-4897`  
**Tracker:** CC-39 (Wave 1 — Ship Fly Postgres production path)  
**Why:** Replace slice SQLite with Postgres so local + Neon/Fly MPG share one schema before Redis/Fly deploy leaves.

## What changed

| Before | After |
|--------|--------|
| `better-sqlite3` file DB (`SQLITE_PATH`) | `pg` pool via **`DATABASE_URL`** |
| Sync `prepare().get/run` | Async queries + `withTransaction` |
| Inline `CREATE TABLE` in `db.ts` | Versioned SQL in `apps/api/migrations/` |
| Native compile in Docker | Slim Node image (no g++ for sqlite) |

**Unchanged:** HTTP/WS routes and Expo client JSON shapes (map digest, city sheet, spend, auth stubs).

## Tables (001_init)

`teams`, `cities`, `city_support`, `users`, `otp_codes`, `sessions`, `support_ledger`, `tunables`, `schema_migrations`.

Boot path: `initDb()` applies pending `migrations/*.sql`, then seeds teams + 81-city matrix if `teams` is empty.

## Run

```bash
cd apps/api
docker compose up -d
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
npm install && npm run dev
```

Managed: set `DATABASE_URL` to Neon (EU) or Fly MPG; add `DATABASE_SSL=true` when required.

## Realtime handoff — Persist ledger and live flips

Already in this schema / spend path:

- **`support_ledger`** — append-only; **`UNIQUE (idempotency_key)`**; city + user indexes  
- **`city_support`** — materialized cumulative team support (persists across ownership flips)  
- Spend writes debit + tally + optional `cities.owner_team_id` flip + ledger row in **one Postgres transaction**  
- WS fan-out moved to Redis pub/sub — see [redis-realtime-ops.md](redis-realtime-ops.md)

Next leaf (CC-35 Persist ledger and live flips) should:

1. Keep spend atomicity (do not split ledger vs flip across processes without outbox)  
2. Add boost snapshot columns on ledger when personal/team boosts land  
3. Reconnect = digest fetch + WS resume (pub/sub already live)  
4. Add `SELECT … FOR UPDATE` on city/support rows under derby load  

Do **not** duplicate the `001_init` schema — extend with a new migration only when columns are needed.
