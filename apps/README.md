# City Competition — vertical slice (Expo + Fastify)

Locked stack path for Season 0 (see product `architecture.md`).  
Legacy `frontend/` (Next.js) and `backend/` (Go) remain in the repo but are **not** this slice.

## What this slice demos

1. Türkiye **81-province** clickable ownership map (SVG)  
2. **Guest** browse: map + city sheet + scoreboard only; shop / spend / Kabile → login (CC-23; no guest share)  
3. **Supabase Auth** — phone OTP + Google + Apple when `SUPABASE_*` / `EXPO_PUBLIC_SUPABASE_*` set; otherwise local mock OTP + OAuth stubs. Send SMS Hook → Netgsm when env live (dry-run otherwise)  

4. After verify → **Kabile pick** (Big 4 first, then rest) — unverified users get a phone verify wall (CC-21)  
5. Spend energy with **always-confirm**; live ownership flip over WebSocket — spend/claim require `phone_verified`  
 
6. Daily free energy **100** @ 00:00 TR — simulate via `POST /v1/energy/grant-sim`  
7. Cities seeded from **city-seed-matrix** (2–3 teams each)

## Run locally (web)

### 0. Postgres

`DATABASE_URL` is required. Use local Docker, Neon (EU), or Fly Managed Postgres.

```bash
cd apps/api
docker compose up -d
# → postgres://city:city@127.0.0.1:5432/city_competition
# → redis://127.0.0.1:6379
```

Or point `DATABASE_URL` at a Neon / Fly MPG connection string (`DATABASE_SSL=true` when needed) and `REDIS_URL` at Upstash (`rediss://…`) or any local Redis.

### 1. API (terminal A)

```bash
cd apps/api
cp .env.example .env   # edit DATABASE_URL / REDIS_URL if needed
npm install
npm run dev
# → http://localhost:8787
# On boot: applies migrations/ + seeds teams/cities if empty; subscribes to Redis ownership channel
```

Health: `curl http://localhost:8787/health` → `"db":"postgres"`, `"redis":"PONG"`

Optional one-shot migrate without serving:

```bash
DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition npm run migrate
```

### 2. Expo web (terminal B)

```bash
cd apps/client
npm install
EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
# → Expo web (default port 8081)
```

### Happy path

1. Open the map as guest → tap a province → city sheet  
2. **Katıl** → phone OTP (dev mock code `123456`, also returned by API)  
3. Pick a Kabile (Big 4 listed first) → daily energy auto-simulated on pick  
4. Open a city → **Harca** → confirm → watch map color / WS flip banner  
5. Scoreboard browse works as guest  

## Env

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | `8787` | API |
| `DATABASE_URL` | — | **Required.** Neon / Fly MPG / local `docker compose` |
| `DATABASE_SSL` | unset | Set `true` for Neon / managed TLS |
| `PG_POOL_MAX` | `10` | `pg` pool size |
| `REDIS_URL` | — | **Required.** Upstash `rediss://` or local `redis://127.0.0.1:6379` |
| `MOCK_OTP_CODE` | `123456` | Mock mode only (no Supabase JWT secret) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` | — | Live Auth: JWT verify + `/v1/auth/supabase/session` |
| `SEND_SMS_HOOK_SECRETS` | — | Auth for `POST /v1/auth/hooks/send-sms` |
| `SMS_HOOK_DRY_RUN` | `true` (implicit) | Set `false` for live Netgsm |
| `NETGSM_USERCODE` / `NETGSM_PASSWORD` / `NETGSM_MSGHEADER` | — | Live OTP via Netgsm v3 (`docs/netgsm-otp-sms-hook.md`) |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | — | Optional `/v1/meta` flags when live |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8787` | Client → API |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | — | Client Supabase SDK (match API project) |

## Fly-ready

`apps/api/fly.toml` targets `fra`. Set Fly secrets `DATABASE_URL` (Neon EU or Fly MPG) and `REDIS_URL` (Upstash EU). Full Fly scale runbook is a later Wave 2 leaf.

## Schema (migrations)

`apps/api/migrations/001_init.sql` creates:

- `teams` (aliases / colors / big4)  
- `cities` + `city_support` (ownership + cumulative tallies)  
- `users` (energy buckets + tribe) / `sessions` / `otp_codes`  
- `support_ledger` (append-only, unique `idempotency_key`)  
- `tunables` (`action_cost`, `free_daily_grant`)

`002_ledger_boost_snapshot.sql` adds `personal_boost_pct` / `team_boost_pct` on the ledger (defaults `1.0`).

**Realtime:** ledger + `city_support` + owner flip commit in one Postgres transaction under `FOR UPDATE`; digest/flips fan out on Redis `cc:ownership`. See `docs/persist-ledger-live-flips.md`.

## Real vs stubbed

| Area | Real in slice | Stub / simulate |
|------|---------------|-----------------|
| Map 81 + ownership colors | Yes | — |
| Seed matrix 2–3 teams | Yes | — |
| Guest browse / scoreboard | Yes | Guest share = blocked by product (no UI) |
| Phone OTP session | Yes — Supabase SDK when env set; else local mock | SMS dry-run when Netgsm keys absent |
| Google / Apple | Supabase OAuth when env set | Stub buttons in mock mode → still need phone |
| Send SMS Hook | Endpoint + secret + Netgsm OTP (when env live) | Dry-run log without keys / dry-run flag |
| Spend + confirm + flip | Yes (Postgres `FOR UPDATE`, idempotent ledger, Redis live flip) | Boost multipliers still `1.0` until shop / match-day |
| Daily 100 energy | Claim + grant-sim | No TR-midnight cron yet |
| Shop / iyzico / IAP | UI stub | No payments |
| Redis pub/sub + rate limits + coalesce hooks | Yes (`REDIS_URL`) | Push delivery worker still stub |
| Postgres | Yes (`DATABASE_URL`) | — |

## API sketch

- `GET /v1/map/digest` — 81 owners  
- `GET /v1/cities/:plate` — city sheet  
- `GET /v1/scoreboard`  
- `GET /v1/teams` — Big 4 first  
- `POST /v1/auth/phone/start|verify` — mock mode only  
- `POST /v1/auth/supabase/session` — exchange Supabase access_token → User  
- `POST /v1/auth/hooks/send-sms` — Supabase Send SMS Hook seam (CC-20)  
- `POST /v1/auth/oauth/:provider` — mock stub only  
- `POST /v1/tribe/pick`  
- `POST /v1/cities/:plate/spend` — `{ confirmed: true, idempotencyKey }`  
- `POST /v1/energy/grant-sim` — simulate 00:00 TR  
- `GET /v1/ws` — subscribe `digest` → 81-city ownership/support snapshot + live `support`/`flip`/`digest` (see `docs/websocket-city-digest.md`) 
