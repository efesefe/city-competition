# City Competition

Realtime Türkiye map game for football fans — claim provinces for your Kabile.

## Stack (only supported boot path)

Season 0 product lives under **`apps/`**:

| Path | Role |
|------|------|
| **`apps/client`** | Expo (iOS / Android / web) |
| **`apps/api`** | Fastify TypeScript API + WebSocket ownership digest |

**Full local runbook:** [`apps/README.md`](apps/README.md)

### Quick start

```bash
# 1. Postgres + Redis
cd apps/api
cp .env.example .env          # DATABASE_URL + REDIS_URL required
docker compose up -d          # → apps/api/docker-compose.yml
npm install && npm run dev    # loads .env; → http://localhost:8787

# 2. Expo web (other terminal)
cd apps/client
cp .env.example .env          # optional; defaults to localhost:8787
npm install
npm run web                   # → http://localhost:8081
```

Required API env: **`DATABASE_URL`**, **`REDIS_URL`**.  
Local defaults from compose: `postgres://city:city@127.0.0.1:5432/city_competition` and `redis://127.0.0.1:6379`.

Env templates: [`apps/api/.env.example`](apps/api/.env.example), [`apps/client/.env.example`](apps/client/.env.example).  
Root [`.env.example`](.env.example) only points at those.

### CI

GitHub Actions (`.github/workflows/ci.yml`) on every PR and push to `main`:

- `apps/api` — `npm ci` → `npm run typecheck` → `npm test` (unit only; no DB/Redis)
- `apps/client` — `npm ci` → `npm run typecheck` (`tsc --noEmit`)

Node **22** (same as `apps/api/Dockerfile`). See [`docs/ci.md`](docs/ci.md).
