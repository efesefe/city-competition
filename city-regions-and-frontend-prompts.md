CITY-LEVEL REGIONS & FRONTEND IMPLEMENTATION SET

This assumes every backend prompt through Sprint 18 (credit wallet, tribes, province support, real-time layer, derbi events, social, leaderboards, moderation, localization, monetization, analytics, observability) is already implemented. Two things happen in this update: a backend patch that aligns the support unit with the frontend city contract (81 il provinces), and the full frontend build that was deferred while the backend was being built out.

WHY A BACKEND CORRECTION IS NEEDED FIRST

This codebase never landed a hex-grid `regions` / tile stack. Support already keys on `il_code` (`"01"`…`"81"`) via `admin_boundaries`, `supports`, and `tribe_province_scores` in `backend/internal/support/`. What the frontend still needs before Tracks A–C is the explicit city listing API, a path-based support endpoint that rejects unknown codes with `404 unknown_region`, and a static il–il adjacency graph (adjacency only — GPS supply-line gameplay remains superseded). Do this backend patch before starting the frontend work below, since the frontend's city-tap and city-list interactions both assume the region id is an il code.

--------------------------------------------------------------------
BACKEND PATCH — CITIES AS THE SUPPORT UNIT (AS BUILT)
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Migrate Region Granularity to City (Il) Level

Context: Align the already il-keyed support stack with the frontend city contract. No hex-grid remapping — adapt in place on backend/internal/support rather than inventing backend/internal/region. Call out every file touched.

Target files: patch /backend/internal/support/handlers.go, patch /backend/internal/support/spend.go, patch /backend/internal/support/control.go, patch /backend/internal/support/cache.go, /backend/internal/support/cities.go, /backend/internal/support/adjacency.go, patch /backend/cmd/api/main.go, /backend/cmd/import-adjacency/main.go, /data/turkiye-il-adjacency.json, /migrations/0027_regions_are_cities.sql

Tech stack alignment: Go, PostGIS, reuses the admin_boundaries table already populated for province polygons.

Requirements:
1. Add a regions VIEW keyed directly on the il code from admin_boundaries (id = il_code, name, geom, centroid), backed by the existing province polygons — don't regenerate geometry, reference it. No hex-grid regions/tiles table exists here to deprecate; document that in the migration. Don't drop anything destructively.
2. Existing support tables already store il_code (supports ≈ support_transactions, tribe_province_scores ≈ region_support). Migration is additive only (view + region_adjacency); no UUID backfill/reset — document that approach and why.
3. region_adjacency for the city-level graph is precomputed once from real neighboring-province relationships (Turkey's actual il adjacency). Import from data/turkiye-il-adjacency.json via backend/cmd/import-adjacency; do not inline all edges in Go source. AdjacencyStore (AreNeighbors / Neighbors) is adjacency-only — not full supply-line gameplay.
4. GET /v1/cities returns all 81 cities with id, name, centroid, current controlling tribe (nullable), and each competing tribe's committed_credits, this is the primary listing endpoint the frontend map and city-picker will both call.
5. POST /v1/region/{il_code}/support rejects with 404 unknown_region for anything not in the fixed 81-city set. Keep existing POST /v1/support (body il_code) for regression; path handler maps missing il → unknown_region, body handler keeps 400 invalid_il_code.

Testing checklist:
- Integration test: POST /v1/region/{il_code}/support rejects any il_code not among the 81 valid codes with 404 unknown_region
- Integration test: GET /v1/cities returns exactly 81 rows with correct controlling-tribe / competing committed_credits reflecting tribe_province_scores and province_control_summary
- Integration test: region_adjacency spot-checks at least three known real il-to-il borders (e.g. Ankara 06 borders Konya 42)
- Regression test: existing support package integration tests still pass with il_code (POST /v1/support unchanged)
```

--------------------------------------------------------------------
FRONTEND ARCHITECTURE NOTES (read before the prompts below)
--------------------------------------------------------------------

UI structure: three-tab bottom navigation (mobile-first, since the primary audience is on-the-go phone users) — Harita (Map), Lider Tablosu (Leaderboard), Profil (Profile). A persistent top bar sits above all three tabs showing the user's tribe crest, current credit balance, and a notification bell. This top bar is the one piece of chrome that's always visible, since "how many credits do I have" is the single most important piece of state in this app and should never require navigation to check.

State management: a single WalletContext (React context + reducer, not Redux, this app's shared state surface is small enough) holds credit balance and is updated both optimistically on support/purchase actions and authoritatively via the WebSocket wallet-balance-changed event and REST refetch on tab focus. A separate CityDataContext holds the current per-city ownership/committed-credit snapshot, updated via the same WebSocket connection built in the backend real-time sprint.

Design language: use each tribe's own primary/secondary color (from the tribes table) as the fill/accent color wherever that tribe is referenced, this is how the app visually communicates "who controls what" at a glance without reading text. Neutral (unclaimed) cities use a fixed neutral gray, never a tribe color.

--------------------------------------------------------------------
FRONTEND TRACK A — APP SHELL, TAB NAVIGATION & CREDIT HEADER
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: App Shell, Bottom Tab Navigation & Persistent Credit Header

Context: The structural frame every other screen mounts inside. Build this first, everything else in this update assumes it exists.

Target files: /frontend/app/(main)/layout.tsx, /frontend/components/shell/TabBar.tsx, /frontend/components/shell/CreditHeader.tsx, /frontend/context/WalletContext.tsx, /frontend/context/CityDataContext.tsx

Tech stack alignment: Next.js 14 App Router, React context, Tailwind, reuses the WebSocket client from the backend real-time sprint (mapSocket.ts, generalize its name/location if it was GPS-specific, since it now carries city ownership and wallet events too, not map viewport events).

Requirements:
1. (main) route group layout renders CreditHeader fixed at the top, the routed page content in the middle, and TabBar fixed at the bottom, three routes: /map, /leaderboard, /profile, with /map as the default redirect from /.
2. CreditHeader shows: user's tribe crest (small, tappable, navigates to /profile), formatted credit balance (Turkish thousands separator, e.g. "1.250 kredi"), and a notification bell with an unread-count badge. Balance updates live from WalletContext, never a stale value fetched once on mount and forgotten.
3. WalletContext fetches GET /v1/me/wallet on mount, exposes {balance, refetch, applyOptimisticDelta(amount)}, and subscribes to a wallet-balance-changed WebSocket event to reconcile the authoritative balance whenever the backend confirms a debit or credit, correcting any optimistic-update drift.
4. TabBar highlights the active tab with the user's own tribe color as the active-state accent (not a generic app-wide brand color), reinforcing tribe identity throughout the whole app, not just on the map.
5. If WalletContext detects the user has no tribe_id (shouldn't happen post-onboarding, but defend against it) or no valid session, redirect to the onboarding flow rather than rendering a broken shell.

Testing checklist:
- Manual QA: credit balance updates in the header immediately after a support action elsewhere in the app, without a manual refresh
- Unit test: applyOptimisticDelta and the subsequent WebSocket reconciliation never leave the displayed balance permanently wrong if the two arrive out of order
- Integration test: navigating to any (main) route without a valid session redirects to onboarding
- Manual QA: active tab accent color matches the signed-in user's tribe color
```

--------------------------------------------------------------------
FRONTEND TRACK B — TURKIYE-ONLY MAP, CITY LABELS, TRIBE COLOR & CREST
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Turkiye-Bounded Map with City-Only Labels and Tribe-Colored Fills (covers requirements 2 and 3)

Context: The core screen of the app. Must be visually minimal, Turkiye's outline and its 81 cities are the entire visual vocabulary, no road network, no POI icons, no unrelated map furniture.

Target files: /frontend/app/(main)/map/page.tsx, /frontend/components/map/TurkiyeMap.tsx, /frontend/lib/map/style.ts, /frontend/lib/map/turkiyeBounds.ts

Tech stack alignment: Maplibre GL JS, a custom minimal style (not a general-purpose hosted style with roads/POIs left on), GeoJSON source fed from GET /v1/cities (Sprint patch above), live updates via the WebSocket connection from Track A.

Requirements:
1. turkiyeBounds.ts defines Turkiye's bounding box as a maxBounds constraint on the Maplibre instance (roughly 25.5,35.8 to 45.0,42.2, adjust to the precise figure your team wants, document the source), and the initial camera fitBounds to this box on load. minZoom/maxZoom configured so the user cannot zoom out past seeing the whole country or zoom in so far the app becomes pointless (there's nothing to see at street level in a city-granularity game), a max zoom around city-label-readable level is enough.
2. style.ts is a self-authored minimal style, not a stock style with layers hidden via runtime setLayoutProperty calls, only include: a base fill/land layer, the 81 city polygons (source: the admin_boundaries geometry, served by a lightweight GeoJSON endpoint, don't ship the full precision boundary dataset to the client if it's large, simplify server-side or use vector tiles if precision demands it), and a symbol layer showing only the city name. No road, rail, POI, building, or place-of-interest layers exist in this style at all, this is a design constraint, not a toggle to leave for later.
3. City fill color is data-driven from each city's controlling tribe: use Maplibre's feature-state or a data-join expression keyed on tribe primary_color, neutral cities render a fixed neutral gray. This must update live, not only on page load, when a WebSocket region-ownership event arrives for a city, update that one feature's paint state directly (setFeatureState), don't reload the whole GeoJSON source on every event.
4. For any city with a controlling tribe, render that tribe's crest as a small icon anchored at the city's centroid (a symbol layer using the tribe's crest_asset_url as an icon image, loaded once per tribe and cached, not refetched per city). Icon size should scale sensibly with zoom so it doesn't dominate the map at country-wide zoom or disappear at city-level zoom.
5. Tapping/clicking a city polygon selects it and opens the support panel (Track C), implemented as a Maplibre click handler querying rendered features at the click point, filtered to the city-fill layer, resolving to that feature's il_code. Also expose a lightweight visual affordance (a subtle highlight ring) on the currently-selected city so the user has clear feedback about what they're about to support.

Testing checklist:
- Manual QA: panning and zooming cannot move the visible area outside Turkiye's bounding box
- Manual QA: no road, POI, or building layer is visible at any zoom level, only country base, city fills, and city name labels
- Manual QA: all 10 tribe crests render legibly at a mid-range zoom level on their respective controlled cities
- Integration test: a WebSocket ownership-change event for one city updates only that city's fill color and crest, without a network refetch of the full city dataset
- Manual QA: tapping a city on both a small phone screen and a tablet-sized screen reliably selects the intended city, not a neighboring one
```

--------------------------------------------------------------------
FRONTEND TRACK C — CITY SUPPORT PANEL (requirement 1)
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: City Selection & Support Bottom Sheet (covers requirement 1)

Context: The primary conversion action in the whole app, spending credits to support a city. Also doubles as the answer to requirement 1: users can select a city either by tapping it on the map (Track B) or by searching/browsing a city list, both paths land here.

Target files: /frontend/components/map/CitySupportSheet.tsx, /frontend/components/map/CityPicker.tsx, /frontend/lib/api/support.ts

Tech stack alignment: Next.js client components, a bottom-sheet pattern (slide up from the bottom on mobile, a centered modal on wider viewports), reuses WalletContext and CityDataContext from Track A.

Requirements:
1. CityPicker is a searchable, alphabetically-sorted list of all 81 cities (Turkish-aware sort and search, reuse the Turkish case-folding utility from the backend username work if a client-side equivalent is needed, or keep search matching simple and diacritic-tolerant so "istanbul" without dotting still matches "İstanbul"), accessible from a search icon on the map screen, for users who find tapping small city shapes on a phone screen imprecise. Selecting a city from this list opens the same CitySupportSheet as a map tap does, there is exactly one support flow, reached two ways.
2. CitySupportSheet displays: the city name, the currently controlling tribe (crest, name, color) or "Henüz kimsenin değil" (not yet anyone's) if neutral, and a horizontal multi-segment bar showing each competing tribe's share of that city's total committed_credits, this is the at-a-glance "how close is this contest" visualization and should use each tribe's actual color per segment.
3. A credit-amount input with quick-select chips (e.g. 10, 50, 100, 250) plus a manual numeric entry, defaulting to the smallest chip. The input is clamped client-side to the user's current wallet balance (from WalletContext) and to the backend's daily per-city cap if that value is exposed by an endpoint, showing an inline warning rather than letting the user attempt a doomed request.
4. A confirm button showing the exact resulting wallet balance after this spend ("450 kredi kalacak"), submitting POST /v1/region/{il_code}/support. On submit: apply an optimistic WalletContext balance decrease and an optimistic bump to that city's committed_credits bar immediately, then reconcile against the real API response and subsequent WebSocket event, rolling back the optimistic UI cleanly if the request fails (insufficient credits race, daily cap hit, region excluded, etc.), with a clear Turkish error message per failure reason rather than a generic error.
5. If an active Derbi event applies to this city (the city matches an active event's city_code and the user's tribe is participating), show a visible "2x Derbi bonusu aktif" badge in the sheet before the user confirms, so the bonus is a visible incentive, not a surprise discovered only in support history later.

Testing checklist:
- Manual QA: quick-select chips and manual entry both correctly clamp to the user's real-time wallet balance
- Integration test: a support submission that the backend rejects (insufficient credits, cap reached, excluded region) rolls back both the optimistic wallet and city-bar UI state correctly
- Manual QA: the multi-segment ownership bar accurately reflects each tribe's actual committed-credit share, verified against the raw GET /v1/cities response for that city
- Manual QA: the Derbi bonus badge appears only when the selected city and the user's tribe genuinely match an active event, not for every city during any active Derbi
```

--------------------------------------------------------------------
FRONTEND TRACK D — PROFILE SCREEN (requirement 4)
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Profile Screen — Tribe, Wallet, Support History, Settings (covers requirement 4)

Context: One of the three primary tabs. Consolidates identity, currency, and personal history in one place.

Target files: /frontend/app/(main)/profile/page.tsx, /frontend/components/profile/TribeBadge.tsx, /frontend/components/profile/WalletSummary.tsx, /frontend/components/profile/SupportHistoryList.tsx, /frontend/components/profile/SettingsSection.tsx

Requirements:
1. Top of screen: large TribeBadge (crest, tribe name, tribe color as background accent), tappable to open tribe details (member count, current territory summary from the tribe-territory endpoint), and a clearly-separated "Takımı değiştir" (switch tribe) action that surfaces the cooldown state from the backend (either allows switching or shows the next-eligible date if still in cooldown), so the constraint isn't discovered only after a failed attempt.
2. WalletSummary shows current balance prominently plus a "Kredi yükle" (top up) button that opens the credit-purchase flow (Track I).
3. SupportHistoryList is a paginated, reverse-chronological list of the user's own support_transactions (from the backend's support-history endpoint), each row showing city name, tribe supported, credits spent, timestamp, and a Derbi-bonus indicator when multiplier_applied is greater than 1, matching the same visual language as the activity feed elsewhere in the app.
4. SettingsSection includes: locale toggle (tr/en), notification preferences, KVKK consent status/withdrawal entry point (reusing the already-implemented consent withdrawal endpoint), and a link to submit a data-erasure request (reusing the already-implemented erasure endpoint), both presented as real, working actions here, not placeholder links, since these are legal obligations, not optional polish.
5. Restricted-mode (under-18) users see a visibly different, simplified profile: tribe badge and wallet are shown, but any element that would link to chat/DM is omitted entirely rather than shown-then-blocked, consistent with the backend's restricted-mode contract.

Testing checklist:
- Manual QA: tribe-switch button correctly shows either an active switch action or an accurate cooldown countdown, matching the backend's actual cooldown state
- Integration test: support history pagination fetches correctly and never duplicates rows across pages
- Manual QA: consent withdrawal and erasure-request actions in settings actually call the corresponding backend endpoints and reflect success/failure to the user, not just navigate to a static page
- Manual QA: a restricted-mode test account never sees a chat/DM entry point anywhere in the profile screen
```

--------------------------------------------------------------------
FRONTEND TRACK E — LEADERBOARD SCREEN
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Leaderboard Screen — Global, Tribe, and Derbi Tabs

Context: One of the three primary tabs. Surfaces the leaderboard scopes the backend already computes.

Target files: /frontend/app/(main)/leaderboard/page.tsx, /frontend/components/leaderboard/LeaderboardTabs.tsx, /frontend/components/leaderboard/LeaderboardList.tsx, /frontend/components/leaderboard/DerbiScoreboard.tsx

Requirements:
1. Sub-tabs within the leaderboard screen: Genel (global), Takımlar (tribes), and, only when at least one Derbi event is active or recently resolved, a Derbi sub-tab, otherwise that sub-tab is hidden entirely rather than shown empty.
2. LeaderboardList renders rank, user or tribe name (with tribe crest/color where applicable), and score, with the signed-in user's own row visually pinned or highlighted if they're within a reasonable range of the visible list, and a small "senin sıran" (your rank) indicator fetched separately if they're far outside the visible top results, so a low-ranked user isn't left wondering where they stand.
3. DerbiScoreboard, when shown, displays host vs guest tribe crests and colors with a live bonus-weighted score comparison (bar or head-to-head number pair), updating via the same WebSocket connection used elsewhere, plus the event's city and remaining time if still active, or the final result and a "Sona erdi" (ended) state if resolved.
4. All three lists support pull-to-refresh (mobile) in addition to their live WebSocket updates, since a user landing directly on this tab should never see a stale first paint waiting on a socket event that may not fire immediately.

Testing checklist:
- Manual QA: Derbi sub-tab is absent when no event is active or recently resolved, and appears correctly when one exists
- Manual QA: a test account ranked far outside the visible top list still sees an accurate "your rank" indicator
- Integration test: leaderboard lists reflect a score change (from a test support action) within the same latency budget as the map's live updates
```

--------------------------------------------------------------------
FRONTEND TRACK F — ONBOARDING: OTP, KVKK CONSENT, TRIBE SELECTION
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Onboarding Flow UI — Phone OTP, KVKK Consent, Tribe Selection

Context: Finalizes the frontend for backend flows built early (Sprint 1 OTP/consent, Sprint 4 tribe join) but likely only stubbed as bare forms at the time. This brings them to the same polish level as the rest of the app.

Target files: /frontend/app/(auth)/register/page.tsx, /frontend/app/(auth)/consent/page.tsx, /frontend/app/(onboarding)/choose-tribe/page.tsx, /frontend/components/onboarding/OtpInput.tsx

Requirements:
1. Phone entry step defaults the country code to +90 and formats the input as the user types, following Turkish phone number grouping, calling the existing OTP request/verify endpoints, with clear resend-cooldown UI (a visibly ticking countdown, not just a disabled button with no explanation).
2. Consent screen renders the two independently-checked disclosure/consent checkboxes exactly as the backend expects (two distinct consent_type grants, not a single combined checkbox), pulling the actual current consent_version text from the backend rather than hardcoding legal copy into the frontend, since that text can change without a frontend redeploy on the backend side.
3. Tribe-selection screen presents all 10 tribes as a visually rich grid (crest, name, colors) the user can browse and preview before confirming, since this choice carries real weight (Derbi bonuses, chat community, visual identity throughout the app) and shouldn't feel like a throwaway settings toggle. Confirm action calls the tribe-join endpoint and only then routes into the main app shell (Track A).
4. Onboarding order is strictly: phone/OTP, then KVKK consent, then tribe selection, then main app, matching the backend's actual gating (the consent gate blocks reaching the map, per the already-implemented backend contract), don't let the frontend allow skipping ahead.

Testing checklist:
- Manual QA: resend cooldown countdown accurately reflects the backend's actual cooldown window
- Integration test: attempting to navigate directly to /map before completing consent redirects back into the onboarding flow
- Manual QA: tribe grid displays all 10 seeded tribes correctly with accurate crest images and colors
```

--------------------------------------------------------------------
FRONTEND TRACK G — TRIBE CHAT UI
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Tribe Chat Screen

Context: Frontend for the backend tribe-chat WebSocket channel. Accessible from the Profile tab's tribe badge, not a fourth bottom-tab, to keep the primary navigation to three items.

Target files: /frontend/app/(main)/profile/tribe/chat/page.tsx, /frontend/components/chat/ChatThread.tsx, /frontend/components/chat/MessageComposer.tsx

Requirements:
1. ChatThread subscribes to the tribe:{tribe_id} WebSocket channel (same Hub pattern used for map/wallet events), renders messages in ascending chronological order with sender name and timestamp, auto-scrolls to the latest message on new arrival unless the user has scrolled up to read history, in which case show a "yeni mesajlar" (new messages) pill instead of yanking their scroll position.
2. MessageComposer submits to the existing tribe-message endpoint, disables send while a message is in flight, and gracefully surfaces the backend's flagged-message behavior, if a message comes back flagged and withheld, show the user their own message locally with a "gözden geçiriliyor" (under review) indicator rather than pretending it sent normally to everyone.
3. Restricted-mode users never reach this screen, the entry point in the Profile tribe badge is omitted for them entirely, consistent with Track D.

Testing checklist:
- Manual QA: new incoming messages don't disrupt the user's reading position when they've scrolled up
- Manual QA: a flagged test message shows the sender their own local under-review state without appearing to other connected tribe members
```

--------------------------------------------------------------------
FRONTEND TRACK H — DERBI EVENT BANNER & NOTIFICATIONS
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Derbi Event Banner, In-App Notification Center & Push Permission Prompt

Context: Surfaces admin-created Derbi events and general notifications across the app, not just on the leaderboard's Derbi tab.

Target files: /frontend/components/derbi/DerbiBanner.tsx, /frontend/app/(main)/notifications/page.tsx, /frontend/components/notifications/PushPermissionPrompt.tsx

Requirements:
1. DerbiBanner renders at the top of the Map screen (below CreditHeader) whenever an event is scheduled soon or currently active and the signed-in user's tribe is participating, showing host vs guest crests, the city, and either a countdown to start or remaining time if active, tapping it deep-links the map to center on that city and opens the DerbiScoreboard. Users whose tribe isn't participating in the event don't see this banner, keep it relevant, not global noise.
2. Notifications screen (reached via the bell icon in CreditHeader) lists in-app notifications, Derbi announcements, "city under contest" alerts, moderation/appeal outcomes, in reverse-chronological order with read/unread state, and marks items read on view.
3. PushPermissionPrompt asks for push permission at a sensible moment, after onboarding completes and the user has seen the map at least once, not immediately on first launch before they understand what the app even is, and explains in one short sentence what notifications are for (Derbi alerts, contested cities) before the OS permission dialog appears, since a bare OS prompt with no context gets denied far more often.

Testing checklist:
- Manual QA: DerbiBanner appears only for users whose tribe is participating in a live/upcoming event, and disappears correctly once the event resolves
- Manual QA: notification bell badge count matches the actual unread count and clears appropriately on visiting the notifications screen
- Manual QA: push permission prompt appears at the intended point in the flow, not on cold app launch
```

--------------------------------------------------------------------
FRONTEND TRACK I — CREDIT PURCHASE / WALLET TOP-UP UI
--------------------------------------------------------------------

```
CURSOR IMPLEMENTATION PROMPT: Credit Purchase Flow UI

Context: Frontend for the backend's credit-package purchase and Turkish payment-provider integration.

Target files: /frontend/app/(main)/profile/topup/page.tsx, /frontend/components/topup/PackageGrid.tsx, /frontend/components/topup/CheckoutPanel.tsx

Requirements:
1. PackageGrid displays available credit packages (price, credit amount, any bonus framing like "yüzde 10 fazladan kredi") fetched from the backend, not hardcoded, so pricing/package changes don't require a frontend redeploy.
2. CheckoutPanel routes to the appropriate payment path: platform IAP (Apple/Google) on native builds, or the Papara/Iyzico/BKM Express hosted checkout on web, matching whichever the backend's payment service exposes, never collecting card details directly in this app's own form, always handing off to the provider's hosted flow per the backend's PCI-isolation design.
3. On purchase completion, WalletContext's balance is refreshed from the authoritative backend response (not just an optimistic bump), since real-money purchases warrant the extra round trip for certainty, and a clear success confirmation is shown before returning to the previous screen.
4. Invoice/receipt access: a link to view the KDV-itemized invoice for a completed purchase, reflecting the backend's invoicing endpoint.

Testing checklist:
- Manual QA: package list correctly reflects whatever the backend currently offers, verified by changing a package server-side and confirming the frontend picks it up without a redeploy
- Manual QA: completing a test purchase updates the credit balance shown in CreditHeader across the whole app, not just locally on the top-up screen
- Manual QA: invoice link displays the correct KDV breakdown matching the backend-generated invoice
```

--------------------------------------------------------------------
IMPLEMENTATION ORDER FOR THIS UPDATE
--------------------------------------------------------------------

1. Backend patch (city-level regions) first, everything else depends on region_id meaning il_code.
2. Track A (app shell) before any tab content, since B through I all mount inside it.
3. Track B and Track C together, the map and its support sheet are really one feature split into two files for manageability, implement and test them as a pair.
4. Track D and Track E can be built in either order, both only depend on Track A and already-existing backend endpoints.
5. Track F can happen any time after Track A exists, it doesn't block the others, but do it early if your onboarding is currently the bare placeholder from the original bootstrap sprint, since real users will hit it first.
6. Track G, H, and I are independent of each other and can be parallelized across a team, or done last as polish if you're building solo.
