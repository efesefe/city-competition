# TR midnight free + sub bonus jobs (CC-33)

**Date:** 2026-11-16  
**Branch:** `cursor/midnight-sub-bonus-jobs-51b8`  
**Builds on:** CC-30 daily free energy (`docs/daily-free-energy.md`, PR #47)  
**Tracker:** CC-33  
**Why:** Same **00:00 Europe/Istanbul** job must grant free **100** and, for active subscribers, daily sub **+50** (stacks). Ops need a scheduler and force endpoints without waiting for midnight. Auth is not rewritten.

## Product rules

| Rule | Behavior |
|------|----------|
| Free amount | `tunables.free_daily_grant` (default **100**) |
| Sub daily bonus | `tunables.sub_daily_bonus` (default **50**) — locked |
| Clock | **Europe/Istanbul** calendar day |
| Stacking | Free + sub on the same midnight job / lazy claim |
| Banking | Free bucket **replaced**; sub daily bonus bucket **replaced** when entitled |
| Paid | Untouched |
| Eligibility (free) | Phone-verified |
| Eligibility (sub +50) | `users.sub_active = TRUE` (server entitlement; payments leaf flips this later) |
| Once per day | `free_grant_date` / `sub_grant_date` = today's TR date |

Debit order on spend remains **free → sub → paid**.

## Code map

| Path | Role |
|------|------|
| `apps/api/migrations/010_sub_daily_bonus.sql` | `sub_active`, `sub_grant_date`, tunable seed |
| `apps/api/src/lib/energy.ts` | Lazy / force / batch free + sub bonus; `setSubEntitlement` |
| `apps/api/src/lib/energyGrantScheduler.ts` | Optional in-process TR midnight timer |
| `apps/api/src/index.ts` | claim / grant-sim / grant-job / sub-entitle |

## HTTP (ops + player)

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/v1/energy/claim` | Lazy expire-then-grant free; +50 if `sub_active` |
| `POST` | `/v1/energy/grant-sim` | **Force** caller free (+ sub if entitled) — no midnight wait |
| `POST` | `/v1/energy/grant-job` | **Force** batch; body `{ "force": true }` optional |
| `POST` | `/v1/energy/sub-entitle` | Ops/dev set `sub_active` without payments: `{ "active": true }` (+ optional `userId`) |

`grant-sim`, `grant-job`, and `sub-entitle` are gated by `ALLOW_ENERGY_GRANT_TRIGGERS` (on outside production).

## Scheduler

Set `ENERGY_GRANT_SCHEDULER=true` to arm the in-process timer that runs the same batch as `grant-job` at each TR midnight (and catch-up on boot). Off by default.

## Env

| Variable | Default | Notes |
|----------|---------|--------|
| `ENERGY_GRANT_SCHEDULER` | unset/false | Arm TR midnight timer |
| `ALLOW_ENERGY_GRANT_TRIGGERS` | on outside prod | Gate force / entitle endpoints |

## How to test

```bash
cd apps/api && npm test
```

Manual (API up, triggers enabled):

```bash
# mark caller as subscriber (ops stub)
curl -s -X POST http://localhost:8787/v1/energy/sub-entitle \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"active":true}'

# force TR midnight for caller
curl -s -X POST http://localhost:8787/v1/energy/grant-sim \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# batch force
curl -s -X POST http://localhost:8787/v1/energy/grant-job \
  -H 'content-type: application/json' -d '{"force":true}'
```

Expect free **100** + sub **50** for entitled users; second claim same TR day → already granted.

## Out of scope

- Real iyzico / IAP receipt → `sub_active` (payments leaf)
- Auth rewrite (session / OTP / OAuth untouched beyond reading new columns)
- Action-cost band admin UI / boosts / push “energy ready”
