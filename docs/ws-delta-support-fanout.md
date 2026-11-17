# Realtime delta-first support fan-out (W3)

**Date:** 2026-11-17  
**Branch:** `cursor/ws-delta-support-fanout-0f81`  
**Why:** Every successful spend rebuilt + broadcast an 81-city `digest` over Redis/WS even when only one city’s tallies changed (post–Season 0 plan §2.2 / W3 / PR #4). Clients already patched from `support` ticks.

## Docs read

- Store `docs/post-season0-next-steps.md` §2.2, §3 W3, §4 PR #4
- Repo `docs/websocket-city-digest.md`, `docs/redis-realtime-ops.md`, `docs/persist-ledger-live-flips.md`

## Before / after

| Path | Before | After |
|------|--------|-------|
| Spend, no flip | SQL 81-city digest → `publish(support)` + `publish(digest)` + cache replace | Single-city SQL → `publish(support)` + Redis cache **patch**; no digest broadcast |
| Spend, flip | Same full digest + flip | Full digest rebuild → `publish(flip)` + `support` + `digest` + cache replace |
| Subscribe / reconnect | `loadOwnershipDigest` (cache-first) | Unchanged |
| HTTP spend body `digest` | Full array from SQL | Full array from patched cache (or SQL rebuild on miss / flip) |
| Client WS `support` | `prev.map` every tick | Index patch; skip setState when values unchanged |

## API helpers

- `ownershipDigestCity(db, plate)` — one-row digest shape
- `mergeDigestCity` / `spendFanoutMode` — pure; covered by `digestFanout.test.ts`
- `upsertCachedDigestCity` — patch Redis `cc:digest:cache` or rebuild on miss

## How to test

```bash
cd apps/api && npm test
# includes src/lib/digestFanout.test.ts
cd apps/api && npm run typecheck
cd apps/client && ./node_modules/.bin/tsc --noEmit
```

Manual WS: subscribe as guest → spend without flip → see `support` only; flip a city → `flip` + `support` + full `digest`.

## Explicit non-goals

- Map visual redesign / Floodlight Night (W4–W6)
- Spotlight rAF thrash (separate PR — `map-spotlight-pulse-perf`)
