# Expo + Fastify vertical slice

**Date:** 2026-11-15  
**Branch:** `cursor/map-auth-spend-slice-bbd0`  
**Why:** Product stack lock is Expo-only + Fastify + Fly FRA. This slice is the first runnable vertical path (map → auth → kabile → spend → flip) without rewriting the legacy Next/Go tree yet.

## Location

| Path | Role |
|------|------|
| `apps/api` | Fastify API, **Postgres** domain DB (`DATABASE_URL`), in-memory WS bus |
| `apps/client` | Expo Router web/mobile client |
| `apps/README.md` | Local runbook |
| [postgres-migration.md](postgres-migration.md) | SQLite → Postgres migration + Realtime ledger handoff |

## Behavior covered

- 81-province SVG map colored by ownership digest  
- Guest map + city sheet + scoreboard  
- Phone OTP (mock) + OAuth stubs; Kabile after verify (Big 4 first)  
- Always-confirm spend; idempotent ledger; live flip over WS  
- Daily 100 energy via claim / `grant-sim`  
- Seeds from `docs/city-seed-matrix.md` logic (2–3 teams)

## Not in this slice

Production Supabase project, Netgsm delivery, Redis, iyzico/IAP, match-day boosts, TR midnight cron worker.

Postgres is in: set `DATABASE_URL` (local `docker compose` in `apps/api`, or Neon / Fly MPG). See [postgres-migration.md](postgres-migration.md).

## Test

```bash
cd apps/api && docker compose up -d && DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition npm run dev
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
```

See `apps/README.md` for env and real-vs-stubbed table.

## Follow-up (web SVG)

Expo web crashed when province `Path` used `onPress` (RN responder props leaked into DOM). See [turkiye-map-web-svg.md](turkiye-map-web-svg.md).
