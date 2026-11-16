# Türkiye map web SVG (Expo client)

**Date:** 2026-11-15  
**Component:** `apps/client/components/TurkiyeMap.tsx`  
**Asset:** `apps/client/assets/turkiye-provinces.json` (precomputed SVG `path` `d` strings + `viewBox`, 81 plates)

## Root cause

On Expo web, `react-native-svg` `Path` with `onPress` runs `SvgTouchableMixin` / `prepare()`, which forwards React Native responder props (`onStartShouldSetResponder`, `onResponderGrant`, …) into `unstable_createElement`. React DOM rejects those as **Unknown event handler property**, WebShape throws while mapping provinces, and the map stays blank.

Invalid GeoJSON→`d` conversion was not the failure mode — the atlas already ships string `path` values per plate.

## Fix

- **Web:** render a real DOM `<svg>` / `<path>` (bypass `react-native-svg` WebShape); clicks use `onClick` + `role` / `aria-label`.
- **Native:** keep `react-native-svg` `Path` with `onPress` + `accessibilityLabel`.
- Skip features with empty `path`.
- Shared fill/stroke via `provinceStyle`.

## Verify

```bash
cd apps/api && npm run dev
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
```

Open `http://localhost:8081`: 81 province fills, no WebShape / unknown-handler toast; click a province → city sheet. Hard-reload after Metro cache clears if the pane still looks blank.

## Follow-up

Season 0 Wave 1 harden (taps, memoized paints, loading/error/empty): [turkiye-map-harden.md](turkiye-map-harden.md).
