# Tribe kit stripes on held provinces

Held cities on the Türkiye map fill with **vertical kit stripes** in the controlling tribe’s primary and secondary colors (black/white for Siyah Gelgit), not a solid primary wash.

## Why this shape

- MapLibre `fill-color` cannot paint two colors. A `fill-pattern` overlay (`cities-stripes`) sits on the existing solid `cities-fill` underlay.
- Patterns are tiny repeating canvases registered like crest icons (`ensureTribeStripeImage`), one image per tribe id. Ownership still updates via **feature-state** — no GeoJSON refetch.
- Unowned cities keep neutral gray. The overlay uses a fully transparent `tribe-stripes-none` tile and `striped: false` so opacity is 0.
- Stripe opacity reuses derby muting (0.78 vs 0.94) so urgent derby cities stay louder without a second grayed bitmap.
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

1. `syncOwnershipOverlay` registers stripe images for every roster tribe, then `applyAllCityFillStates(map, cities, tribesById)`.
2. Feature-state per city: `primary_color` (underlay), `stripe_pattern` (image id), `striped` (boolean). `derbi_active` / `contest_tension` still merge.
3. A flip looks up the new tribe in `tribesById` and swaps `stripe_pattern` — same path as crest updates.

## Layers (bottom → top)

`cities-fill` → **`cities-stripes`** → `cities-outline` → contest-tension ring → derby glow → selected → ticker highlight → labels → crests → HTML overlays

Click/hover bind to both fill layers so a striped city remains tappable.

## How to test

Automated:

```bash
cd frontend && npm test -- lib/map/stripePatterns lib/map/ownership lib/map/derbiUrgency
```

Manual QA:

1. A city held by Siyah Gelgit reads **black \| white \| black \| white** at country zoom (bands wide, not a hatch).
2. Flip to another tribe: stripes switch to that pair without a polygon reload.
3. Unowned cities stay solid gray.
4. An urgent derby city’s glow still sits above the stripes; non-derby held cities are slightly more transparent.
