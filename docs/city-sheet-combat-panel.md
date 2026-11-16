# CC-26 — City sheet combat panel

**Date:** 2026-11-16  
**Branch:** `cursor/city-sheet-combat-panel-05dd`  
**Area:** Map (parallel to Auth)  
**Why:** Wireframes §6 — owner, lead, top contributors (real handles), Attack/Defend with always-confirm spend.

## Docs read (store + repo)

- Store `docs/wireframes.md` §6 city sheet (owner / lead / contributors / Attack·Defend / guest CTA)
- Store `docs/season-0-build-order.md` Wave 3 Map city sheet
- Store `internal/cc25-map-harden.md`, `internal/cc21-cc23-auth-gates.md`
- Repo `docs/expo-fastify-slice.md`, `docs/persist-ledger-live-flips.md`

## Parallel PRs (do not fight)

| PR | Status | Note |
|----|--------|------|
| [#37](https://github.com/efesefe/city-competition/pull/37) Harden map | **Open / unmerged** | City sheet accepts optional `loadError`; map screen wires fetch failure |
| [#43](https://github.com/efesefe/city-competition/pull/43) / [#44](https://github.com/efesefe/city-competition/pull/44) Auth gates | Open | Guest CTA copy matches locked “Log in to support”; no `GuestLoginWall` / `PhoneVerifyWall` import so Auth can compose |

## Client (`apps/client`)

- `components/CitySheet.tsx` — combat panel:
  - Owner line (EN + TR)
  - Lead (top 3 support) with **← you** when viewer’s tribe matches
  - Top contributors: `@handle` · Kabile alias · support (real handles)
  - Boosted support block only when multipliers ≠ 1×
  - Primary CTA: **Attack · N ⚡** (rival / unowned) or **Defend · N ⚡** (own alias)
  - Guest: locked “Desteklemek için giriş yap” / “Log in to support”
  - Always-confirm modal (cost, balance, optional boosted support)
- `app/index.tsx` — `sheetError` → `loadError` (compose with #37)
- `lib/api.ts` — `CityContributor.alias`; boost helpers for UI

## Thin API

Existing `GET /v1/cities/:plate` already returned contributors. Enrichment only:

```sql
LEFT JOIN teams t ON t.internal_id = u.tribe_id
-- topContributors[].alias = t.public_alias
```

No new route. Spend remains `POST /v1/cities/:plate/spend` with `confirmed: true`.

## Explicit non-goals

- Auth gate components / Supabase / Netgsm (CC-19…23)
- Map atlas harden (#37 body)
- Match-day chrome / shop boosts wiring (multipliers stay 1× until those leaves)

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
# Manual: open city → owner + lead + contributors; verified tribe → Attack/Defend → confirm
```
