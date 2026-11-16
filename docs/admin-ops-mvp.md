# Admin ops MVP (CC-52 … CC-55)

**Date:** 2026-11-16  
**Branch:** `cursor/admin-otp-seeds-metrics-f946`  
**Stack:** Season 0 Expo + Fastify (`apps/`) — stacked on CC-50/51 match-day admin  
**Why:** Day-2 ops without eng deploy: OTP-gated economy/season/seed writes, team-add triage, alias/seed load, soft-launch metrics (watch-only).

## Docs inspected

- Store: `admin-mvp-checklist.md`, `season-0-calendar.md`, `economy-sheet.md`, `team-aliases.md`, `city-seed-matrix.md`
- Repo: `docs/admin-match-day-schedule.md` (CC-50/51)

## What this leaf ships

| Task | Piece |
|------|--------|
| CC-52 | Phone OTP enroll + purpose challenges; gates pack prices, free grant / action cost, season bounds, seed writes; `admin_audit_log` |
| CC-53 | `POST /v1/tickets/team-add` + admin list/triage accept\|reject\|defer (accept invents `… Kabilesi`) |
| CC-54 | Status + OTP-gated upsert of 18 aliases + 81-city seed matrix |
| CC-55 | Ops metrics: DAU (14d spark), flips today/7d, revenue today/MTD, match-day concurrent + next event, open tickets — **no kill gates** |

## Migration

`012_admin_ops.sql` — `admin_phone_enrolled`, `admin_otp_challenges`, `admin_audit_log`, `team_add_tickets`, `ownership_flips`, `purchase_events`, `concurrent_peaks`.

## Defaults

| Item | Value |
|------|--------|
| Season 0 start | Thu **27 Nov 2026** 12:00 TR (`2026-11-27T09:00:00.000Z`) |
| Season 0 end | Sun **23 May 2027** 23:59 TR |
| Pack TRY placeholders | 49.99 / 129.99 / 249.99 |
| Free grant / action cost | 100 / 15 (band 10–20 on save) |

## Endpoints (admin unless noted)

| Method | Path | Notes |
|--------|------|-------|
| `GET/POST` | `/v1/admin/otp/status\|enroll\|challenge` | Enroll uses verified `phone_e164` |
| `GET` | `/v1/admin/economy` | Prices + tunables + season |
| `POST` | `/v1/admin/economy/pack-prices` | OTP `pack_prices` |
| `POST` | `/v1/admin/economy/tunables` | OTP `economy_tunables` |
| `POST` | `/v1/admin/season/bounds` | OTP `season_bounds` (CC-71) |
| `GET/POST` | `/v1/admin/seeds/status\|load` | OTP `seed_write` |
| `POST` | `/v1/tickets/team-add` | Player (phone verified) |
| `GET/POST` | `/v1/admin/tickets/team-add…` | Triage |
| `GET` | `/v1/admin/metrics` | Soft-launch dashboard |
| `POST` | `/v1/admin/metrics/purchase-sim` | Stub revenue for widgets |

## Expo

`/admin` — full ops console. `/pick-tribe` footer — submit team-add ticket.

## Test

```bash
cd apps/api && npm test && npm run typecheck
```
