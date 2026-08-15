# Momentum badges and contest-tension ring

Always-on Türkiye map indicators for volatile cities, long holding streaks, and how close a city is to flipping. Both read from `GET /v1/cities` fields (`flips_today`, `current_streak_days`, `contest_tension`) added by the backend momentum store.

## Why this shape

- Badges are sparse HTML `Marker`s (`MomentumBadge`), same camera-tracking approach as derby lightning chips. Only cities above display thresholds render, so the map does not grow 81 extra markers.
- The contest ring is a **duplicate line layer** (`cities-tension-ring`) driven by feature-state `contest_tension`, not GeoJSON reloads. Support spends already patch `competing_tribes` in `CityDataContext`; `reconcileCityControl` now recomputes `contest_tension` (`second / first`) so the ring moves with each `support_applied` / optimistic spend.
- Derby urgency stays louder: the tension ring sits **under** `cities-derbi-glow`, is thinner and uncapped of pulse/blur, and multiplies opacity by `0.35` when `derbi_active` is set.

## Badge rules

Exported from `frontend/lib/map/momentumBadges.ts`:

| Signal | Threshold | Marker |
| --- | --- | --- |
| `flips_today` | `>= 2` | Double-arrow; tooltip `Bugün {count} kez el değiştirdi` |
| `current_streak_days` | `>= 5` | Flame + number; tooltip `{days} gündür elde` |

Volatility wins. A city never gets both markers. Backend streaks are 0 on a same-day flip, so the client exclusivity rule is mostly a guard against stale fields.

Offset is `[-16, -26]` (crest-adjacent), opposite the derby lightning at `[16, -26]`.

## Contest tension ring

`frontend/lib/map/contestTension.ts`:

- Display floor **0.3** — below that, opacity/width/color paint to nothing.
- Continuous interpolate 0.3 → 1.0: muted rust `#c45c3a` to saturated ember `#ff5a2a`, opacity ~0.16–0.38, width ~1.15–1.9.
- Live path: spend → `patchCitySupport` → `contest_tension` on the city → `syncOwnershipOverlay` → `applyContestTensionStates`.

## Layers (bottom → top)

`cities-fill` → **`cities-stripes`** → `cities-outline` → **`cities-tension-ring`** → `cities-derbi-glow` → `cities-selected` → `cities-ticker-highlight` → labels → crests → HTML overlays (derby + momentum)

## How to test

Automated:

```bash
cd frontend && npm test -- context/cityDataPatch lib/map/contestTension lib/map/momentumBadges lib/map/ownership
```

Manual QA:

1. A city with both high `flips_today` and `current_streak_days` shows only the double-arrow (never flame + arrow together).
2. Repeated support from a test account on a contested city brightens the rust ring without a page reload.
3. An urgent derby city with high tension still reads as the loudest thing on the map versus a non-derby city at the same tension (amber pulse + full fill + lightning chip vs a thin dimmed ring).
