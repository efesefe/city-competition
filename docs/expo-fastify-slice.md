# Expo + Fastify vertical slice

**Date:** 2026-11-15  
**Branch:** `cursor/map-auth-spend-slice-bbd0`  
**Why:** Product stack lock is Expo-only + Fastify + Fly FRA. This slice is the first runnable vertical path (map → auth → kabile → spend → flip) without rewriting the legacy Next/Go tree yet.

## Location

| Path | Role |
|------|------|
| `apps/api` | Fastify API, **Postgres** (`DATABASE_URL`) + **Redis** (`REDIS_URL`) WS bus |
| `apps/client` | Expo Router web/mobile client |
| `apps/README.md` | Local runbook |
| [postgres-migration.md](postgres-migration.md) | SQLite → Postgres migration + Realtime ledger handoff |
| [redis-realtime-ops.md](redis-realtime-ops.md) | Redis pub/sub, rate limits, coalesce hooks |
| [websocket-city-digest.md](websocket-city-digest.md) | Guest/player WS digest subscribe + support ticks |

## Behavior covered

- 81-province SVG map colored by ownership digest  
- Guest map + city sheet + scoreboard  
- Phone OTP + Google/Apple via **Supabase Auth** when env set; local mock OTP + OAuth stubs otherwise; Kabile after verify (Big 4 first). See [supabase-auth-providers.md](supabase-auth-providers.md).  
- **Phone verify gate (CC-21):** spend / claim / Kabile pick return `403 phone_unverified` with EN/TR wall copy; client shows `PhoneVerifyWall`. See [phone-verify-before-play.md](phone-verify-before-play.md).
- Always-confirm spend; idempotent Postgres ledger (`FOR UPDATE`); live flip over Redis → WS  
- Daily 100 energy via claim / `grant-sim`  
- Seeds from `docs/city-seed-matrix.md` logic (2–3 teams)

## Not in this slice

Live Supabase project credentials (optional — code path is wired), Netgsm live send needs OTP package + başlık (`docs/netgsm-otp-sms-hook.md`; dry-run without keys), iyzico/IAP, match-day boosts, TR midnight cron worker, push delivery worker.

Postgres + Redis are in: set `DATABASE_URL` and `REDIS_URL` (local `docker compose` in `apps/api`, or Neon/Fly MPG + Upstash). See [postgres-migration.md](postgres-migration.md) and [redis-realtime-ops.md](redis-realtime-ops.md).

## Test

```bash
cd apps/api && docker compose up -d \
  && DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition \
     REDIS_URL=redis://127.0.0.1:6379 npm run dev
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
```

See `apps/README.md` for env and real-vs-stubbed table.

## Follow-up (web SVG)

Expo web crashed when province `Path` used `onPress` (RN responder props leaked into DOM). See [turkiye-map-web-svg.md](turkiye-map-web-svg.md). Client harden beyond the slice (taps, perf, empty/error states): [turkiye-map-harden.md](turkiye-map-harden.md).
