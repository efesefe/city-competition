# Admin match-day scheduling (CC-50 / CC-51)

**Date:** 2026-11-16  
**Branch:** `cursor/admin-match-day-boosts-aa83`  
**Tracker:** CC-50 (team boosts), CC-51 (derby timed wars)  
**Stack:** Season 0 Expo + Fastify (`apps/`) — not legacy Go/Next admin  
**Why:** Ops can schedule match week events without eng deploy (admin MVP checklist §1–2; season calendar templates A/B).

## Docs inspected

- Store: `admin-mvp-checklist.md`, `season-0-calendar.md`, `economy-sheet.md`, `architecture.md`
- Repo: `docs/personal-boost-logic.md` (CC-32 `team_boost_windows` + sim), open CC-28 match-day chrome (spotlight on same table)
- Prior: fixture/sim endpoints until this admin leaf

## What this leaf ships

| Piece | Detail |
|-------|--------|
| Migration `011_admin_match_day.sql` | `users.role`; window `kind`, `notes`, `canceled_at`, `created_by`, `spotlight_plate`, `label`, `involved_aliases` (IF NOT EXISTS — merges cleanly with CC-28) |
| `lib/admin-match-day.ts` | Fixture helper **kickoff −1h → FT +30m**; schedule / update / cancel; list; admin promote-sim |
| Spend snapshot | Ignores `canceled_at` rows and `boost_pct <= 1` (war-only spotlight) |
| Admin API | See endpoints below |
| Expo `/admin` | Thin ops UI: promote-sim → schedule boost / derby war → cancel |

## Defaults (locked)

| Event | Default |
|-------|---------|
| Team boost | **+25%** (`boost_pct = 1.25`), window **kickoff −1h → FT +30m**, admin-overridable |
| Derby timed war | City **spotlight** (`spotlight_plate`); same capture math; default **boost 1.0** (urgency only); optional +25% on host tribe; ops `involvedAliases` note |

## Endpoints

| Method | Path | Gate | Purpose |
|--------|------|------|---------|
| `POST` | `/v1/admin/promote-sim` | phone verified | Slice bootstrap → `role=admin` (OTP enrollment later) |
| `GET` | `/v1/admin/match-day` | admin | List windows (`?kind=`, `?includeCanceled=`) |
| `POST` | `/v1/admin/match-day/team-boosts` | admin | CC-50 schedule (+ `kickoffAt`/`fullTimeAt` **or** `startsAt`/`endsAt`) |
| `POST` | `/v1/admin/match-day/derby-wars` | admin | CC-51 schedule city war (`spotlightPlate` required) |
| `PATCH` | `/v1/admin/match-day/:id` | admin | Edit % / window / notes / spotlight |
| `POST` | `/v1/admin/match-day/:id/cancel` | admin | Soft-cancel |

## Example — schedule from fixture times

```bash
# After phone verify + promote-sim:
curl -s -X POST "$API/v1/admin/match-day/team-boosts" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "teamId": "sl_galatasaray",
    "kickoffAt": "2026-11-27T17:00:00.000Z",
    "fullTimeAt": "2026-11-27T18:50:00.000Z",
    "notes": "Aslan home GW"
  }'

curl -s -X POST "$API/v1/admin/match-day/derby-wars" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "teamId": "sl_galatasaray",
    "spotlightPlate": "34",
    "kickoffAt": "2026-11-27T17:00:00.000Z",
    "fullTimeAt": "2026-11-27T18:50:00.000Z",
    "involvedAliases": "Aslan Kabilesi, Kartal Kabilesi",
    "label": "İstanbul derbi"
  }'
```

## Still later

- Admin phone OTP on gated economy saves (CC-52+)
- Fixture-list import / MatchDay templates leaf
- Map chrome consumer of `spotlight_plate` (CC-28) — this leaf writes the rows chrome will read

## Test

```bash
cd apps/api && npm test && npm run typecheck
```
