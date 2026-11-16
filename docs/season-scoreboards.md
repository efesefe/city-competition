# Season 0 scoreboards

**Date:** 2026-11-16  
**Leaves:** CC-65 (team cities owned), CC-66 (user support spent), CC-67 (guest browse)  
**Wireframes:** product `docs/wireframes.md` §9  

## Why

Ship the Season 0 competitive boards on the Expo + Fastify slice: team rank by **cities owned**, player rank by **total support spent** inside season bounds, both **browsable without login**.

## Season bounds

From locked calendar (`season-0-calendar.md`):

| Bound | Instant |
|-------|---------|
| Start | Thu 27 Nov 2026, 12:00 TR (`2026-11-27T09:00:00.000Z`) |
| End / freeze | Sun 23 May 2027, 23:59 TR (`2027-05-23T20:59:59.999Z`) |

Coded in `apps/api/src/lib/season.ts` (`SEASON_0` / `currentSeason()`).

- **Team board** uses **live** map ownership (`cities.owner_team_id`). Season meta is returned so the UI can show “Ends …” and future freeze/reset.
- **Player board** sums `support_ledger.energy_spent` where `created_at` is inside `[startsAt, endsAt]`.

## API (no auth required)

Routes live in `apps/api/src/app.ts` (`buildApp`).

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/v1/scoreboards` | Combined `{ teams, players, guestBrowse }` |
| `GET` | `/v1/scoreboards/teams` | Cities-owned ranks + season |
| `GET` | `/v1/scoreboards/players?limit=` | Support-spent ranks; optional `Authorization` adds `you` |
| `GET` | `/v1/scoreboard` | Legacy-compatible team payload (now includes season + ranks) |

Guest browse is intentional: endpoints never return 401 for missing sessions. Optional bearer only enriches the player board’s `you` row.

## Client

`apps/client/app/scoreboard.tsx` — **Team | Players** tabs, season label, end copy, guest note, ←you highlight when signed in.

## Migration

`apps/api/migrations/007_season_scoreboards.sql` — indexes on `support_ledger(created_at)` and `(user_id, created_at)`.

## Test

```bash
cd apps/api && npm test          # season bound unit tests
cd apps/api && npm run typecheck
```

Manual (with Postgres + Redis up):

```bash
curl -s localhost:8787/v1/scoreboards/teams | jq .season,.teams[0]
curl -s localhost:8787/v1/scoreboards/players | jq .metric,.guestBrowse
# Guest: no Authorization header — still 200
```

## Decisions

- Metric for players = **energy spent** on support (`energy_spent`), not boost-adjusted `support_credited`, matching locked “total support spent”.
- Off-season freeze behavior after 23 May 2027 remains open product-wise; boards keep serving live ownership + season-window spends until a later leaf.
