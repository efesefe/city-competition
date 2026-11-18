# Legacy Go/Next tree delete (D1)

**Date:** 2026-11-18  
**Branch:** `cursor/delete-legacy-trees-4a9e`  
**Decision:** D1 locked — **delete** (not archive) after W1 canonicalized `apps/` as the sole boot path.

## Deleted top-level paths

| Path | Role (retired) |
|------|----------------|
| `frontend/` | Next.js product UI |
| `backend/` | Go API |
| `services/` (`payments/`) | Go-era payments microservice |
| `migrations/` | Go-era SQL (kept `apps/api/migrations/`) |
| `docker-compose.yml` | PostGIS + Go + Next + payments + observability |
| `docker/` | `postgres/` init + `observability/` stack for root compose |
| `prompts/` | Go/Next implementation prompts |
| `docs/frontend-docker-build.md` | Next image build notes |

## Pointers updated

- Root `README.md`, `apps/README.md`, `.env.example`, `Makefile`, `.gitignore`
- `docs/apps-boot-path.md`, `docs/index.md`
- `data/README-boundaries.md` — Go `make import-boundaries` removed; Season 0 map is SVG atlas under `apps/client`

## Guardrails

- `apps/api` Fly config (`fly.toml`) still builds from `apps/api/Dockerfile`
- Canonical compose remains `apps/api/docker-compose.yml`
- Verify: `apps/api` typecheck + `npm test`; `apps/client` `tsc --noEmit`
