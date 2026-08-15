# Tribe kit stripes on held provinces

Held cities on the Türkiye map fill with **vertical kit stripes** in the controlling tribe’s two colors (black/white for Siyah Gelgit), not a solid primary wash.

## Why this shape

- MapLibre `fill-color` is one color. `fill-pattern` cannot take the image name from feature-state in MapLibre 4, so each tribe gets its **own fill layer** with a constant pattern (`cities-stripes-{tribeId}`). Opacity is `1` when `controlling_tribe_id` matches, else `0`.
- Stripe bitmaps come from the tribe roster `primary_color` + `secondary_color` (the parody kit pair). Ownership still updates via **feature-state** — no GeoJSON refetch.
- The solid `cities-fill` underlay opacity drops to **0** on owned cities so the stripes *are* the fill. Unowned cities stay neutral gray.
- Ambient day/night tint is unchanged (HTML overlay, not fill paint).

## Stripe geometry

| Constant | Value |
| --- | --- |
| Band width | 14 CSS px |
| Period | 28 CSS px (primary then secondary) |
| Raster | 2× (`pixelRatio: 2`) |
| Orientation | Vertical (kit-style) |

Source: [`frontend/lib/map/stripePatterns.ts`](../frontend/lib/map/stripePatterns.ts).

## Data flow

1. `syncOwnershipOverlay` calls `ensureTribeStripeLayer` for every roster tribe (image + layer before `cities-outline`), then `applyAllCityFillStates(map, cities, tribesById)`.
2. Feature-state per city: `primary_color`, `stripe_pattern`, `striped`, `controlling_tribe_id`. `derbi_active` / `contest_tension` still merge.
3. A flip writes the new `controlling_tribe_id`; the matching stripe layer becomes opaque.

## Layers (bottom → top)

`cities-fill` → **`cities-stripes-{tribeId}`** (one per tribe) → `cities-outline` → contest-tension ring → derby glow → selected → ticker highlight → labels → crests → HTML overlays

Clicks query the fill layer and every `cities-stripes-*` layer so a striped city stays tappable.

## How to test

Automated:

```bash
cd frontend && npm test -- lib/map/stripePatterns lib/map/ownership lib/map/derbiUrgency
```

Manual QA:

1. A city held by Siyah Gelgit reads **black \| white \| black \| white** at country zoom (bands wide, not a hatch). Other tribes use their own primary/secondary pair (e.g. red/yellow, yellow/navy).
2. Flip to another tribe: stripes switch to that pair without a polygon reload.
3. Unowned cities stay solid gray.
4. Derby glow still sits above the stripes.
