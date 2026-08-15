# Ambient sea creatures and day/night tint

Purely decorative overlay on the Türkiye map: rare sea-creature drifts over water, plus a static wash driven by Europe/Istanbul local time. Zero gameplay weight. Never a MapLibre layer.

## Why this shape

- City fills, labels, and derby/momentum overlays already live in MapLibre / HTML markers. Putting dolphins on a GL layer would compete with pan/zoom and city hit-testing.
- `AmbientLayer` is an HTML/SVG sibling of the map canvas (`pointer-events: none`, `aria-hidden`, `z-index: 1`). Taps fall through to polygons, markers, and chrome (`z-index: 3`) / the support sheet (`z-index: 35`).
- One sprite at a time. `requestAnimationFrame` runs only during a ~14–20s flight; the rest of the 3–8 minute gap is a single `setTimeout`. Paths are geographic cubics, reprojected with `map.project` so a pan mid-flight stays over water.

## Data flow

1. `map/page.tsx` passes `sheetOpen={!scoreboardOpen && Boolean(selectedIl)}` and the existing `perfModeEnabled` into `TurkiyeMap`.
2. `TurkiyeMap` mounts `AmbientLayer` once the map is ready, with the selected city’s centroid from `CityDataContext`.
3. Scheduling, sea paths, SVG silhouettes, and tint math live in [`frontend/lib/map/ambientAssets.ts`](../frontend/lib/map/ambientAssets.ts) so they can be unit-tested without MapLibre.

## Day/night tint

`istanbulHour` uses `Intl` `timeZone: "Europe/Istanbul"`. Plain rgba/CSS gradient overlay — **no `mix-blend-mode`**, and tribe fill paint in `ownership.ts` / `style.ts` is untouched.

| Istanbul hour | Kind | Max opacity |
| --- | --- | --- |
| 06–16 | day | 0 |
| 17–20 | evening (warm) | 0.10 |
| 21–05 | night (cool) | 0.12 |

Refresh about once a minute. Stays on under reduce-motion (it is static per render, not motion).

## Reduce motion

`shouldReduceMotion()` in [`frontend/lib/reduceMotion.ts`](../frontend/lib/reduceMotion.ts) is true when the OS `prefers-reduced-motion: reduce` media query matches **or** the user enables the Profile → Settings toggle (`localStorage cc_reduce_motion`).

Sprites are also skipped when performance mode is on (same policy as derby glow). Tint still renders.

`derbiUrgency.prefersReducedMotion` now delegates to `shouldReduceMotion`, so derby pulse and ticker autoscroll honor the same setting.

## QA hook

`localStorage cc_ambient_debug=1` shortens the spawn delay to 2–5 seconds so manual QA does not wait minutes. Not a user-facing setting.

## How to test

Automated:

```bash
cd frontend && npm test -- lib/reduceMotion lib/map/ambientAssets
```

Manual QA:

1. Ambient sprites never intercept a tap meant for a city polygon or a UI control (`pointer-events: none` on the overlay).
2. Midday (no wash) and midnight (cool 12% wash) both leave tribe fill colors and labels readable.
3. Enable “Reduce motion” in Settings (or OS reduced-motion): sprites stop; the map, sheet, and chrome stay fully usable; the day/night tint remains.
