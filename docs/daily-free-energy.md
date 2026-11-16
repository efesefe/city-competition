# Daily free energy grant (CC-30)

**Date:** 2026-11-16  
**Branch:** `cursor/daily-free-energy-grant-05aa`  
**Tracker:** CC-30  
**Why:** Lock the Season 0 free-energy entitlement: **100** at **00:00 Europe/Istanbul**, unused free energy **expires** (no bank), with a job/endpoint that can run in dev without waiting for midnight.

## Product rules

| Rule | Behavior |
|------|----------|
| Amount | `tunables.free_daily_grant` (default **100**) |
| Clock | **Europe/Istanbul** calendar day (`YYYY-MM-DD`) |
| Banking | Free bucket is **replaced** on grant — leftover free does **not** roll |
| Paid / sub | Untouched by this job (sub **+50** daily is a later Energy leaf) |
| Cap | No overall energy storage cap |
| Eligibility | Phone-verified users only (lazy claim + batch job) |
| Once per day | `users.free_grant_date` must equal today's TR date |

Debit order on spend remains **free → sub → paid** so expiring free is spent first (`apps/api/src/lib/game.ts`).

## TR timezone behavior

- Canonical zone: **`Europe/Istanbul`** (not a hard-coded `UTC+3` offset in product docs alone — code uses the IANA zone).
- Turkey has observed **UTC+3 year-round** since 2016 (no DST). The TR date still flips at **21:00 UTC** the previous calendar day.
- Helpers live in [`apps/api/src/lib/trTime.ts`](../apps/api/src/lib/trTime.ts):
  - `trDateString(d)` → entitlement day key
  - `nextTrMidnight(d)` / `msUntilNextTrMidnight(d)` → scheduler boundary
- Catch-up: if the midnight job misses a run, lazy grant on `/v1/me`, phone verify/bind, or `POST /v1/energy/claim` still expire-then-grant once for that TR date.

**Do not** key grants off UTC midnight or the API host’s local TZ.

## Code map

| Path | Role |
|------|------|
| `apps/api/src/lib/trTime.ts` | TR date + midnight math |
| `apps/api/src/lib/energy.ts` | Lazy grant, force grant, batch job |
| `apps/api/src/lib/energyGrantScheduler.ts` | Optional in-process TR midnight timer |
| `apps/api/src/index.ts` | `/v1/energy/claim`, `grant-sim`, `grant-job` |

Auth is unchanged — energy routes reuse existing session helpers.

## HTTP

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/v1/energy/claim` | Lazy expire-then-grant for the caller (idempotent per TR day) |
| `POST` | `/v1/energy/grant-sim` | **Dev/sim** force grant for caller — no midnight wait |
| `POST` | `/v1/energy/grant-job` | **Dev/ops** batch job; body `{ "force": true }` optional |

`grant-sim` and `grant-job` are gated by `ALLOW_ENERGY_GRANT_TRIGGERS` (defaults **on** when `NODE_ENV !== "production"`; set `true`/`false` to override).

`GET /health` and `GET /v1/meta` expose `timezone` / `trDate` for ops checks.

## Scheduler

Set `ENERGY_GRANT_SCHEDULER=true` to arm an in-process timer that runs the same batch as `grant-job` at each TR midnight (and catch-up on boot if today's date was not yet applied). Off by default so local `npm run dev` stays quiet.

## Env

| Variable | Default | Notes |
|----------|---------|--------|
| `ENERGY_GRANT_SCHEDULER` | unset/false | Arm TR midnight timer |
| `ALLOW_ENERGY_GRANT_TRIGGERS` | on outside prod | Gate `grant-sim` + `grant-job` |

## How to test

Unit (no Postgres):

```bash
cd apps/api && npm test
```

Manual against a running API (Postgres + Redis up):

```bash
# after phone verify + session token
curl -s -X POST http://localhost:8787/v1/energy/grant-sim \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

curl -s -X POST http://localhost:8787/v1/energy/grant-job \
  -H 'content-type: application/json' -d '{"force":true}'
```

Expect free energy **100**, `free_grant_date` = today's TR date, paid/sub unchanged. A second `claim` the same TR day returns `already_granted`.

## Out of scope (later Energy leaves)

- Sub daily **+50** on the same clock  
- Action-cost band admin UI / OTP  
- Personal / match-day boost multipliers  
- Push “energy ready” fan-out  
