# CC-61 — Skippable tutorial flow

**Date:** 2026-11-16  
**Branch:** `cursor/skippable-tutorial-flow-c061`  
**Stacked on:** `main` (post #45/#39/#54/#47 — `buildApp` in `apps/api/src/app.ts`, energy, Fly)  
**Why:** First-session coach — claim → dynamic mid-seed capture → live fight; skippable after verify/session ([tutorial-script.md](https://github.com/efesefe/city-competition/blob/main/docs/expo-fastify-slice.md) product store).

## Docs read (before coding)

- Store: `docs/tutorial-script.md`, `docs/wireframes.md` §8, `docs/auth-verification-flow.md`  
- Repo: `docs/post-verify-kabile-picker.md`, `docs/expo-fastify-slice.md`, `docs/phone-verify-before-play.md`, `docs/gate-guest-actions.md`

## Flow

```
Verified + Kabile set
  → Step claim: spotlight energy / Claim (+100 @ 00:00 TR)
     already granted today → auto-advance
  → Step capture: dynamic mid-seed city (not fixed per alias)
     open city sheet → confirm spend → flip to your tribe completes beat
  → Step fight: contested/hot city ≠ capture
     ≥1 successful spend completes beat
  → Done tip (dismissible)
Skip (anytime after verify): clears remaining coach; map fully playable
```

Auth interrupt: guest / unverified claim or spend → login / phone wall / Kabile (#55), then resume.

## API

| Endpoint | Behavior |
|----------|----------|
| `GET /v1/tutorial` | Locks capture + fight plates; returns step + names; auto-marks claim if `free_grant_date` is today TR |
| `POST /v1/tutorial/skip` | `tutorial_skipped` + `tutorial_complete` |
| `POST /v1/energy/claim` (+ grant-sim) | Marks `tutorial_claimed_energy` on grant or already-granted |
| `POST /v1/cities/:plate/spend` | Capture beat on flip to player tribe; fight beat on fight-plate spend |

Migration `008_tutorial_flags.sql` — account-state flags + locked plates.

Routes registered in `apps/api/src/app.ts` (`buildApp`): claim/grant-sim auto-mark, spend advances beats, `GET/POST /v1/tutorial*`.

Picker: `apps/api/src/lib/tutorial.ts` — mid-seed margins (~1–3× action cost), fight prefers close multi-team races (İstanbul boost).

## Client

- `TutorialCoach` — one card, primary CTA + Skip  
- Map energy pill lit on claim step  
- Spotlight pulse on capture / fight plates  
- `PublicUser.tutorial` embedded for session refresh  

## Explicit non-goals (this leaf)

- Capture complete after **3 confirms without flip** → **CC-62** ([tutorial-capture-no-flip.md](tutorial-capture-no-flip.md))  
- Kabile picker UX → #55 / CC-63  

## Test

```bash
cd apps/api && npm run typecheck && npm test
cd apps/client && npx tsc --noEmit
```
