# Soft-launch chrome hygiene (W2)

**Date:** 2026-11-17  
**Area:** Expo client map bar, shop stub CTAs, app config, auth labels  
**Why:** Soft-launch chrome must not look like an ops/QA console (post–Season 0 plan W2).

## Docs read

- Store `docs/post-season0-next-steps.md` §2.1 stub chrome, §3 W2, §4 PR #2
- Repo `docs/confirm-spend-boost-ui.md`, `docs/match-day-map-chrome.md`, `docs/ios-iap-revenuecat.md`

## Changes

| Surface | Behavior |
|---------|----------|
| Map bottom bar | **Admin** link only when `user.role === "admin"`; guests/players use deep-link `/admin` only |
| Shop | Personal-boost stub, match-day fixture stub, and daily-grant sim CTAs render only when `__DEV__` **or** API `iap.stubEnabled` (`ALLOW_IAP_STUB`) |
| `app.json` | `userInterfaceStyle: "dark"` to match the forest UI |
| Auth | “(stub)” OAuth labels + mock footer / hint only in `__DEV__` (or when Supabase is live for the foot note) |
| `index.tsx` | Cosmetic indent residue on tutorial state + spend tutorial branch fixed |

## How to test

1. Guest / player session on map: bottom bar shows Misafir/energy + Skor + Dükkan + Katıl — **no Admin**.
2. Admin-role session: Admin link appears; `/admin` still reachable by URL for anyone (screen still role-gates writes).
3. Shop with `ALLOW_IAP_STUB` unset and a release/prod build (`__DEV__` false): no personal-boost / fixture / sim-grant CTAs.
4. Local Expo (`__DEV__`) or API with stub on: stub CTAs visible.
5. Auth mock mode in prod-like build: Google/Apple labels without “(stub)”.

## Explicit non-goals

- ~~Push worker stub policy (W8)~~ → see [soft-launch-stub-honesty.md](soft-launch-stub-honesty.md)
- Removing `/admin` route (ops still needs deep-link); W8 hides “Admin ol (sim)” in release builds only
- Visual redesign (W4–W6)
