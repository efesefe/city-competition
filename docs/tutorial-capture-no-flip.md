# CC-62 — Complete tutorial capture without requiring flip

**Date:** 2026-11-16  
**Branch:** `cursor/tutorial-capture-no-flip-c061`  
**Stacked on:** CC-61 [#59](https://github.com/efesefe/city-competition/pull/59) (`cursor/skippable-tutorial-flow-c061` on `main` tip)  

**Why:** Locked product rule — capture beat completes after **3 confirms** on the tutorial city if ownership never flips to the player.

## Docs read

- Store: `docs/tutorial-script.md` (success criteria + locked 3-confirm beat)  
- Repo: `docs/skippable-tutorial-flow.md` (CC-61 coach + plates)

## Behavior

On each successful **confirmed** spend targeting `tutorial_capture_plate`:

1. If spend **flips** ownership to the player’s tribe → mark `tutorial_capture` (CC-61 path).  
2. Else increment `tutorial_capture_confirms`.  
3. When confirms ≥ **3** → mark `tutorial_capture` even without a flip.

Fight beat and Skip unchanged. Confirms only count on the locked capture plate (not the fight city).

## Schema

Migration `009_tutorial_capture_confirms.sql`:

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_capture_confirms INTEGER NOT NULL DEFAULT 0;
```

Exposed on `PublicUser.tutorial.captureConfirms` / `captureConfirmsNeeded` (always 3) and `GET /v1/tutorial`.

## Client

Capture coach shows `Onay n/3` progress after the first non-flip confirm.

## Test

```bash
cd apps/api && npm run typecheck && npm test
# captureCompleteFromConfirms: 2 → false, 3 → true
```
