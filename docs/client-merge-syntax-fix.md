# Client merge-syntax fix (Expo web bundling)

**Date:** 2026-11-16  
**Branch:** `cursor/fix-api-double-comma-98c9`  
**Why:** Season 0 stack merges left syntax/type merge artifacts in `apps/client` that broke Expo web bundling (`SyntaxError` on a double comma) and `tsc --noEmit`.

## Docs inspected

- Repo: `docs/expo-fastify-slice.md`, `docs/admin-ops-mvp.md`, `docs/index.md`
- Store: `docs/season-0-tracker.md`

## What changed

| File | Fix |
|------|-----|
| `apps/client/lib/api.ts` | `adminMetrics`: `{ token }),,` → `{ token }),` |
| `apps/client/lib/api.ts` | Remove duplicate `subActive?: boolean` on `PublicUser` |
| `apps/client/lib/api.ts` | Restore missing `createdAt` on `TeamAddTicket` (matches API `mapTicket`) |
| `apps/client/components/CitySheet.tsx` | Restore share props + `shareBtn`/`shareText` styles dropped in merge; widen `onSpend` return for flip share |
| `apps/client/app/pick-tribe.tsx` | Move `submitTicket` out of `useEffect` (merge nested it inside); restore ticket form styles |

## Scan

Scanned `apps/client` for:

- Double commas (`,,` / `,\s*,`)
- Git conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`)
- Duplicate identifiers (`tsc` `TS2300`)

Only one double comma; no conflict markers. Typecheck surfaced the remaining incomplete-merge pieces above.

## How to verify

```bash
cd apps/client && npx tsc --noEmit
# optional: npx expo start --web  (bundle should parse api.ts)
```
