# Canonicalize `apps/` as the only boot path (W1)

**Date:** 2026-11-17  
**Branch:** `cursor/canonicalize-apps-boot-path-b18e`  
**Why:** Soft-launch readiness — newcomers must not boot the legacy Go/Next tree. Decision **D1** deletes `frontend/` / `backend/` in a follow-up PR after this quarantine-docs PR lands.

## What changed

| Area | Change |
|------|--------|
| Root `README.md` | Sole documented stack = `apps/client` + `apps/api`; quick start; legacy marked pending delete |
| `apps/README.md` | Clarifies sole boot path; compose = `apps/api/docker-compose.yml`; `.env` auto-load |
| Root `.env.example` | Retired Go/Next (`:8080`, `citycomp`, `NEXT_PUBLIC_*`) → pointer to `apps/*/.env.example` |
| Root `Makefile` | Defaults + targets for apps stack; removed Go `import-boundaries` default |
| `apps/api/src/loadEnv.ts` | Loads `apps/api/.env` on API / worker / migrate boot (export wins; missing file OK) |
| `apps/api/.env.example` | Notes auto-load + canonical compose path |

## Required env

- **`DATABASE_URL`** — Postgres (local compose defaults: `postgres://city:city@127.0.0.1:5432/city_competition`)
- **`REDIS_URL`** — Redis (local: `redis://127.0.0.1:6379`)

## Local services

```bash
cd apps/api && docker compose up -d   # apps/api/docker-compose.yml only
```

Do **not** use root `docker-compose.yml` (PostGIS + Go backend + Next + payments) for Season 0.

## Test

```bash
cd apps/api && npm run typecheck && npm test
```

## Follow-up (not this PR)

Delete legacy `frontend/`, `backend/`, root `docker-compose.yml`, root Go migrations, `services/payments/`, observability compose wiring, and Go-era Makefile/data import paths per **D1**.
