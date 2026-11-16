# CC-23 — Gate guest actions behind login

**Date:** 2026-11-16  
**Branch:** `cursor/gate-guest-actions-a7b8`  
**Stacked on:** #43 (CC-21) → #41 (CC-20) → #40 (CC-19)  
**Why:** Product lock — guests only browse map, city sheets, and scoreboards; every other action redirects to login/signup.

## Docs read (store)

- `docs/auth-verification-flow.md` — Guest = view map + city sheets; boards browse freely; any action → login  
- `docs/wireframes.md` — §1 guest map; city sheet guest CTA “Log in to support”  
- Middleware: Next locale cookie only; guest gates are Expo routes + Fastify 401 payloads

## Browse vs gated

| Surface | Guest |
|---------|-------|
| Map (`/`) | Allowed |
| City sheet (modal) | View-only; CTA → login (“Desteklemek için giriş yap”) |
| Scoreboard (`/scoreboard`) | Allowed |
| Shop (`/shop`) | **Redirect** → `/auth` |
| Play / Katıl / spend / claim / Kabile | **Redirect** → `/auth` (then CC-21 phone wall if needed) |

## API

Play mutations without Bearer return `401` + `guestLoginPayload()`:

```json
{
  "error": "unauthorized",
  "code": "login_required",
  "gate": "guest_login",
  "message": "Log in to continue — guests can only browse the map.",
  "messageTr": "Devam etmek için giriş yap — misafirler yalnızca haritayı gezebilir."
}
```

## Client

- `GuestLoginWall` on city sheet (support variant) and shop interim state  
- Map **Dükkan** tap sends guests to `/auth` before navigation  
- Does not rewrite TurkiyeMap atlas  

## Explicit non-goals

- Lost-SIM rebind — see [lost-sim-phone-rebind.md](lost-sim-phone-rebind.md) (CC-22)  
- Full resume-intent deep links after auth (city context preserved by staying on map modal where possible)  

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
# Manual: guest → skor OK; dükkan → auth; city CTA → auth; after login → CC-21/verify/kabile
```
