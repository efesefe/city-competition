# Soft-launch stub honesty (W8)

**Date:** 2026-11-18  
**Area:** Unpaid boost/fixture API gates, push/inbox policy, shop/admin stub CTAs  
**Why:** Soft-launch week (24–30 Nov 2026) must not ship free-boost buttons or pretend FCM/APNs works.

## Docs read

- Store `docs/post-season0-next-steps.md` §2.1 stubs, §3 W8, §4 PR #9
- Repo `docs/soft-launch-chrome-hygiene.md` (W2 client CTA gates)
- Repo `docs/attack-alert-pipeline.md`, `apps/README.md` real-vs-stubbed

## Soft-launch policy

| Channel / feature | Soft-launch status |
|-------------------|--------------------|
| **In-app inbox** (`GET /v1/notifications`) | **Real** — attack/flip alerts dual-write here |
| **Push FCM/APNs** | **Log-only** — `LogPushSender` + worker `notif_stub`; tokens stored but not delivered to devices |
| **Personal +50%/1h timing** | **Real** when active |
| **Personal boost purchase** | **Stub / unavailable** — no paid SKU; activate endpoint gated off in production |
| **Match-day team +25% / derby** | **Real** via admin schedule |
| **Match-day fixture stub** | **Dev only** — gated off in production |
| **IAP pack/sub stub** | **Dev only** — requires `ALLOW_IAP_STUB=true` |
| **Energy grant-sim / grant-job** | Gated by `ALLOW_ENERGY_GRANT_TRIGGERS` (off in production by default) |
| **Admin “become admin” sim CTA** | Hidden in release client (`__DEV__` only); API still exists for ops bootstrap |

## Gates

| Surface | Gate |
|---------|------|
| Client shop stub CTAs (personal boost, fixture, daily sim) | `__DEV__` **or** meta `iap.unpaidBoostStubsEnabled` **or** `iap.stubEnabled` (W2 + W8) |
| `POST /v1/boosts/personal/stub` | `unpaidBoostStubsEnabled()` → 403 `boost_stub_disabled` in prod |
| `POST /v1/boosts/team/sim` | same |
| `POST /v1/match-day/fixture-stub` | same |
| `POST /v1/iap/stub` | `iapStubEnabled()` — **strict** `ALLOW_IAP_STUB=true` |
| Meta `shop.personalBoost.purchase` | `"stub"` when unpaid stubs on, else `"unavailable"` |
| Meta `notifications.pushDelivery` | always `"log_only"` until a real sender ships |
| Admin “Admin ol (sim)” button | `__DEV__` only |

`unpaidBoostStubsEnabled()` mirrors energy grant triggers: `ALLOW_IAP_STUB=true` → on; `=false` → off; unset → on when `NODE_ENV !== "production"` (Fly image sets production).

## How to test

```bash
cd apps/api && npm test && npm run typecheck
cd apps/client && npx tsc --noEmit
```

1. Production-like API (`NODE_ENV=production`, `ALLOW_IAP_STUB` unset): `POST /v1/boosts/personal/stub` → 403; meta `purchase: "unavailable"`; `notifications.pushDelivery: "log_only"`.
2. Local API (non-production): unpaid boost stubs allowed; shop CTAs visible under Expo `__DEV__`.
3. Release client + prod API: no personal-boost / fixture / sim-grant CTAs; no “Admin ol (sim)”.

## Explicit non-goals

- Implementing FCM / APNs / Expo Push credentials
- Paid personal-boost SKU / RevenueCat product
- New game features
