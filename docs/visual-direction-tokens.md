# Floodlight Night theme tokens (W4 start)

**Why:** D2 locked a new Season 0 visual direction (not forest/pitch + gold). This PR adds the client token module so screens can migrate off scattered hexes without a full redesign.

**What changed:**
- Added `apps/client/lib/theme.ts` — `colors`, `fonts`, `type`, `space`, `radii`, `motion`.
- Wired `apps/client/app/_layout.tsx` stack chrome to `colors.bg` / `colors.ink` / `fonts.display` (drops Georgia + forest green header).

**Not in this PR:** expo-font loading for Unbounded/Figtree, guest-map full-bleed redesign (W5), secondary surface pass (W6), bulk hex replacement across sheets/shop.

**How to test:**
1. `cd apps/client && npx tsc --noEmit`
2. Open the app — root stack background/header should read night navy (`#070B12`), not forest green.
3. Confirm no screen layout/copy changes beyond shell tint.

**Follow-up:** load Unbounded + Figtree via `expo-font`, then replace component hex islands using `theme.colors` / `theme.type`.
