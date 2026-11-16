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

CC-35 (`persist-ledger-live-flips.md`) extends this schema with `002_ledger_boost_snapshot.sql` and hardens spend with `FOR UPDATE` + strict-lead flips. Do **not** duplicate `001_init`.
