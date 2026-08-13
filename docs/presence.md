# Presence tracking

Approximate online-user presence for the ambient "X people online" counter and tribe-chat presence dots. Low precision is intentional: TTL expiry is the cleanup mechanism, and the API is framed as `approximate_count`.

## Why SCARD (not HyperLogLog)

`GET /v1/presence/online-count` is implemented as **lazy prune + SCARD-equivalent count** of the `online:users` Redis SET, not `PFCOUNT`.

HyperLogLog (`PFADD` / `PFCOUNT`) cannot remove a user who goes offline, so it cannot represent presence. Rotating HLL time-buckets would add machinery without solving the other requirement: tribe chat needs an **enumerable list of user IDs** for green dots. Expected concurrency is thousands of sockets, not millions, so a SET with O(1) cardinality after prune is enough.

## Why a Redis set per tribe (not a Postgres join)

`GET /v1/tribes/{tribe_id}/online-members` reads `online:tribe:{tribe_id}`, not `users.tribe_id`.

Chat clients poll this on a ~30s cadence. A read-time join (`users.tribe_id` filtered by the current online IDs) would hit Postgres on every poll. Membership already lives on `users.tribe_id` (there is no `tribe_memberships` table); the tracker looks it up **once per TTL miss** during heartbeat and stores the tribe UUID as the `online:{user_id}` value.

Tradeoff: a tribe switch while the WebSocket stays connected can leave the user in the previous tribe set until the TTL key misses and membership is re-read (at most one TTL window, default 60s). Switch cooldown is 7 days, so this is acceptable. Reads still drop members whose TTL key is gone or whose stored tribe no longer matches, which is the consistency invariant that matters.

## Redis keys

| Key | Type | TTL | Role |
| --- | --- | --- | --- |
| `online:{user_id}` | STRING (tribe UUID or empty) | 60s, refreshed | Source of truth; expiry is cleanup |
| `online:users` | SET of user IDs | none (lazy prune) | Global count |
| `online:tribe:{tribe_id}` | SET of user IDs | none (lazy prune) | Chat presence list |

SET members do not expire. Every read `EXISTS`/`GET`-checks `online:{user_id}` and `SREM`s ghosts. Disconnect does **not** `DEL` these keys.

Two tabs for one user share one TTL key (users, not sockets).

## Heartbeat triggers

Every authenticated `/v1/ws/map` client:

1. Heartbeats on connect
2. Heartbeats on any inbound app message (`viewport`, `join`, `leave`, `ping`)
3. Heartbeats after a successful WebSocket protocol ping (~54s, already under the 60s TTL) so idle map viewers stay online

No explicit Redis cleanup on unregister. Account erasure calls `presence.ClearUser` so KVKK deletion does not wait for TTL.

## HTTP

- `GET /v1/presence/online-count` (session) → `{"approximate_count": N}`
- `GET /v1/tribes/{tribe_id}/online-members` (session, caller must be a member) → `{"user_ids": [...], "approximate_count": N}`

Frontend should label the count as approximate (for example `"~N kişi"`). The counter UI itself is a separate frontend prompt.

## How to test

From `backend/`:

```
go test ./internal/presence/ ./internal/realtime/ ./internal/erasure/ -count=1
```

Key cases:

- Unclean WebSocket drop (`CloseNow`) leaves the TTL key in place; `miniredis.FastForward` past TTL then count is 0
- Tribe `user_ids` are a subset of globally-online TTL keys; a user never appears in a tribe list while absent from the global count
