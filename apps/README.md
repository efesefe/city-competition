# City Competition — vertical slice (Expo + Fastify)

Locked stack path for Season 0 (see product `architecture.md`).  
Legacy `frontend/` (Next.js) and `backend/` (Go) remain in the repo but are **not** this slice.

## What this slice demos

1. Türkiye **81-province** clickable ownership map (SVG)  
2. **Guest** browse: map + city sheet + scoreboard (no guest share)  
3. Auth stubs in **Supabase Auth shape** — phone OTP (mock SMS if Netgsm keys absent); Google/Apple stub buttons  
4. After verify → **Kabile pick** (Big 4 first, then rest)  
5. Spend energy with **always-confirm**; live ownership flip over WebSocket  
6. Daily free energy **100** @ 00:00 TR — simulate via `POST /v1/energy/grant-sim`  
7. Cities seeded from **city-seed-matrix** (2–3 teams each)

## Run locally (web)

### 0. Postgres

`DATABASE_URL` is required. Use local Docker, Neon (EU), or Fly Managed Postgres.

```bash
cd apps/api
docker compose up -d
# → postgres://city:city@127.0.0.1:5432/city_competition
```

Or point `DATABASE_URL` at a Neon / Fly MPG connection string. Set `DATABASE_SSL=true` for managed TLS.

### 1. API (terminal A)

```bash
cd apps/api
cp .env.example .env   # edit DATABASE_URL if needed
npm install
npm run dev
# → http://localhost:8787
# On boot: applies migrations/ + seeds teams/cities if empty
```

Health: `curl http://localhost:8787/health` → `"db":"postgres"`

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
| `MOCK_OTP_CODE` | `123456` | Used when Netgsm keys absent |
| `NETGSM_USERCODE` / `NETGSM_PASSWORD` | — | If set, OTP is random (SMS hook placeholder) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | — | Advertised in `/v1/meta` (shape only) |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | — | OAuth still stubbed in slice |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8787` | Client → API |

## Fly-ready

`apps/api/fly.toml` targets `fra`. Set Fly secret `DATABASE_URL` (Neon EU or Fly MPG). Redis / full deploy are later Wave 2 leaves — this PR only needs Postgres.

## Schema (migrations)

`apps/api/migrations/001_init.sql` creates:

- `teams` (aliases / colors / big4)  
- `cities` + `city_support` (ownership + cumulative tallies)  
- `users` (energy buckets + tribe) / `sessions` / `otp_codes`  
- `support_ledger` (append-only, unique `idempotency_key`)  
- `tunables` (`action_cost`, `free_daily_grant`)

**Realtime handoff:** ledger + `city_support` + owner flip already commit in one Postgres transaction. Keep that atomicity; add boost snapshot columns when match-day/personal boost land; fan-out digest/flips via Redis in the next leaf.

## Real vs stubbed

| Area | Real in slice | Stub / simulate |
|------|---------------|-----------------|
| Map 81 + ownership colors | Yes | — |
| Seed matrix 2–3 teams | Yes | — |
| Guest browse / scoreboard | Yes | Guest share = blocked by product (no UI) |
| Phone OTP session | Yes (local) | SMS = mock without Netgsm; not live Supabase project |
| Google / Apple | Buttons | Always stub login → still need phone |
| Spend + confirm + flip | Yes | Boosts = 1.0 (no match-day / personal boost shop) |
| Daily 100 energy | Claim + grant-sim | No TR-midnight cron yet |
| Shop / iyzico / IAP | UI stub | No payments |
| Redis | — | In-memory pub/sub |
| Postgres | Yes (`DATABASE_URL`) | — |

## API sketch

- `GET /v1/map/digest` — 81 owners  
- `GET /v1/cities/:plate` — city sheet  
- `GET /v1/scoreboard`  
- `GET /v1/teams` — Big 4 first  
- `POST /v1/auth/phone/start|verify`  
- `POST /v1/auth/oauth/:provider` — stub  
- `POST /v1/tribe/pick`  
- `POST /v1/cities/:plate/spend` — `{ confirmed: true, idempotencyKey }`  
- `POST /v1/energy/grant-sim` — simulate 00:00 TR  
- `GET /v1/ws` — ownership digest + flip deltas  
