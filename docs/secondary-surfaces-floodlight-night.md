# Secondary surfaces — Floodlight Night (W6)

**Date:** 2026-11-18  
**Area:** Expo client sheets, confirm, tutorial, boards, shop, auth walls  
**Depends on:** W4 tokens (`lib/theme.ts`) + W5 guest map (PR #82)  
**Direction:** store `docs/visual-direction.md` (Floodlight Night) + `docs/post-season0-next-steps.md` §3 W6

## Docs read

- Store `docs/visual-direction.md`, `docs/post-season0-next-steps.md` §3 W6
- Repo `docs/guest-map-floodlight-night.md`, `docs/visual-direction-tokens.md`

## What changed (look only)

| Surface | Before | After |
|---------|--------|-------|
| City sheet | Forest panel `#13261d`, gold CTA/Georgia title | `colors.surface` sheet, Unbounded title, vermillion CTA, hairline stroke — no gold rim |
| Confirm spend | Gold confirm + bordered boost box | Accent CTA, `surfaceRaised` boost block, `overlayScrim` |
| Tutorial coach | Gold-bordered Georgia card | Surface + stroke hairline, Figtree body, accent kicker/CTA |
| Scoreboards | Forest ground, gold tabs/values | `colors.bg`, accent tab underline, muted hierarchy, `accentSoft` “you” row |
| Shop | Nested forest cards + gold buy | Flat list rows with hairline dividers; accent buy; no card walls |
| Guest / phone walls | Bordered forest boxes | Copy + accent CTA only (no panel chrome) |
| Auth + kabile picker | Georgia / cream / gold | Unbounded titles, Figtree body, surface inputs, accent primary |

**Untouched:** guest map first viewport (W5); admin ops screen (still forest/gold — not in W6 scope); economy/auth behavior.

## Explicit non-goals

- Guest map composition rewrite
- Wireframe UX / copy locks
- Economy or auth logic
- Admin visual pass

## How to test

1. `cd apps/client && npx tsc --noEmit`
2. Open city sheet → confirm → scoreboard → shop → auth: night navy + vermillion, Unbounded/Figtree; no Georgia/cream/gold residual
3. Guest map first viewport unchanged from W5
