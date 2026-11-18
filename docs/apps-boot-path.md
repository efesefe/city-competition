# Canonicalize `apps/` as the only boot path (W1) + legacy delete (D1)

**Date:** 2026-11-17 (W1) / 2026-11-18 (D1 delete)  
**Why:** Soft-launch readiness — newcomers must boot Expo + Fastify only. Decision **D1** deletes the Go/Next trees.

## What changed (W1)

| Area | Change |
|------|--------|
| Root `README.md` | Sole documented stack = `apps/client` + `apps/api` |
| `apps/README.md` | Clarifies sole boot path; compose = `apps/api/docker-compose.yml`; `.env` auto-load |
| Root `.env.example` | Pointer to `apps/*/.env.example` |
| Root `Makefile` | Defaults + targets for apps stack |
| `apps/api/src/loadEnv.ts` | Loads `apps/api/.env` on API / worker / migrate boot |

## What changed (D1)

Deleted legacy Go/Next product trees and leftovers that only served them:

- `frontend/` (Next.js)
- `backend/` (Go)
- `services/payments/` (Go-era payments microservice)
- Root `migrations/` (Go-era; **`apps/api/migrations/` kept**)
- Root `docker-compose.yml`, `docker/postgres/`, `docker/observability/`
- `prompts/` (Go/Next implementation prompts)
- `docs/frontend-docker-build.md`

## Required env

- **`DATABASE_URL`** — Postgres (local compose defaults: `postgres://city:city@127.0.0.1:5432/city_competition`)
- **`REDIS_URL`** — Redis (local: `redis://127.0.0.1:6379`)

## Local services

```bash
cd apps/api && docker compose up -d   # apps/api/docker-compose.yml only
```

## Test

```bash
cd apps/api && npm run typecheck && npm test
cd apps/client && npx tsc --noEmit
```
