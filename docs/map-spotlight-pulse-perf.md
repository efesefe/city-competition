# Map spotlight pulse without full-tree thrash (W3 partial)

**Date:** 2026-11-17  
**Branch:** `cursor/map-spotlight-pulse-perf-0f81`  
**Why:** Match-day spotlight used `requestAnimationFrame` → React `setPhase` on the map root, reconciling the 81-path SVG tree every frame while windows stayed open (post–Season 0 plan §2.2 / W3).

## Docs read

- Store `docs/post-season0-next-steps.md` §2.2, §3 W3, §4 PR #3
- Repo `docs/match-day-map-chrome.md`, `docs/turkiye-map-harden.md`

## Approach

| Surface | Before | After |
|---------|--------|-------|
| Web `TurkiyeMap` | Parent `useSpotlightPulse` → `setPhase` every rAF → full map reconcile | `SpotlightHaloWeb` writes `stroke-opacity` on DOM path refs; province memo tree stays idle |
| Native `TurkiyeMap` | Same parent phase state | `SpotlightHaloNative` owns local phase — only halo paths re-render |
| `MatchDayBanner` | 1s local tick (OK) but easy parent re-pass | `memo` + 5s tick until last 2 minutes, then 1s |

Visual look (amber halo, pulse period 1.6s) unchanged — no W4–W6 theme work.

## How to test

```bash
cd apps/client && npx tsc --noEmit
# Optional: node --test lib/matchDayChrome.test.ts
```

Manual (API + Expo web + match-day fixture / admin window):

1. Spotlight cities show amber urgency stroke + pulsing halo.
2. Map taps / digest color updates remain smooth while spotlight is active.
3. Banner countdown still updates; does not force map re-renders.

## Follow-up

Delta-first WS support fan-out (W3 PR #4) — stop full 81-city digest broadcast on every spend.
