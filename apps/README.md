# City Competition — Expo + Fastify (sole boot path)

This is the **only** supported local/prod stack for Season 0.

## What this stack demos

1. Türkiye **81-province** clickable ownership map (SVG)  
2. **Guest** browse: map + city sheet + scoreboard only; shop / spend / Kabile → login (CC-23; no guest share)  
3. **Supabase Auth** — phone OTP + Google + Apple when `SUPABASE_*` / `EXPO_PUBLIC_SUPABASE_*` set; otherwise local mock OTP + OAuth stubs. Send SMS Hook → Netgsm when env live (dry-run otherwise)  

4. After verify → **Kabile pick** (Big 4 first, then rest) — unverified users get a phone verify wall (CC-21)  
5. Spend energy with **always-confirm**; live ownership flip over WebSocket — spend/claim require `phone_verified`  
 
6. Daily free energy **100** @ 00:00 TR — simulate via `POST /v1/energy/grant-sim`  
7. Cities seeded from **city-seed-matrix** (2–3 teams each)  
8. **iOS/Android IAP** (RevenueCat): shop packs 200/600/1500 + monthly sub; restore; webhook → server entitlements (see `docs/ios-iap-revenuecat.md`)
9. **Web iyzico** (CC-46): shop packs 200/600/1500 + monthly sub via Checkout Form / 3DS (mock by default); callback grants `paid_energy` / `sub_active` (see `docs/web-checkout-iyzico.md`)

## Run locally (web)

### 0. Postgres + Redis

`DATABASE_URL` and `REDIS_URL` are **required**. Canonical local services:

**`apps/api/docker-compose.yml`**.

```bash
cd apps/api
docker compose up -d
# → postgres://city:city@127.0.0.1:5432/city_competition
# → redis://127.0.0.1:6379
```

Or point `DATABASE_URL` at Neon / Fly MPG (`DATABASE_SSL=true` when needed) and `REDIS_URL` at Upstash (`rediss://…`) or any Redis.

### 1. API (terminal A)

```bash
cd apps/api
cp .env.example .env   # edit DATABASE_URL / REDIS_URL if needed
npm install
npm run dev
# → http://localhost:8787
# On boot: loads .env (if present; export wins), applies migrations/, seeds if empty, Redis ownership channel
```

The API / worker / migrate entrypoints load `apps/api/.env` automatically. Already-exported shell vars are not overridden. Fly/CI can omit the file and inject secrets only.

Health: `curl http://localhost:8787/health` → `200` with `"db":"postgres"`, `"redis":"PONG"` (or `503` + `errors` if either is down). Alias: `/healthz`.

Optional one-shot migrate without serving (also loads `.env`):

```bash
cd apps/api && npm run migrate
# or: DATABASE_URL=postgres://city:city@127.0.0.1:5432/city_competition npm run migrate
```

Makefile shortcuts from repo root: `make api-up`, `make api-dev`, `make client-web`.

### 2. Expo web (terminal B)

```bash
cd apps/client
cp .env.example .env   # optional; EXPO_PUBLIC_API_URL defaults in example
npm install
npm run web
# → Expo web (default port 8081)
# or: EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
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
| `SUPPORT_OPS_KEY` | — | CC-22 lost-SIM rebind ops Bearer (min 16 chars); see `docs/lost-sim-phone-rebind.md` |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Optional Admin API phone sync on rebind |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8787` | Client → API |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | — | Client Supabase SDK (match API project) |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | — | Public `appl_…` key; configures Purchases on iOS |
| `EXPO_PUBLIC_RC_IOS_PRODUCT_*` / `EXPO_PUBLIC_RC_ENTITLEMENT_SUB` | defaults in `lib/iapCatalog.ts` | Must match API `RC_IOS_*` |
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | — | API webhook auth (server-only) |
| `RC_IOS_PRODUCT_*` / `RC_ENTITLEMENT_SUB` | defaults in `iapCatalog.ts` | App Store / RC product ids |
| `ALLOW_IAP_STUB` | unset | `true` → `POST /v1/iap/stub` + force unpaid boost stubs on; `false` forces boost stubs off; unset → boost stubs on only when `NODE_ENV !== production` |
| `PUBLIC_API_BASE` | `http://127.0.0.1:$PORT` | Absolute base for iyzico CF callback + mock checkout |
| `IYZICO_MOCK` / `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` | mock when keys absent | Web Checkout Form / 3DS (see `.env.example`) |
| `IYZICO_PRICING_PLAN_REF` | — | Required for live subscription CF |

## Fly (`fra`) — API + WS + workers

Process groups in `apps/api/fly.toml`:

| Process | Command | Role |
|---------|---------|------|
| `web` | `npm run start` | HTTPS API + `GET /v1/ws` |
| `worker` | `npm run start:worker` | TR free-energy sweep + `notif_queue` stub drain |

| Doc | Use |
|-----|-----|
| [`docs/fly-deploy.md`](../docs/fly-deploy.md) | **CC-41** — create app, deploy, process groups |
| [`docs/fly-secrets-health-scale.md`](../docs/fly-secrets-health-scale.md) | **CC-42** — secrets checklist, `/health` 503, match-day scale |

```bash
cd apps/api
fly secrets set DATABASE_URL='…' REDIS_URL='…' DATABASE_SSL=true -a city-competition-api
fly deploy -a city-competition-api
fly scale count web=1 worker=1 -a city-competition-api
curl -sS https://city-competition-api.fly.dev/health   # expect 200 + ok:true
# Match window: fly scale count web=2 worker=1 -a city-competition-api
```

## Schema (migrations)

`apps/api/migrations/001_init.sql` creates:

- `teams` (aliases / colors / big4)  
- `cities` + `city_support` (ownership + cumulative tallies)  
- `users` (energy buckets + tribe) / `sessions` / `otp_codes`  
- `support_ledger` (append-only, unique `idempotency_key`)  
- `tunables` (`action_cost`, `free_daily_grant`)

`002_ledger_boost_snapshot.sql` adds `personal_boost_pct` / `team_boost_pct` on the ledger (defaults `1.0`).  
`003_supabase_auth.sql` adds `users.supabase_user_id`.  
`004_support_phone_rebind.sql` adds `support_audit_log` for Season 0 lost-SIM rebinds.  
`005_boost_state.sql` adds `users.personal_boost_expires_at` + `team_boost_windows` (CC-32).  
`011_admin_match_day.sql` adds admin `users.role` + window ops fields / derby spotlight cols (CC-50/51).

`016_iyzico_web.sql` adds `iyzico_checkouts` / `iyzico_grants` and `users.sub_active` (IF NOT EXISTS).

**Realtime:** ledger + `city_support` + owner flip commit in one Postgres transaction under `FOR UPDATE`; digest/flips fan out on Redis `cc:ownership`. See `docs/persist-ledger-live-flips.md`.

## Real vs stubbed

| Area | Real in slice | Stub / simulate |
|------|---------------|-----------------|
| Map 81 + ownership colors | Yes | — |
| Seed matrix 2–3 teams | Yes | — |
| Guest browse / scoreboard | Yes | Guest share = blocked by product (no map share UI) |
| Logged-in static share | Yes | Support + accomplishment SVG cards (`/v1/share/*`); guests cannot mint |
| Phone OTP session | Yes — Supabase SDK when env set; else local mock | SMS dry-run when Netgsm keys absent |
| Google / Apple | Supabase OAuth when env set | Stub buttons in mock mode → still need phone |
| Send SMS Hook | Endpoint + secret + Netgsm OTP (when env live) | Dry-run log without keys / dry-run flag |
| Spend + confirm + flip | Yes (Postgres `FOR UPDATE`, idempotent ledger, Redis live flip) | — |
| Personal boost +50%/1h | Timing/expiry + spend stack real | Purchase stub gated off in production (`unpaidBoostStubsEnabled`) |
| Team boost +25% | Applies when a window row is active | Admin schedule (`/v1/admin/match-day/team-boosts`); `/v1/boosts/team/sim` gated |
| Derby timed war | Spotlight plate on window row | Admin schedule (`/v1/admin/match-day/derby-wars`); fixture stub gated |
| Daily 100 energy | Claim + TR midnight worker | grant-sim gated by `ALLOW_ENERGY_GRANT_TRIGGERS` |
| Shop / IAP | RevenueCat native packs+sub (iOS+Android); stub via `ALLOW_IAP_STUB` | — |
| Shop / iyzico (web) | Checkout Form / 3DS + grants | Mock CF when keys absent; live needs sandbox keys + plan ref for sub |
| Redis pub/sub + rate limits + coalesce hooks | Yes (`REDIS_URL`) | — |
| Attack / flip alerts | Yes — **in-app inbox** + queue drain | Push = **log-only** (no FCM/APNs for soft launch) |
| Postgres | Yes (`DATABASE_URL`) | — |
| Lost-SIM phone rebind | Support API + audit (`SUPPORT_OPS_KEY`) | No self-serve UI |

## API sketch

- `GET /v1/map/digest` — 81 owners  
- `GET /v1/cities/:plate` — city sheet  
- `GET /v1/scoreboard`  
- `GET /v1/teams` — Big 4 first  
- `POST /v1/auth/phone/start|verify` — mock mode only  
- `POST /v1/auth/supabase/session` — exchange Supabase access_token → User  
- `POST /v1/auth/hooks/send-sms` — Supabase Send SMS Hook seam (CC-20)  
- `POST /v1/auth/oauth/:provider` — mock stub only  
- `GET /v1/support/users/lookup` — ops identity check (CC-22)  
- `POST /v1/support/phone/rebind` — lost-SIM rebind; progress preserved (CC-22)  
- `POST /v1/tribe/pick`  
- `POST /v1/cities/:plate/spend` — `{ confirmed: true, idempotencyKey }`  
- `POST /v1/energy/grant-sim` — simulate 00:00 TR  
- `POST /v1/boosts/personal/stub` — activate +50%/1h (no charge)  
- `POST /v1/boosts/team/sim` — open +25% tribe window (dev)  
- `POST /v1/admin/promote-sim` — bootstrap admin role  
- `GET/POST /v1/admin/match-day…` — schedule / list / cancel team boosts + derby wars  
- `POST /v1/payments/iyzico/checkout` — start web CF / 3DS (pack or sub)  
- `GET /v1/payments/iyzico/checkout/:id` — status + refreshed user  
- `POST /v1/payments/iyzico/callback` — CF return (token → grant)  
- `POST /v1/webhooks/iyzico` — signed webhook  
- `GET /v1/ws` — subscribe `digest` → 81-city ownership/support snapshot + live `support`/`flip`/`digest` (see `docs/websocket-city-digest.md`)

## Idempotent spend load test (CC-37)

```bash
cd apps/api && npm run test:spend-load
```
Requires `DATABASE_URL` + `REDIS_URL`.
