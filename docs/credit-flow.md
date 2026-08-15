# Credit-flow animation on support

Tactile polish on a successful city support: a small burst of coin sprites flies from the CreditHeader balance toward the supported city on the map. Purely visual. The existing optimistic wallet decrement and city-bar patch are unchanged.

The support sheet is always open during a spend. Coins arc over that modal (`z-index: 55` vs sheet `35`) toward the city’s map point. Sheet coverage is the normal case, not a skip.

## Why this shape

- `submitSupportOptimistic` already applies `applyOptimisticDelta` immediately and reconciles after POST. The animation must not `await` or sit on that path.
- A CSS transform burst (six SVG discs, ~550ms) is cheaper than a particle engine or a `requestAnimationFrame` loop.
- `map.project` is canvas-relative. Capture celebration currently uses those numbers as `position: fixed` left/top; credit-flow converts them by adding `[data-testid="turkiye-map"]`'s viewport rect so the origin (header) and destination share one coordinate space.
- The overlay mounts in the app shell, not inside the support sheet, so closing the sheet cannot kill an in-flight burst.

## Data flow

1. `CitySupportSheet` confirms a spend. Optimistic update + POST run as before.
2. On `outcome.ok` it calls `playCreditFlow({ ilCode, projectCity })` with no `await`.
3. `playCreditFlow` reads the balance node and map canvas, then `decideCreditFlow` in [`frontend/lib/creditFlow.ts`](../frontend/lib/creditFlow.ts).
4. Flight: `CreditFlowAnimation` (shell, `z-index: 55`, `pointer-events: none`) renders the coins over the open sheet. Reduce motion: WAAPI color tick on `[data-testid="credit-balance"]`. Off-canvas / missing target: no visual.

```
confirm → optimistic delta + POST
                └─ ok → playCreditFlow (fire-and-forget)
                          ├─ reduce motion → balance tick
                          ├─ city off canvas → skip
                          └─ else → 6 CSS-arc coins (sheet may cover the city)
```

## Gating

Play the flight when all of:

- `shouldReduceMotion()` is false (OS `prefers-reduced-motion` **or** Settings `cc_reduce_motion` — same helper as the ambient layer)
- Origin exists (`[data-testid="credit-balance"]`)
- `projectCity(ilCode)` returns a point and the map canvas is mounted
- That point, converted to viewport space, sits inside the map canvas (8px inset)

The open support sheet does **not** skip the flight. First support from the city-picker can still skip if it happens during the 900ms `flyTo` and the centroid still projects off-canvas. Balance still updates.

## How to test

Automated:

```bash
cd frontend && npm test -- lib/creditFlow lib/reduceMotion
```

Manual QA:

1. Support a held city on desktop after the camera has settled (centered modal covering the city): coins arc from the header over the open sheet toward the city. The number has already decremented. Taps still reach the sheet.
2. Support an off-screen city, or first support from the city-picker before `flyTo` finishes: no flight; balance still updates.
3. Enable Profile → Settings “Reduce motion” (or OS reduced-motion): no flight; short gold tick on the balance; spend/reconcile unchanged.
