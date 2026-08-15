# Derby urgency map styling

Visual treatment on the Türkiye map for an active or imminent derby city — fill intensity, pulsing outline, crest badge, and countdown chip. Complements `DerbiBanner` (which stays tribe-filtered at the top of the map screen).

## Why this shape

- City fills already use MapLibre **feature-state** (`primary_color`) so ownership can update without refetching polygons. Derby urgency adds a second flag, `derbi_active`, merged the same way.
- MapLibre cannot saturate a hex color in-place. Held non-derby cities are slightly muted by interpolating the tribe color toward neutral gray (`interpolate-hcl` at 0.78). The derby city uses full intensity (1) and a higher fill opacity (0.94 vs 0.78).
- The pulse is a **duplicate line layer** (`cities-derbi-glow`), never the fill. Animation is `setPaintProperty` on opacity/width (one or two calls per frame), not per-frame `setFeatureState`.
- Countdown chip and lightning badge are HTML `Marker`s in `DerbiCityOverlay`, so they track pan/zoom with the map camera and stay off the label glyph layer.

## Data flow

1. `map/page.tsx` already polls `GET /v1/derbies` every 60s for `DerbiBanner`. The same `derbies` array is passed into `TurkiyeMap`.
2. Eligibility reuses banner rules (`active` with `ends_at > now`, or `scheduled` within 24h), plus a client bridge: a `scheduled` derby whose `starts_at` has passed stays urgent until `ends_at` so a late poll cannot blank the city.
3. `selectUrgencyDerbies` keeps one derby per `il_code` (active wins).
4. `applyDerbiActiveStates` sets `derbi_active: true` on those cities and `false` on any city that dropped out.
5. A local clock ticks at least once per minute and at the next `starts_at` / `ends_at` / 24h-window-open, so glow, saturation, and chips clear as soon as the event ends — no manual refresh, no waiting for the HTTP poll.

Map urgency is **city-based** (any eligible derby). The banner remains **tribe-filtered**.

## Layers (bottom → top)

`cities-fill` → `cities-outline` → `cities-derbi-glow` → `cities-selected` → `cities-ticker-highlight` (brief ticker pulse) → labels → crests → HTML overlay (badge + chip)

The glow sits under labels so the pulse does not cover the city name. The badge is offset toward the crest (above the centroid); the chip sits below the label.

Chip copy (next-intl `map.derbiUrgency`):

- Active: `{hours}s {minutes}dk kaldı` (hours omitted under 60 minutes)
- Scheduled, not started: `Yakında · {HH:mm}` in Europe/Istanbul

## Performance

- Pulse runs only while at least one city is urgent.
- Pauses on `document.hidden`.
- Static glow (no rAF) when performance mode is on or `prefers-reduced-motion: reduce`.

## How to test

1. Country-wide zoom: derby city fill is full-intensity vs muted held neighbors; amber glow is visible at a glance.
2. Pan/zoom on a mid-range device: pulse should not hitch the map. Toggle performance mode to confirm the glow stays but stops animating.
3. Let `ends_at` elapse (or use a fixture that ends in a few seconds): glow, saturation boost, badge, and chip disappear without a refresh. A `resolved` poll result also clears immediately.
