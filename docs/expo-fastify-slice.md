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
| [idempotent-spend.md](idempotent-spend.md) | CC-37 concurrent idempotent spend load/smoke tests |
| [websocket-city-digest.md](websocket-city-digest.md) | Guest/player WS digest subscribe + support ticks |

## Behavior covered

- 81-province SVG map colored by ownership digest  
- Guest map + city sheet + scoreboard  
- Phone OTP + Google/Apple via **Supabase Auth** when env set; local mock OTP + OAuth stubs otherwise. See [supabase-auth-providers.md](supabase-auth-providers.md).  
- **Phone verify gate (CC-21):** spend / claim / Kabile pick return `403 phone_unverified` with EN/TR wall copy; client shows `PhoneVerifyWall`. See [phone-verify-before-play.md](phone-verify-before-play.md).  
- **Guest gate (CC-23):** guests browse map / city sheet / scoreboard only; shop + play actions → `/auth`. See [gate-guest-actions.md](gate-guest-actions.md).  
- **Post-verify Kabile picker (CC-63):** Big 4 first then rest; `public_alias` from [team-aliases.md](team-aliases.md). See [post-verify-kabile-picker.md](post-verify-kabile-picker.md).  
- City sheet combat panel (CC-26): owner, lead, real-handle contributors, Attack/Defend + confirm — see [city-sheet-combat-panel.md](city-sheet-combat-panel.md)  
- Confirm spend + boosted support UI (CC-27): always-confirm modal; live personal×team multipliers on sheet/confirm; personal boost purchase stub — see [confirm-spend-boost-ui.md](confirm-spend-boost-ui.md)  
- Match-day map chrome (CC-28): thin team-boost banner + city spotlight; fixture stub until Admin ops — see [match-day-map-chrome.md](match-day-map-chrome.md)  
- **Skippable tutorial (CC-61):** claim → dynamic mid-seed capture → live fight; Skip after verify. See [skippable-tutorial-flow.md](skippable-tutorial-flow.md).
- **Capture without flip (CC-62):** 3 confirms on the locked tutorial city completes the capture beat. See [tutorial-capture-no-flip.md](tutorial-capture-no-flip.md).
- Always-confirm spend; idempotent Postgres ledger (`FOR UPDATE`); live flip over Redis → WS  
- Action cost from `tunables.action_cost` (band **10–20**, default **15**) — admin `PUT /v1/admin/tunables/action-cost` (see [action-cost-tunable.md](action-cost-tunable.md))  
- Daily 100 energy via claim / `grant-sim`  
- Personal +50%/1h boost with real expiry + personal×team stack on spend (purchase stub) — see [personal-boost-logic.md](personal-boost-logic.md)  
- Admin match-day schedule: team +25% (KO−1h→FT+30m) + derby timed city wars — see [admin-match-day-schedule.md](admin-match-day-schedule.md)  
- Admin ops MVP: OTP-gated prices/tunables/season/seeds, team-add tickets, seed confirm, soft-launch metrics — see [admin-ops-mvp.md](admin-ops-mvp.md)  
- Seeds from `docs/city-seed-matrix.md` logic (2–3 teams)

## Not in this slice

Live Supabase project credentials (optional — code path is wired), Netgsm live send needs OTP package + başlık (`docs/netgsm-otp-sms-hook.md`; dry-run without keys), iyzico web checkout, Android Play Billing (iOS IAP is in — see [ios-iap-revenuecat.md](ios-iap-revenuecat.md)), TR midnight cron worker, push delivery worker. Admin MatchDay + OTP ops are in; personal boost display + activate stub remain available. `ALLOW_IAP_STUB` for local iOS grants.

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
