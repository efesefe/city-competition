# Türkiye map client harden (81 provinces)

**Date:** 2026-11-16  
**Season 0 / Wave 1:** Harden map clients (parallel with Postgres migration — client-only)  
**Components:** `apps/client/components/TurkiyeMap.tsx`, `apps/client/app/index.tsx`, `apps/client/lib/mapAtlas.ts`  
**Asset:** `apps/client/assets/turkiye-provinces.json`

## Why

PR #32 stopped the Expo web WebShape crash. This pass hardens beyond the slice: stable taps, memoized 81-path paints, atlas validation, and loading / error / empty UI when digest or sheet data is missing.

## Changes

| Area | Behavior |
|------|----------|
| Atlas | `mapAtlas.ts` filters empty/duplicate plates; `atlasReady` gates render; empty UI if asset missing |
| Web | DOM `<svg>` / `<path>` only (no `react-native-svg` `onPress`); touch via `pointerup` + click de-dupe |
| Native | `Path` + `onPress` + `delayPressIn={0}`; memoized path rows |
| Perf | `memo` province paths with paint equality; color map only rebuilds when digest changes |
| Map screen | Digest loading overlay; non-blocking error banner + Yenile; empty ownership banner; select lock against double-tap |
| City sheet | `loadError` when `/v1/cities/:plate` fails |

## Verify

```bash
# Atlas integrity (expect 81 unique plates)
node -e "const a=require('./apps/client/assets/turkiye-provinces.json'); const f=a.features||[]; console.log(f.length, new Set(f.map(x=>x.plate)).size)"

cd apps/client && npx tsc --noEmit

cd apps/api && npm run dev
cd apps/client && EXPO_PUBLIC_API_URL=http://localhost:8787 npm run web
```

Open `http://localhost:8081`:

1. Loading overlay briefly, then 81 colored provinces (no WebShape / unknown-handler toast).
2. Tap a province → city sheet; rapid double-tap does not stack broken modals.
3. Stop the API → Yenile banner; map paths still tappable with default fills; restart API + Yenile restores colors.
4. Native: `npm run ios` / `android` — same taps via `Path` `onPress`.

## Related

- [turkiye-map-web-svg.md](turkiye-map-web-svg.md) — WebShape root cause / DOM svg split  
- [expo-fastify-slice.md](expo-fastify-slice.md) — vertical slice context  
- Store build order: Season 0 Wave 1 map harden
