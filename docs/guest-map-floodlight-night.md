# Guest map first viewport — Floodlight Night (W5)

**Date:** 2026-11-18  
**Area:** Expo client guest/home map composition + map motion  
**Depends on:** W4 tokens (`apps/client/lib/theme.ts`, PR #77)  
**Direction:** store `docs/visual-direction.md` (Floodlight Night) + `docs/wireframes.md` §1

## Docs read

- Store `docs/visual-direction.md`, `docs/wireframes.md` §1, `docs/post-season0-next-steps.md` §3 W5
- Repo `docs/visual-direction-tokens.md`, `docs/soft-launch-chrome-hygiene.md`, `docs/map-spotlight-pulse-perf.md`

## What changed

| Surface | Behavior |
|---------|----------|
| Fonts | Unbounded + Figtree loaded in `app/_layout.tsx` via `expo-font` / `@expo-google-fonts/*` before branded chrome paints |
| Map screen | Header hidden; **full-bleed** map plane; cool night vignette + lower-third `overlayScrim` |
| Brand | Unbounded wordmark as hero signal (not stack-nav title) |
| Copy / CTA | Wireframe EN H1 + support + TR pair; one primary **Play / Katıl** group with enter fade+rise (~220ms) |
| Chrome strip | Guest: no energy / shop / “Misafir”; muted **Skor** only. Admin stays role-gated. Verified players keep energy + Dükkan |
| Map paint | `mapBase` / `mapStroke` / accent selection; match-day spotlight retinted off gold → cool `ink` floodlight |
| Motion | Contested soft accent pulse (2–3 hot plates); ownership flip color tween (~340ms); CTA enter |

## Explicit non-goals

- W6 secondary surfaces (sheet/shop/boards/tutorial full visual pass)
- Economy / auth logic changes
- Wireframe structure/copy invents

## How to test

1. `cd apps/client && npx tsc --noEmit`
2. `npx expo start --web` — guest first viewport: brand dominates, map edge-to-edge, vermillion CTA, no Georgia/cream/gold residual on the map chrome
3. Confirm Skor opens boards; Admin absent for non-admins; Play routes to auth
