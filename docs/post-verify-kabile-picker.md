# CC-63 — Post-verify Kabile picker

**Date:** 2026-11-16  
**Branch:** `cursor/post-verify-kabile-picker-438f`  
**Stacked on:** Auth tip #46 (CC-22 lost-SIM) → #44 guest gate → #43 phone verify → #41 Netgsm → #40 Supabase  
**Why:** Product lock — pick `public_alias` only **after** phone verification; list **Big 4 first**, then rest ([team-aliases.md](team-aliases.md)).

## Docs read (store / product)

- `docs/auth-verification-flow.md` — alias after phone verify; no pre-verify draft  
- `docs/wireframes.md` §4 — select list + Join CTA + cooldown copy + add-team secondary  
- `docs/team-aliases.md` — 18 Süper Lig `public_alias` values  

## Flow

```
Auth (phone OTP | Google/Apple) → phone verified
  → /pick-tribe (forced when tribeId null)
  → Big 4 section, then rest
  → select alias → Katıl {Alias} / Join
  → resume map (optional openPlate)
```

Guests hitting `/pick-tribe` → `GuestLoginWall`.  
Logged-in unverified → `PhoneVerifyWall` (`kabile`); API `POST /v1/tribe/pick` → `403 phone_unverified`.

## API

| Endpoint | Behavior |
|----------|----------|
| `GET /v1/teams` | `{ order: "big4_first", teams, big4, rest }` — aliases only |
| `POST /v1/tribe/pick` | Requires session + `phone_verified`; 1-day cooldown on switch |

Seed / source: `apps/api/src/data/teams.ts` ↔ [team-aliases.md](team-aliases.md).

## Client UX (`apps/client/app/pick-tribe.tsx`)

- Brand + **Kabileni seç** / switch title  
- Cooldown support line (EN/TR)  
- Section **Big 4** then **Diğer Süper Lig** with kit dual-swatches  
- Select → sticky **Katıl {public_alias} / Join** (not tap-to-join)  
- Secondary: request add-team (placeholder copy until admin tickets)  
- Resume: `?resume=34` → map `openPlate` after confirm  

## Explicit non-goals

- Tutorial beats (other Onboarding leaves)  
- Lost-SIM (CC-22)  
- Admin team-add ticket API  

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
# Manual: mock OTP verify → /pick-tribe → Big 4 above rest → confirm → map
# Unverified OAuth stub → wall; guest → login wall
```
