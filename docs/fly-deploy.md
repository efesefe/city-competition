# Fly.io deploy — API + WebSocket + workers (`fra`)

**Date:** 2026-11-16  
**Tracker:** CC-41 (Wave 2 — Deploy API/WS/workers on Fly.io PAYG)  
**Region lock:** Frankfurt (`fra`)  
**App path:** [`apps/api`](../apps/api) (`fly.toml`, `Dockerfile`, `src/index.ts`, `src/worker.ts`)

API HTTP and live ownership WebSocket share the **`web`** process. Background jobs run as the **`worker`** process in the same Fly app (same image, separate Machines). Game spend/flip math is unchanged.

## Process model

| Process | Command | Role | Public |
|---------|---------|------|--------|
| `web` | `npm run start` | Fastify REST + `GET /v1/ws` (Redis pub/sub fan-out) | HTTPS `:443` → `:8787` |
| `worker` | `npm run start:worker` | TR calendar-day free-energy sweep + `notif_queue` stub drain | none |

`http_service` is attached only to `web`. Workers stay up without a proxy service (no auto-stop). `auto_stop_machines = "off"` on web keeps the WS gateway warm.

## Prerequisites

1. [flyctl](https://fly.io/docs/flyctl/install/) logged into a **Pay As You Go** org  
2. Postgres in EU — **Neon Launch (EU)** or **Fly Managed Postgres** (Basic/Starter)  
3. Redis in EU — **Upstash** (`rediss://…`) or equivalent  
4. From repo: `cd apps/api`

This environment may not have Fly credentials; the configs + steps below are the merge-ready recipe.

## One-time app create

```bash
cd apps/api
fly apps create city-competition-api --org <your-org>   # skip if app already exists
# Optional staging twin:
# fly apps create city-competition-api-staging --org <your-org>
```

Confirm `primary_region = "fra"` in `fly.toml` (already set).

## Required secrets

Set on the Fly app (never commit values; never put these in the Expo client):

```bash
fly secrets set \
  DATABASE_URL='postgres://…' \
  REDIS_URL='rediss://…' \
  DATABASE_SSL=true \
  -a city-competition-api
```

| Secret / env | Required | Notes |
|--------------|----------|-------|
| `DATABASE_URL` | **Yes** | Neon EU or Fly MPG connection string |
| `REDIS_URL` | **Yes** | Upstash TLS `rediss://…` (or non-TLS Redis for private net) |
| `DATABASE_SSL` | Prod yes | `true` for Neon / most managed Postgres |
| `PG_POOL_MAX` | Optional | Default `10` |
| `PORT` / `HOST` | Optional | Image defaults `8787` / `0.0.0.0` |
| `MOCK_OTP_CODE` | Dev only | Omit or rotate in prod once Netgsm is live |
| `NETGSM_USERCODE` / `NETGSM_PASSWORD` | When SMS live | OTP leaves |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | When Auth live | Advertised shape / later verify |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | When OAuth live | Still stubbed in slice |
| `WORKER_GRANT_POLL_MS` | Optional | Default `60000` |
| `WORKER_NOTIF_BRPOP_SEC` | Optional | Default `5` |
| `WORKER_GRANT_LOCK_TTL_SEC` | Optional | Default `55` — Redis single-flight for grant sweep |

Later Wave 5 (set when those leaves land; listed so ops knows the slot): iyzico keys, RevenueCat webhook secret, Sentry DSN, Expo push credentials.

## Deploy

```bash
cd apps/api
fly deploy -a city-competition-api
```

First deploy creates at least one Machine per process group (`web`, `worker`).

### Scale (PAYG)

```bash
# Baseline Season 0
fly scale count web=1 worker=1 -a city-competition-api

# Ahead of known match windows (keep rules; add Machines)
fly scale count web=2 worker=1 -a city-competition-api
```

Sizing is already in `fly.toml` (`[[vm]]` per process). Override ad hoc:

```bash
fly scale vm shared-cpu-1x --memory 512 --process-group web -a city-competition-api
fly scale vm shared-cpu-1x --memory 256 --process-group worker -a city-competition-api
```

## Verify

```bash
fly status -a city-competition-api
fly logs -a city-competition-api
curl -sS https://city-competition-api.fly.dev/health
# → {"ok":true,"db":"postgres","redis":"PONG", …}

# WS smoke (requires websocat or similar)
# websocat wss://city-competition-api.fly.dev/v1/ws
```

Worker logs should show a boot line `{ "svc":"worker", "ok":true, "redis":"PONG" }` and, when the queue has items, `notif_stub` lines. Grant sweeps log `tr_midnight_grant` when eligible users exist.

Point the client at the deployed API:

```bash
EXPO_PUBLIC_API_URL=https://city-competition-api.fly.dev
```

## Local parity (no Fly account)

```bash
cd apps/api
docker compose up -d
export DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition
export REDIS_URL=redis://127.0.0.1:6379
npm install
npm run start          # web — :8787
npm run start:worker   # worker — separate terminal
```

Image build check:

```bash
cd apps/api
docker build -t city-competition-api:local .
docker run --rm -e DATABASE_URL -e REDIS_URL -p 8787:8787 city-competition-api:local
# worker:
docker run --rm -e DATABASE_URL -e REDIS_URL city-competition-api:local npm run start:worker
```

## What the worker does / does not do

| Does | Does not |
|------|----------|
| Reuse `maybeGrantDailyEnergy` for TR calendar day | Rewrite spend / flip / ledger math |
| Redis lock so multiple workers don’t double-grant | Deliver Expo Push / APNs / FCM (stub log only) |
| BRPOP `notif_queue` and ack | Own HTTP ports or WS clients |

## Related

- [postgres-migration.md](postgres-migration.md) — `DATABASE_URL`  
- [redis-realtime-ops.md](redis-realtime-ops.md) — `REDIS_URL`, `cc:ownership`, `notif_queue`  
- [expo-fastify-slice.md](expo-fastify-slice.md) — slice behavior  
- Product architecture (store): Fly `fra` + PAYG Machines for API/WS/workers  
