# CC-27 — Confirm spend + boosted support UI

**Date:** 2026-11-16  
**Branch:** `cursor/confirm-spend-boost-ui-dc3c`  
**Area:** Map (client-focused; thin API for boost state)  
**Why:** Locked UX — always confirm spend; show “boosted support” when personal and/or team multipliers apply.

## Docs read (store + repo)

- Store `docs/wireframes.md` §6–7 (city sheet + confirm energy)
- Store `docs/economy-sheet.md` (personal +50%/1h · team +25% · multiplicative)
- Store `internal/cc26-city-sheet-combat.md`, `internal/cc21-cc23-auth-gates.md`
- Repo `docs/city-sheet-combat-panel.md`, `docs/persist-ledger-live-flips.md`

## Parallel PRs composed

| PR | Status | Compose |
|----|--------|---------|
| [#45](https://github.com/efesefe/city-competition/pull/45) City sheet combat | Open | Merged into this branch |
| [#37](https://github.com/efesefe/city-competition/pull/37) Map harden | Open | Merged (digest/loadError) |
| [#43](https://github.com/efesefe/city-competition/pull/43) / [#44](https://github.com/efesefe/city-competition/pull/44) Auth gates | Open | Guest “Log in to support” copy kept; no wall-component import so Auth tip can compose |

## Client

- `ConfirmSpendModal` — wireframes §7: cost, balance, **Boosted support** when active, Confirm/Cancel; insufficient → Claim / Shop
- `CitySheet` — Attack/Defend CTA **only opens confirm** (never spends); boosted-support block when multipliers ≠ 1×
- `shop` — personal boost SKU + **stub activate** (no payment); optional team +25% sim for display demos
- Map screen passes `boostFromUser(user)` into the sheet

## API (thin)

| Piece | Detail |
|-------|--------|
| Migration `005_boost_state.sql` | `users.personal_boost_expires_at`; `team_boost_windows` |
| `boostSnapshotForUser` | Live personal × team for spend ledger + `/v1/me` |
| `POST /v1/boosts/personal/stub` | Activate +50% / 1h without charging (Payments later) |
| `POST /v1/boosts/team/sim` | Dev/sim +25% tribe window until admin match-day |
| Spend | Still requires `confirmed: true`; snapshots boost into ledger |

## Explicit non-goals

- Real IAP / iyzico (Payments leaves)
- Admin match-day scheduling UI
- Full Auth gate stack merge (#40–#44)

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
# Manual: shop → activate personal stub → open city → Attack → confirm shows Boosted support
#          team/sim → both multipliers → Base N → effective round(N×1.5×1.25)
```
