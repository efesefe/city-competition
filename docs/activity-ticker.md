# Nationwide activity ticker

Horizontal auto-scrolling strip on the map screen that shows conquests and large/derby supports from across the country, including cities outside the current viewport.

## Why this shape

- `GET /v1/activity-feed` and Redis `activity:feed` already exist. The hub fans `type: "activity_feed"` to every connected `/v1/ws/map` client (not viewport-filtered). The frontend previously dropped those frames.
- Snippets reuse the established locative grammar (`i18n.Locative` / `feed.Render`): city names get `-de/-da/-te/-ta` via [`frontend/lib/i18n/turkishSuffix.ts`](../frontend/lib/i18n/turkishSuffix.ts). Action templates live in next-intl ICU (`activityTicker.*`), not ad-hoc concatenated strings. English keeps the bare city name.
- The ticker is map-local (unlike capture toasts). It mounts in `map/page.tsx` below `DerbiBanner` and the fixed `CreditHeader`.

## Data flow

1. On mount, `ActivityTicker` fetches `GET /v1/activity-feed?limit=50` (newest first) and reverses to oldest → newest so new events enter from the right of a leftward scroll.
2. `useRealtime().subscribe()` listens for `activity_feed`. Live items append at that entry edge, deduped by `id`. Cap 50; oldest dropped from the left with scroll-offset compensation so the viewport does not jump.
3. Tribe labels come from `CityDataContext.tribesById` (`short_name`, then `display_name`).

## Auto-scroll

JS `requestAnimationFrame` translate, not a CSS animation (CSS loops reset when the track grows). Content is duplicated once for a seamless wrap. Pointer enter/down/focus pauses; resume ~1.2s after leave/up/blur. `prefers-reduced-motion` disables auto-scroll and allows manual pan.

## Tap

A ticker item sets `selectedIl` (city sheet stays in sync) and a `highlightPulse` `{ ilCode, nonce }` on `TurkiyeMap`. The nonce forces `flyTo` even when that city is already selected. A brief gold ring (`cities-ticker-highlight`, ~1.6s) sits above `cities-selected`.

Layer order: fill → outline → derby glow → selected → **ticker highlight** → labels → crests → HTML overlay.

## How to test

- Idle session: strip scrolls smoothly without jank.
- Tap an item: map recenters on that city and the highlight ring appears then clears.
- While touching/hovering the strip, a live event must not reset scroll position.
- Empty feed: strip is not rendered (no reserved height).
