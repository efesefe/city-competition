# Map city select — border highlight, no bbox (CC-95)

**Date:** 2026-11-21  
**Area:** Expo client Türkiye map selection chrome  
**Files:** `apps/client/components/TurkiyeMap.tsx`, `apps/client/lib/mapAtlas.ts`

## Docs read

- `docs/turkiye-map-web-svg.md`, `docs/guest-map-floodlight-night.md`, `docs/turkiye-map-harden.md`
- Store visual direction: Floodlight Night accent `#FF2D55` for selection rim

## Root cause

On Expo **web**, province hit targets are DOM `<path role="button" tabIndex={0}>`. Click/focus showed the **browser focus outline**, which for SVG paths is a **rectangle around the path bounding box** — not the province geometry. Selection already painted an accent stroke via `provinceStyle`, but the focus rect dominated and looked like a select bbox.

## Fix

1. Suppress focus/tap chrome on web paths: `outline: none`, `WebkitTapHighlightColor: transparent`, `blur()` after pointer/click select.
2. Keep Floodlight vermillion **path stroke** for the selected plate in `provinceStyle` (slightly thicker).
3. Draw a top-layer `SelectionBorder` overlay (`fill="none"`, accent stroke, `pointerEvents="none"`) so the rim stays visible above neighboring provinces.
4. Closing the city sheet still clears `selected` → border overlay unmounts. Switching cities updates `selectedPlate` → rim moves.

Hit-testing and city-sheet open are unchanged (same `onSelect` / `openCity` path).

## How to test

```bash
cd apps/client && npm run typecheck
# API + Expo web as usual; open guest map, tap İstanbul
# Expect: vermillion province outline only — no rectangle bbox
```
