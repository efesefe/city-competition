# Fly secrets, health checks, and match-day scale (`fra`)

**Date:** 2026-11-16  
**Tracker:** CC-42 (Wave 2 — Document secrets, health, and scale)  
**Region lock:** Frankfurt (`fra`)  
**App:** `city-competition-api` (`apps/api/fly.toml`)  
**Companion:** [fly-deploy.md](fly-deploy.md) (CC-41 — create/deploy/`web`+`worker` process groups; merged via [PR #54](https://github.com/efesefe/city-competition/pull/54))

This is the **ops runbook** for Season 0 soft-launch and fixture spikes. Policy: **scale servers, never capture math** (no spend/flip/boost rule changes under load).

---

## 1. Env / secrets checklist

### 1.1 Required on every Fly Machine (web + worker)

Set with `fly secrets set` — never commit values; never ship server secrets in Expo/`EXPO_PUBLIC_*`.

| Name | Required | Local `.env` | Fly secret | Notes |
|------|----------|--------------|------------|-------|
| `DATABASE_URL` | **Yes** | yes | **yes** | Neon EU or Fly MPG. Prefer pooler URL only if migrations still work against it; otherwise direct for migrate + pooler for app. |
| `REDIS_URL` | **Yes** | yes | **yes** | Upstash EU `rediss://…` (TLS) or private Redis. |
| `DATABASE_SSL` | Prod **yes** | optional | **yes** (`true`) | Neon / most managed Postgres. |
| `PORT` | No | `8787` | image default | Fly `http_service.internal_port = 8787`. |
| `HOST` | No | `0.0.0.0` | image default | Bind all interfaces in the Machine. |
| `PG_POOL_MAX` | No | `10` | optional | Raise carefully with Machine count × Postgres max connections. |

### 1.2 Auth / SMS (set when those leaves go live)

| Name | When | Notes |
|------|------|-------|
| `MOCK_OTP_CODE` | Local / staging only | **Omit in prod** once Netgsm is live. |
| `NETGSM_USERCODE` / `NETGSM_PASSWORD` | SMS live | Enables random OTP + SMS hook path. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase Auth live | Advertised via `/v1/meta`; service role stays server-only if added later. |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | OAuth live | Slice still stubs OAuth until wired. |

### 1.3 Worker knobs (CC-41 `worker` process)

| Name | Default | Notes |
|------|---------|-------|
| `WORKER_GRANT_POLL_MS` | `60000` | TR free-energy sweep interval. |
| `WORKER_NOTIF_BRPOP_SEC` | `5` | `notif_queue` BRPOP timeout. |
| `WORKER_GRANT_LOCK_TTL_SEC` | `55` | Redis single-flight lock for grant sweep. |

### 1.4 Later Wave 5 slots (reserve names; leave unset until leaves land)

| Name | Purpose |
|------|---------|
| iyzico keys | Web checkout |
| RevenueCat webhook secret | Native entitlement verify |
| Sentry DSN | API errors |
| Expo push credentials | Real push delivery (queue already real) |

### 1.5 Pre-deploy secrets verify

```bash
cd apps/api
fly secrets list -a city-competition-api
# Expect at least: DATABASE_URL, REDIS_URL, DATABASE_SSL

# After deploy — see §2
curl -sS -o /tmp/cc-health.json -w "%{http_code}\n" \
  https://city-competition-api.fly.dev/health
cat /tmp/cc-health.json
```

**Pass:** HTTP `200` and `"ok":true`, `"db":"postgres"`, `"redis":"PONG"`.  
**Fail:** HTTP `503` with `"reason"` / `"errors"` listing `db_unreachable` and/or `redis_unreachable` — fix secrets/network before traffic.

Local template: [`apps/api/.env.example`](../apps/api/.env.example).

---

## 2. Health checks

### 2.1 Endpoints

| Path | Role |
|------|------|
| `GET /health` | Primary — Fly `http_service.checks` + ops curls |
| `GET /healthz` | Alias (same body / status) |

**Success (200):**

```json
{
  "ok": true,
  "service": "city-competition-api",
  "slice": "map-auth-spend",
  "db": "postgres",
  "redis": "PONG",
  "wsClients": 0,
  "auth": { "...": "mode flags" }
}
```

**Failure (503)** — never a silent 200 when DB or Redis is down:

```json
{
  "ok": false,
  "service": "city-competition-api",
  "db": null,
  "redis": null,
  "reason": "db_unreachable,redis_unreachable",
  "errors": ["db_unreachable", "redis_unreachable"]
}
```

### 2.2 Fly proxy check (wired in `fly.toml`)

```toml
[[http_service.checks]]
  interval = "15s"
  timeout = "5s"
  grace_period = "20s"
  method = "GET"
  path = "/health"
```

CC-41 attaches this check to the **`web`** process only (workers have no public HTTP). Health handlers live in `apps/api/src/app.ts` (`buildApp`).

### 2.3 Manual / staging smoke

```bash
# Local
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/healthz

# Prod / staging
curl -sS https://city-competition-api.fly.dev/health
fly checks list -a city-competition-api
fly status -a city-competition-api
fly logs -a city-competition-api
```

**WS readiness (separate from HTTP health):** after HTTP is green, open `wss://…/v1/ws` and expect an initial `{ "type":"digest", "cities":[…] }` (81 plates). HTTP `/health` does **not** fail when `wsClients` is 0.

### 2.4 Failure playbook

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| 503 `db_unreachable` | Bad `DATABASE_URL`, SSL, Neon paused, IP allowlist | `fly secrets` + Neon/MPG dashboard; confirm `DATABASE_SSL=true` |
| 503 `redis_unreachable` | Bad `REDIS_URL`, Upstash TLS, region mismatch | Fix `rediss://` URL; keep Redis EU near `fra` |
| Fly check failing, curl 200 | Wrong process / port / path | Confirm check path `/health`, port `8787`, `web` group |
| 200 but map stale | Pub/sub or single Machine issue | Check Redis `cc:ownership`; scale `web` ≥ 1 always-on |

---

## 3. Match-day scale steps (`fra`)

**Non-negotiable:** do **not** change action cost, flip rules, boost %, or ledger semantics because of traffic. Scale Machines / Redis / Postgres tiers; shed non-critical work first.

Calendar anchors: product store `season-0-calendar.md` (soft-launch week of **24–30 Nov 2026**, target **Thu 27 Nov**). Boost windows: kickoff **−1h → FT +30m**.

### 3.1 Baseline (quiet days)

```bash
# After CC-41 process groups exist:
fly scale count web=1 worker=1 -a city-competition-api

# Prefer always-on WS gateway (CC-41 sets auto_stop_machines = "off")
fly status -a city-competition-api
```

Sizing defaults: `web` 512MB shared-cpu-1x; `worker` 256MB (see CC-41 `fly.toml`).

### 3.2 T−24h (known fixture / derby)

1. Confirm fixtures + admin boost/derby events are scheduled.  
2. Secrets + health green (§1.5 / §2).  
3. Optionally bump Postgres/Redis plan if quiet-day headroom is already thin (Neon compute / Upstash Fixed).  
4. Pre-create scale commands in the ops channel (copy-paste ready).

### 3.3 T−90m → T−60m (scale up)

```bash
# Typical Süper Lig evening — add a second web Machine for API+WS
fly scale count web=2 worker=1 -a city-competition-api

# Hot derby / launch night — more WS fan-out capacity
fly scale count web=3 worker=1 -a city-competition-api

# Verify every Machine passes health
fly checks list -a city-competition-api
curl -sS https://city-competition-api.fly.dev/health
```

Optional VM bump (only if CPU/memory saturates before connection limits):

```bash
fly scale vm shared-cpu-2x --memory 1024 --process-group web -a city-competition-api
```

Keep **`worker=1`** unless grant/queue lag appears; grants are locked via Redis single-flight.

### 3.4 During the window (kickoff −1h → FT +30m)

| Watch | Source | Healthy signal |
|-------|--------|----------------|
| HTTP health | `/health` + Fly checks | Continuous 200 |
| Spend errors | `fly logs` / future Sentry | No spike in 5xx / `rate_limit` storms beyond design |
| WS | Client map + `wsClients` on `/health` | Digests/flips arrive; reconnect recovers |
| Redis | Upstash metrics | Command rate / latency within plan |
| Postgres | Neon/MPG metrics | Connections < max; no lock pile-ups beyond spend `FOR UPDATE` |

**Degradation order (shed first → last):**

1. Share-image render / heavy cosmetics  
2. Verbose analytics  
3. Push delivery lag (coalesce buffers already absorb bursts; queue drain can lag)  
4. **Never** shed authoritative spend or ownership fan-out; **never** nerf combat math  

### 3.5 T+30m after FT (scale down)

```bash
fly scale count web=1 worker=1 -a city-competition-api
# If VM was bumped:
fly scale vm shared-cpu-1x --memory 512 --process-group web -a city-competition-api
curl -sS https://city-competition-api.fly.dev/health
```

### 3.6 Soft-launch night (27 Nov 2026 target) — one-page

| When (TR) | Action |
|-----------|--------|
| Morning | Secrets list + `/health` 200; staging smoke spend + WS digest |
| T−90m | `fly scale count web=2 worker=1` (or `web=3` if marketing push is large) |
| Window | Watch logs + health; do not change tunables mid-spike |
| T+30m | Scale back to `web=1 worker=1`; note incidents for next fixture |

---

## 4. Coordination with deploy PR (CC-41)

| Concern | This doc (CC-42) | [fly-deploy.md](fly-deploy.md) (CC-41) |
|---------|------------------|----------------------------------------|
| App create / `fly deploy` | Points here for ops verify | Canonical recipe |
| `web` + `worker` processes | Assumes them for scale commands | Introduces `worker.ts` + `fly.toml` groups |
| Secrets table | Full checklist + later Wave 5 slots | Required set + worker knobs |
| `/health` 503 semantics | Canonical | Verify curl after deploy |
| Match-day timeline | Canonical | Short `fly scale count` examples |

CC-41 is already on `main` (#54). This runbook is the match-day checklist; do not duplicate process-group definitions here.

---

## 5. Related

- [postgres-migration.md](postgres-migration.md) — `DATABASE_URL`  
- [redis-realtime-ops.md](redis-realtime-ops.md) — `REDIS_URL`, pub/sub, rate limits  
- [persist-ledger-live-flips.md](persist-ledger-live-flips.md) — spend under `FOR UPDATE`  
- [expo-fastify-slice.md](expo-fastify-slice.md) — local slice behavior  
- Product store: `architecture.md`, `third-party-providers.md`, `season-0-calendar.md`, tech spike #10 (match-day autoscaling)
