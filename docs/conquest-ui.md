# Conquest UI — capture toast, log, supporter badge, and own-flip celebration

Frontend reaction layer for every city ownership flip. Backend durability (`conquest_log`, unread cursor, `region_supported` Pub/Sub, capture attribution) already exists; this document covers how the app consumes it.

## Why this shape

- Toasts must fire on **any** tab, so `ConquestProvider` mounts in `(main)/layout.tsx` next to the other app-shell providers, not on the map page.
- The WebSocket `region_supported` event is **app-wide and anonymous**. It never includes `caused_flip`. Using it for the personal celebration would fire for witnesses.
- The spend that crosses the threshold is the causing support. `POST /v1/support` now returns `caused_flip` and `conquest_log_id` for that request only.
- Ranked people come from `GET /v1/conquest-log/{log_id}/supporters`. The city support sheet does not receive a log id on `GET /v1/cities`, so it resolves the current capture with `GET /v1/conquest-log?il_code={il}&limit=1`.

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
- Dismiss (auto after ~4s, or collapse/map navigation) advances exactly one item.
- Duplicate ids are ignored.

First tap **expands** `SupporterBadge` (compact, `limit=5`) and pauses auto-dismiss. Nested **Open on map** still routes to `/map?il={code}` so `TurkiyeMap` can fly to that city’s centroid.

## Ranked supporters

`SupporterBadge` (`frontend/components/conquest/SupporterBadge.tsx`) fetches:

`GET /v1/conquest-log/{log_id}/supporters?limit=`

| Field | Use |
| --- | --- |
| `supporters[]` | Backend order is rank. The client never re-sorts. Rank = 1-based index. |
| `contribution` | Credits attributed to that capture window |
| `is_you` | Colored outline + `sen` / `you` chip at any rank |
| `avatar_url` | Image src; relative paths are prefixed with `API_BASE` |
| `total_contributor_count` | `+N kişi daha` when `total - returned > 0` |

Rank 1 gets a crown / `#1` marker. Later rows shrink via CSS `--weight` from index.

Avatar fallback: an initials disc (Turkish-uppercased letters, hue from `user_id`) is always painted. A broken, empty, or missing `avatar_url` hides the `<img>` so a ranked list never shows a broken-image icon.

Embeds:

| Surface | Behavior |
| --- | --- |
| Capture toast | Tap header to expand; fetch only then |
| Conquest log row | Accordion; nested detail + map links |
| `/conquest-log/{id}` | Always-on, full `limit=10` |
| City support sheet | Under the current-controller row; compact. Hidden when unowned or no log. Own flip prefers `conquest_log_id` from the spend response. |

## Conquest log and the bell

| Endpoint | Role |
| --- | --- |
| `GET /v1/conquest-log?limit=&offset=&il_code=` | Reverse-chronological pages; `il_code` optional (latest capture for a city); `next_offset` omitted on the last page |
| `GET /v1/conquest-log/{log_id}/supporters` | Ranked attributed contributors for one capture |
| `GET /v1/conquest-log/unread-count` | Entries after `users.last_read_conquest_log_id` |
| `POST /v1/conquest-log/mark-read` | `{ all: true }` or `{ up_to_id }`; cursor never moves backwards |

The notification bell badge is **inbox unread + conquest unread**. Visiting `/conquest-log` calls mark-read `{ all: true }` then refreshes unread (expected 0). A second visit does not resurrect already-read rows. Entry points: notifications page card and profile link (`data-testid="conquest-log-link"`). Row tap expands supporters; nested **Details** opens `/conquest-log/{id}`.

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

### Manual QA — supporter badge

1. Rank order matches the API array exactly (do not trust client-side contribution sort).
2. The signed-in user’s row is outlined with a `sen` / `you` chip at rank 1 and at later ranks.
3. A supporter with empty or broken `avatar_url` still shows a clean initials disc, never a broken image.
4. When `total_contributor_count` exceeds the returned list, `+N kişi daha` appears.
5. City support sheet for a held city shows the same named people under the controlling tribe.

### Automated

```bash
cd frontend && npm test -- lib/conquest lib/realtimeSocket.regionSupported.test.ts
```

Go (when `TEST_DATABASE_URL` is set):

```bash
cd backend && go test ./internal/conquest/ -count=1 -run 'TestConquestLogHTTP_FilterByIlCode|TestSupporters'
```

Unread visit test: first visit marks read and unread becomes 0; second visit does not double-count prior rows; a live flip after mark-read increments from 0.
