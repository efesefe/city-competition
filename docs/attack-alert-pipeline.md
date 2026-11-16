# Attack alert pipeline (CC-57)

Season 0 Fastify path (`apps/api`): when a rival spends on a city, notify interested verified players over **push + in-app**, with a **5-minute** per-user coalesce.

Product source: store `docs/notifications-and-share.md` (owned + last-24h spent; coalesce 5 min).

## Who gets an alert

| Scope | Audience | Copy |
|-------|----------|------|
| **Owned** | Verified members of the city’s owner tribe (pre-flip), excluding the spender | `{City} saldırı altında` — rival is pushing; defend for your alias |
| **Last-24h spent** | Verified users who spent on this city in the rolling **24h** whose tribe ≠ spender tribe | `{City}'de savaş` — you backed this fight; rival is spending |

Same user in both scopes → **one** notification (owned copy wins). Guests and the spender never receive attack alerts. Same-tribe spends are non-triggers for both scopes.

## Coalesce

Redis `SET NX EX 300` on `coalesce:attack:{plate}:{userId}` plus buffer hash. First rival spend in the window dual-writes inbox + `notif_queue`; later spends in the same window only bump the buffer.

## Channels

| Channel | Mechanism |
|---------|-----------|
| **In-app** | Postgres `user_notifications` + `GET /v1/notifications` |
| **Push** | `LPUSH notif_queue` → in-process worker → device tokens in `device_push_tokens` (`LogPushSender` until FCM/APNs keys) |

Deep link: `/map?il={plate}` (city sheet / spend CTA).

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/v1/notifications` | Auth; `{ items, unread }` |
| `GET` | `/v1/notifications/unread-count` | Auth |
| `POST` | `/v1/notifications/read` | `{ ids }` or `{ all: true }` |
| `POST` | `/v1/notifications/push-token` | `{ token, platform }` |

Spend path calls `dispatchAttackAlerts` after commit (best-effort).

## Schema

Migration `012_notifications.sql`: `user_notifications`, `device_push_tokens`, index on `support_ledger (city_plate, created_at)`.

## How to test

```bash
cd apps/api
npm test
npm run typecheck
```

Manual: two verified users on rival tribes; user A owns (or recently spent on) a city; user B spends → A sees inbox row; second B spend within 5 min does not add another row for A. Register a push token to see worker log lines.

## Flip alerts

`noteFlip` coalesce hooks remain for **CC-58** (gain/loss push + in-app). Attack vs flip dedupe across the same burst is handled there.
