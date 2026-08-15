# Conquest UI — capture toast, log, and own-flip celebration

Frontend reaction layer for every city ownership flip. Backend durability (`conquest_log`, unread cursor, `region_supported` Pub/Sub) already exists; this document covers how the app consumes it.

## Why this shape

- Toasts must fire on **any** tab, so `ConquestProvider` mounts in `(main)/layout.tsx` next to the other app-shell providers, not on the map page.
- The WebSocket `region_supported` event is **app-wide and anonymous**. It never includes `caused_flip`. Using it for the personal celebration would fire for witnesses.
- The spend that crosses the threshold is the causing support. `POST /v1/support` now returns `caused_flip` and `conquest_log_id` for that request only.

## Event flow

1. A spend commits. If leadership changed, the same transaction inserts `conquest_log` and attributes `causing_support_id`.
2. Redis publishes `region_supported:{il_code}`. The hub fans the event to every connected socket.
3. `realtimeSocket.ts` parses `region_supported` (previously dropped).
4. `ConquestContext` enqueues a capture toast (FIFO, one visible at a time, never drops) and increments the conquest unread count.
5. If the signed-in user just received `caused_flip: true` on their support POST, `reportOwnSupport` starts `CaptureCelebration`. Deduped by log id so HTTP + WS cannot double-fire.

## Toast queue

`frontend/lib/conquest/toastQueue.ts` is a pure FIFO:

- First event becomes `active`.
- Later events wait in `pending`.
- Dismiss (auto after ~4s, or tap) advances exactly one item.
- Duplicate ids are ignored.

Tap opens `/map?il={code}`. `TurkiyeMap` flies to that city’s centroid.

## Conquest log and the bell

| Endpoint | Role |
| --- | --- |
| `GET /v1/conquest-log?limit=&offset=` | Reverse-chronological pages; `next_offset` omitted on the last page |
| `GET /v1/conquest-log/unread-count` | Entries after `users.last_read_conquest_log_id` |
| `POST /v1/conquest-log/mark-read` | `{ all: true }` or `{ up_to_id }`; cursor never moves backwards |

The notification bell badge is **inbox unread + conquest unread**. Visiting `/conquest-log` calls mark-read `{ all: true }` then refreshes unread (expected 0). A second visit does not resurrect already-read rows. Entry points: notifications page card and profile link (`data-testid="conquest-log-link"`). Row tap goes to `/conquest-log/{id}` (SupporterBadge mounts there in a later prompt).

## Celebration gate

Fires only when `SupportResult.caused_flip === true` for the caller’s own most recent spend.

Does **not** fire for:

- Flips the user only witnessed over the socket
- Support that contributed but did not cross the threshold

Treatment: larger overlay than the toast, short particle burst (also at the projected city point when the map is open), Web Audio success tone, `navigator.vibrate` when present.

Sound respects:

- Settings toggle (`localStorage` key `captureCelebrationSound`, default on)
- Hidden tab (`document.hidden`)
- Device mute (Web Audio is silenced by the OS)

iOS hardware silent-switch detection is not available to web apps.

## How to test

### Manual QA — toast queue

Trigger several rapid test flips while on profile or leaderboard. Expect one slide-in banner at a time, in order, none dropped or overlapping.

### Manual QA — celebration gate

1. Contribute below the flip margin: generic toast only (if someone else flips) or no celebration on your spend.
2. Spend the amount that crosses the threshold: celebration overlay + sound/haptic, plus the queued toast.

### Automated

```bash
cd frontend && npm test -- lib/conquest lib/realtimeSocket.regionSupported.test.ts
```

Unread visit test: first visit marks read and unread becomes 0; second visit does not double-count prior rows; a live flip after mark-read increments from 0.
