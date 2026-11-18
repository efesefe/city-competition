# CI — API + client checks (W7)

**Date:** 2026-11-18  
**Why:** Catch type and unit-test regressions on every PR without relying on local folklore. Soft-launch DX before week-0.

## Workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on:

- every **pull_request**
- every **push** to `main`

| Job | Working dir | Steps |
|-----|-------------|--------|
| API typecheck + test | `apps/api` | `npm ci` → `npm run typecheck` → `npm test` |
| Client typecheck | `apps/client` | `npm ci` → `npm run typecheck` (`tsc --noEmit`) |

- **Node:** `22` (matches `apps/api/Dockerfile` / Fly image).
- **Secrets:** none. API `npm test` is pure unit (`tsx --test`); it does **not** include `test:spend-load` (needs Postgres + Redis).
- **Expo web export:** not in CI — Metro export is slower and env-sensitive; typecheck is the cheap gate.
- **Concurrency:** one run per workflow+ref; newer runs cancel in-progress ones on the same ref.

## How to verify

1. Open the PR → **Checks** tab → jobs `API typecheck + test` and `Client typecheck` should go green.
2. Or locally (same commands CI runs):

```bash
cd apps/api && npm ci && npm run typecheck && npm test
cd apps/client && npm ci && npm run typecheck
```

3. YAML validity: GitHub parses the workflow on push; a syntax error shows as a failed workflow setup before jobs start.

## Out of scope (intentional)

- npm workspaces / root lockfile  
- DB-backed integration / spend load test in Actions  
- EAS / native builds  
- Expo `export` web smoke  
