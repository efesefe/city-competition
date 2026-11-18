# CC-28 — Match-day map chrome

**Date:** 2026-11-16  
**Branch:** `cursor/match-day-map-chrome-a0cf`  
**Area:** Map (client + thin API fixture stub)  
**Why:** Locked UX — match-day shows **both** a thin team-boost banner **and** a map city spotlight (not banner-only / spotlight-only).

## Docs read (store + repo)

- Store `docs/wireframes.md` §5 (main map alive cues)
- Store `docs/season-0-calendar.md` (team boost + derby timed-war templates)
- Store `docs/admin-mvp-checklist.md` (match-day fields)
- Store `internal/cc25-map-harden.md`, `internal/cc27-confirm-spend-boost-ui.md`
- Repo `docs/confirm-spend-boost-ui.md`, `docs/derbi-map-urgency.md` (Next map urgency reference only)

## Parallel PRs composed

| PR | Status | Compose |
|----|--------|---------|
| [#48](https://github.com/efesefe/city-competition/pull/48) Confirm spend + boost UI | Open | Merged into this branch (includes #45 city sheet + #37 map harden) |
| [#37](https://github.com/efesefe/city-competition/pull/37) Map harden | Open | Via #48 |
| [#45](https://github.com/efesefe/city-competition/pull/45) City sheet combat | Open | Via #48 |
| Auth #40–#44 | Open | No wall-component import |

## Client

- `MatchDayBanner` — thin “Maç günü +25% takım boost” strip under brand chrome; tap opens spotlight city sheet
- `TurkiyeMap` — `spotlightPlates` → amber urgency stroke + pulsing halo path (no badge stickers). Pulse no longer re-renders the 81-path tree — see [map-spotlight-pulse-perf.md](map-spotlight-pulse-perf.md)
- `matchDayChrome.ts` — tribe-filtered banner selection; city-based spotlight set
- Map screen polls `GET /v1/match-day/active` every 60s
- Shop: **Maç günü fixture stub** seeds chrome for QA — UI + API gated for soft launch (see [soft-launch-stub-honesty.md](soft-launch-stub-honesty.md))

## API (thin)

| Piece | Detail |
|-------|--------|
| Migration `006_match_day_chrome.sql` | `team_boost_windows.spotlight_plate` + `label` |
| `GET /v1/match-day/active` | Guest-readable active windows for chrome |
| `POST /v1/match-day/fixture-stub` | Opens +25% for caller’s tribe + spotlight (default İstanbul `34`) |
| Spend path | Unchanged — still snapshots `team_boost_windows` via `boostSnapshotForUser` |

## Explicit non-goals

- Full Admin MatchDay scheduling UI / fixture calendar (Admin + MatchDay leaves)
- Wiring boost math beyond existing team window (already in CC-27)
- Porting Next.js `DerbiCityOverlay` MapLibre markers into Expo SVG atlas

## Test

```bash
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit

# Manual (API + Expo web):
# 1. Shop → Maç günü fixture stub
# 2. Map: tribe banner visible + İstanbul amber spotlight/halo
# 3. Banner tap → city sheet for spotlight plate
# 4. Guest (no tribe): spotlight still visible; banner hidden until tribe matches
```
