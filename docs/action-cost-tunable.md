# Action cost tunable band (CC-31)

**Date:** 2026-11-16  
**Branch:** `cursor/tunable-action-cost-band-01d8`  
**Tracker:** CC-31  
**Why:** Attack/support must cost an **admin-tuned** integer inside the locked Season 0 band **10–20** (default **mid = 15**), using the existing `tunables` table from the map-auth-spend slice.

**Related:** Daily free energy grant is on main ([#47](https://github.com/efesefe/city-competition/pull/47), CC-30). Admin routes live in `apps/api/src/app.ts` (`buildApp`). This leaf does **not** rewrite Auth or the map atlas.

## Product rules

| Field | Value |
|-------|--------|
| Band | **10–20** inclusive (integer energy) |
| Default | **15** (mid-band) |
| Who sets it | Admin via API (Season 0 key gate) |
| Who pays it | Every attack/support spend debits the current tunable |
| Client | Shows `GET /v1/meta.actionCost`; no free-form amount entry |

Out-of-band or corrupt DB values are **coerced to 15** on read so spend never runs outside the product band.

## Storage

Table `tunables` (from `apps/api/migrations/001_init.sql`):

| key | value (text) | notes |
|-----|--------------|--------|
| `action_cost` | `"15"` default | Integer string in `10`…`20` |
| `free_daily_grant` | `"100"` | Unchanged by this leaf |

Seeded on API boot in `ensureSeedAndTunables` when missing.

## How admin sets cost

Season 0 ops use an **API key** header (full admin console + phone OTP gate is a later Admin leaf — Auth is not rewritten here).

1. Set secret on the API host:

```bash
export ADMIN_API_KEY='your-long-random-secret'
```

2. Read current tunables:

```bash
curl -s http://localhost:8787/v1/admin/tunables \
  -H "x-admin-key: $ADMIN_API_KEY"
# → { "actionCost": 15, "actionCostBand": { "min": 10, "max": 20, "default": 15 }, "freeDailyGrant": 100 }
```

3. Set cost inside the band (example → **12**):

```bash
curl -s -X PUT http://localhost:8787/v1/admin/tunables/action-cost \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"actionCost":12}'
# → { "ok": true, "previous": 15, "actionCost": 12, "actionCostBand": { … } }
```

4. Players pick up the new cost from `GET /v1/meta` (`actionCost` + `actionCostBand`). Spend without a matching `amount` (or with `amount` equal to the tunable) debits that value.

### Errors

| HTTP | `error` | When |
|------|---------|------|
| 503 | `admin_api_key_not_configured` | `ADMIN_API_KEY` unset |
| 401 | `admin_unauthorized` | Wrong / missing `x-admin-key` |
| 400 | `out_of_band` / `not_integer` | Value outside 10–20 or not an int |
| 400 | `action_cost_mismatch` | Spend body `amount` ≠ current tunable |

Without `ADMIN_API_KEY`, admin routes stay closed (503). Public `GET /v1/meta` still returns the live cost.

## Code map

| Path | Role |
|------|------|
| `apps/api/src/lib/actionCost.ts` | Band constants, parse/coerce, admin key check |
| `apps/api/src/lib/db.ts` | `getActionCost` / `setActionCost` on `tunables` |
| `apps/api/src/lib/game.ts` | Spend debits tunable; mismatch → `action_cost_mismatch` |
| `apps/api/src/index.ts` | `/v1/meta`, `GET/PUT /v1/admin/tunables…` |
| `apps/client/components/CitySheet.tsx` | Displays fixed meta cost (no free amount field) |

## Env

| Variable | Default | Notes |
|----------|---------|--------|
| `ADMIN_API_KEY` | unset | Required to call admin tunables routes |

## How to test

Unit (no Postgres):

```bash
cd apps/api && npm test
```

Manual against a running API:

```bash
export ADMIN_API_KEY=dev-admin
# restart API with the env set
curl -s http://localhost:8787/v1/meta | jq .actionCost,.actionCostBand
curl -s -X PUT http://localhost:8787/v1/admin/tunables/action-cost \
  -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"actionCost":18}'
# reject:
curl -s -X PUT http://localhost:8787/v1/admin/tunables/action-cost \
  -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"actionCost":9}'
```

## Out of scope

- Admin phone OTP console / audit UI (Wave 5 Admin)  
- Free-grant amount admin UI (same tunables row exists; write API later)  
- Sub daily +50, boosts (later Energy leaves)  
- Auth rewrite, map atlas rewrite  
