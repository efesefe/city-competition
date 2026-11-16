# Personal boost logic (CC-32)

**Date:** 2026-11-16  
**Branch:** `cursor/personal-boost-logic-ee1a`  
**Tracker:** CC-32  
**Why:** Economy lock — personal **+50% / 1h** must apply on spent energy with real timing/expiry and stack **personal × team**. Purchase may wait on Payments.

## Docs / prior art inspected

- Store `economy-sheet.md` (boosts table), `architecture.md` (Boost + ledger snapshot)
- Repo `docs/persist-ledger-live-flips.md` (CC-35 snapshot cols; helpers were still `1.0`)
- Open [#48](https://github.com/efesefe/city-competition/pull/48) CC-27 confirm-spend + boosted-support UI (boost stub + display path) — composed API shape here without pulling map UI

## What this leaf ships

| Piece | Detail |
|-------|--------|
| Migration `005_boost_state.sql` | `users.personal_boost_expires_at`; `team_boost_windows` |
| `lib/boost.ts` | Constants `1.5` / `1.25` / 1h; live snapshot; stub activate; team sim |
| Spend path | Snapshot **inside** the spend tx (after user `FOR UPDATE`) so expiry is real at apply time; ledger stores both multipliers; credited = energy × personal × team (3 dp) |
| `POST /v1/boosts/personal/stub` | Activates +50% for 1h **without charge** (Payments later) |
| `POST /v1/boosts/team/sim` | Dev +25% tribe window so stacking can be exercised before admin match-day |
| `/v1/me` (+ auth/spend responses) | `user.boost` with live multipliers + expiry timestamps |
| `/v1/meta` shop | `personalBoost` SKU meta (`purchase: "stub"`) |

## Stacking (economy lock)

| Case | Credited support (base 20) |
|------|----------------------------|
| None | 20 |
| Personal only | 30 |
| Team only | 25 |
| Both | 20 × 1.5 × 1.25 = **37.5** |

Expiry: personal multiplier is active only while `personal_boost_expires_at > now` (strict). At/after expiry → `1.0`. Re-stub refreshes the 1h window.

## Still stub / later

- Real personal boost **purchase** (iyzico / IAP / RevenueCat entitlements) — Payments leaves
- Admin-scheduled match-day team windows — **CC-50/51** (`docs/admin-match-day-schedule.md`); `/v1/boosts/team/sim` remains a quick demo
- Client “Boosted support” chrome — CC-27 [#48] (consumes `/v1/me.boost` + spend snapshot)

## Run

```bash
cd apps/api
docker compose up -d
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
npm install && npm run dev
# boot applies migrations/005_boost_state.sql when pending
```

## Test

```bash
cd apps/api && npm test && npm run typecheck
```

Manual:

1. Auth → claim energy → `POST /v1/boosts/personal/stub` → `/v1/me` shows `personalBoostPct: 1.5` + `personalExpiresAt`  
2. Spend → ledger `personal_boost_pct=1.5`, `support_credited = energy × 1.5`  
3. Optional team sim → spend → credited = energy × 1.5 × 1.25  
4. Set `personal_boost_expires_at` in the past → next spend snapshots `1.0`
