# CC-21 — Enforce phone verify before play

**Date:** 2026-11-16  
**Branch:** `cursor/enforce-phone-verify-a7b8`  
**Stacked on:** #41 (CC-20 Netgsm) → #40 (CC-19 Supabase Auth)  
**Why:** Product lock — spend and Kabile/`public_alias` pick require verified phone; unverified accounts get a clear verify wall (not a silent failure).

## Docs read (store)

- `docs/auth-verification-flow.md` — guest browse; verify before spend/alias; wall copy EN/TR  
- `docs/wireframes.md` — §3 phone verify gate; §4 Kabile after verify  
- Existing slice middleware: Next `frontend/middleware.ts` is locale-only; play gates live in Fastify + Expo client

## Behavior

| Action | Guest | Logged-in, phone unverified | Verified |
|--------|-------|-----------------------------|----------|
| Map / city sheet / scoreboard | Browse OK | Browse OK | OK |
| Spend energy | Auth chooser (CC-23) | **403** + spend wall UX | OK (with tribe) |
| Pick Kabile | Auth required | **Blocked** — verify wall on `/pick-tribe` + API 403 | OK |
| Claim / grant-sim energy | 401 | **403** + play wall | OK |

### API payloads (`403`)

```json
{
  "error": "phone_unverified",
  "code": "phone_unverified",
  "gate": "phone_verify",
  "message": "Verify phone to spend energy",
  "messageTr": "Enerji harcamak için telefonunu doğrula"
}
```

Kinds: `play` | `spend` | `kabile` via `apps/api/src/lib/play-gates.ts`.

### Client UX

- `PhoneVerifyWall` on city sheet (spend) and pick-tribe  
- Auth screen switches to verify-wall copy when session exists but `phoneVerified === false`  
- Map CTA label: **Doğrula** when unverified  

## Explicit non-goals

- Lost-SIM rebind — shipped in [lost-sim-phone-rebind.md](lost-sim-phone-rebind.md) (CC-22)  
- Guest action redirects (CC-23 — see [gate-guest-actions.md](gate-guest-actions.md))
- Netgsm / Supabase rewrites  

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
# Manual: OAuth stub → needsPhone → spend/pick blocked with wall → bind OTP → pick → spend
```
