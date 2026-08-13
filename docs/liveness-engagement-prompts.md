LIVENESS & ENGAGEMENT FEATURE SET — CURSOR PROMPTS

Assumes everything through the frontend track (app shell, Turkiye map, city support sheet, profile, leaderboard, onboarding, tribe chat, derbi banner, credit top-up) is already implemented. This update layers real-time social proof and ambient motion on top of that, it does not change the core support/wallet/tribe/derbi mechanics underneath.

Build order: backend prompts 1 through 3 first, they create the data every frontend prompt below consumes. Backend 4 and 5 (rival-threat alerts, presence) can follow in either order. Backend 6 (time-lapse snapshots) is lowest priority, do it last or skip for now. On the frontend side, do the capture toast/log pair first since it's the foundation the badge and ticker prompts build on, everything else is independently orderable.

====================================================================
BACKEND
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Persistent Conquest Log & App-Wide Capture Broadcast

Context: Right now a city flip only exists as a transient Redis Pub/Sub event for whoever happens to be connected at that instant. This makes it durable and queryable so a user who was offline for an hour still sees what happened, and gives every client an authoritative feed to reconcile against instead of relying purely on live socket delivery.

Target files: /backend/internal/conquest/log.go, /backend/internal/conquest/handlers.go, /migrations/0036_conquest_log.sql

Tech stack alignment: Go, Postgres for durable storage, Redis Pub/Sub for the live-broadcast leg, reuses the ownership-flip transaction from the region-support code.

Requirements:
1. conquest_log table: id, il_code, city_name, previous_tribe_id (nullable, null for a first-ever capture), new_tribe_id, winning_committed_credits, occurred_at, was_derbi_bonus (bool). Insert exactly one row inside the same Postgres transaction that flips region ownership, this is not a separate best-effort write, a flip that isn't logged is a data-integrity bug, not an acceptable edge case.
2. conquest_log_reads table: user_id, log_id, read_at, or simpler, a single last_read_conquest_log_id per user on the users/wallet-adjacent table, whichever is cheaper to maintain, used to compute unread counts for the notification bell without scanning the full log per request.
3. GET /v1/conquest-log returns paginated, reverse-chronological entries, this is the authoritative source the frontend's persistent log screen reads on load and on manual refresh.
4. GET /v1/conquest-log/unread-count returns the count of entries after the caller's last-read marker, cheap enough to poll or call on every app foreground.
5. The existing region_supported Redis Pub/Sub event, published at flip time, continues to fire for live delivery to connected clients, this prompt adds durability alongside it, it does not replace the live path.

Testing checklist:
- Integration test: every ownership flip in a test run produces exactly one conquest_log row, verified across concurrent flip attempts
- Integration test: unread-count correctly reflects entries created after a user's last-read marker and updates correctly after marking read
- Integration test: conquest log insert failure rolls back the entire ownership-flip transaction, a flip is never committed without its log entry
```

```
CURSOR IMPLEMENTATION PROMPT: Capture Attribution — Top-Supporter Ranking, Own-Capture Flag & Profile Pictures

Context: Turns a capture from an anonymous state change into a named, ranked, personal event. Depends on the conquest_log table from the previous prompt.

Target files: /backend/internal/conquest/attribution.go, /backend/internal/user/avatar.go, /migrations/0037_conquest_attribution.sql

Tech stack alignment: Go, Postgres, object storage for uploaded avatars (or a generated-avatar fallback service if uploads aren't supported yet).

Requirements:
1. Add a conquest_log_id column to support_transactions (nullable, set only on the specific transactions that contributed to a winning tribe's committed_credits total at the moment of that particular flip, not every transaction that tribe ever made on that city). Populate it inside the same flip transaction from the previous prompt, this requires identifying which contributions counted toward the winning margin, document the exact windowing rule you use (e.g. all of the winning tribe's contributions since their last time not controlling this city) directly in code comments since it's a specific product decision.
2. GET /v1/conquest-log/{log_id}/supporters returns the winning tribe's contributors for that specific capture, ranked descending by their summed credits_spent within the attributed window, including user_id, display_name, avatar_url, and their contribution amount, capped at a reasonable top-N (default 10) with a total-contributor-count alongside it for "and 40 more" framing.
3. Response includes an is_you boolean per entry (comparing against the requesting user's own ID) so the frontend can style the caller's own row distinctly without a second lookup, and a top-level caused_flip boolean on the conquest-log entry itself indicating whether the requesting user's single support action was the one that crossed the flip threshold, not just whether they contributed at all, this powers the personal celebration feature.
4. users table gets an avatar_url column. POST /v1/me/avatar accepts an image upload, validates size/type, stores it, and returns the URL, if upload infrastructure doesn't exist yet, fall back to a deterministic generated-avatar service (initials on a color derived from user_id) so every user has a displayable avatar_url even before uploading one, never leave this field null in the API response.

Testing checklist:
- Integration test: supporters endpoint correctly ranks contributors by their attributed-window contribution, not lifetime totals on that city
- Integration test: caused_flip is true only for the single support_transactions row whose commit pushed the tribe's total past the flip margin, false for every other contributing row
- Integration test: a user with no uploaded avatar still receives a valid, deterministic avatar_url from the fallback generator
```

```
CURSOR IMPLEMENTATION PROMPT: City Flip History, Momentum Streaks, Contest-Tension Flag & Nationwide Activity Feed

Context: Powers three related frontend features off one shared data model: momentum badges ("flipped 3 times today"), the always-visible contest-tension ring, and the activity ticker strip. All three read from the same underlying flip-frequency and margin data, build them together.

Target files: /backend/internal/conquest/momentum.go, /backend/internal/conquest/activity.go, /migrations/0038_flip_stats.sql

Tech stack alignment: Go, Postgres, Redis for the rolling-window counters that don't need full durability.

Requirements:
1. Derive today's-flip-count and current-holding-streak per city from the conquest_log table rather than maintaining a separate mutable counter that can drift, a scheduled Go job (or a cheap on-read aggregation with a short cache TTL) computes flips_today and current_streak_days per city, exposed on the existing GET /v1/cities response as additional fields, not a separate endpoint, since the map needs this alongside ownership data it already fetches.
2. Contest-tension: for every city currently controlled by a tribe, compute the second-place tribe's committed_credits as a percentage of the flip-margin threshold from the region-support logic, expose as a contest_tension float (0 to 1) on the same GET /v1/cities response, the frontend draws the ambient ring intensity directly from this number, don't pre-bucket it into a discrete enum server-side, let the frontend decide visual thresholds.
3. GET /v1/activity-feed returns a merged, reverse-chronological stream combining conquest_log entries, large single support_transactions above a configurable threshold (default a value TBD by product, e.g. top 5 percent of typical support size), and derbi-bonus-flagged support transactions, this is the ticker's data source, paginated with a since_id cursor so the frontend can poll or long-poll for new entries efficiently.
4. Also publish new activity-feed-eligible events to a Redis Pub/Sub channel (activity:feed) as they occur, so the frontend ticker can update live rather than only via polling, mirroring the pattern already used for region_supported.

Testing checklist:
- Integration test: flips_today resets correctly at day boundary (test with a controlled clock or injectable time source, not real wall-clock waiting)
- Integration test: contest_tension is near 1.0 immediately before a flip and resets toward 0 immediately after
- Integration test: activity-feed pagination via since_id returns no duplicates and no gaps across sequential polls
```

```
CURSOR IMPLEMENTATION PROMPT: Rival-Threat Threshold Alerts

Context: The proactive, targeted counterpart to the passive conquest log, notifies the tribe that's about to lose a city while there's still time to react, not just after the fact.

Target files: /backend/internal/conquest/threats.go

Tech stack alignment: Go, Redis (rate-limited per-city threat state to avoid spamming), reuses the push-notification queue from earlier sprints.

Requirements:
1. On every support action that changes a city's contest_tension (from the previous prompt) upward, check whether it just crossed a configurable threshold (default 70 percent and 90 percent, two distinct alert levels) toward flipping, if so, and no alert at that level has already been sent for this city within a cooldown window (default 10 minutes, tracked in Redis to prevent alert spam as tension hovers near the threshold), enqueue a targeted push notification to every member of the currently-controlling tribe only, not the whole app.
2. Notification payload includes the city name, current tension percentage, and a deep link that opens the app directly to that city's support sheet, the point of this alert is to make defending as frictionless as possible, one tap from notification to being able to act.
3. If the city actually flips, immediately clear any pending threat-alert cooldown state for it in Redis, so the next contest cycle starts fresh rather than inheriting stale cooldown timing from the previous owner's tenure.

Testing checklist:
- Integration test: crossing the 70 percent threshold sends exactly one alert to the controlling tribe's members, a second support action that keeps tension above 70 percent within the cooldown window does not send a duplicate
- Integration test: crossing 90 percent after already having sent the 70 percent alert sends the higher-urgency alert, confirming both levels fire independently
- Integration test: a flip immediately clears cooldown state, verified by triggering a fresh threat cycle right after
```

```
CURSOR IMPLEMENTATION PROMPT: Presence Tracking — Online User Counter & Tribe Chat Presence

Context: Powers the ambient "X people online" counter and green presence dots in tribe chat. Both are read-only, low-precision-is-fine features, don't over-engineer for perfect accuracy.

Target files: /backend/internal/presence/tracker.go

Tech stack alignment: Go, Redis (TTL-based heartbeat keys, cheapest correct approach for approximate presence).

Requirements:
1. Every connected WebSocket client (from the existing real-time hub) triggers a Redis key online:{user_id} with a short TTL (default 60s), refreshed on any inbound message or a lightweight periodic client-side ping, expiring naturally on disconnect without needing an explicit cleanup call, TTL expiry is the cleanup mechanism.
2. GET /v1/presence/online-count returns an approximate count (Redis SCARD or PFCOUNT if using a HyperLogLog for scale, document which you chose and why) of currently-online keys app-wide, this does not need to be exact to the user, "approximately N" framing is fine and should be reflected in how the frontend labels it.
3. Per-tribe presence: derive from the same online keys, filtered by each user's tribe_id (a Redis set per tribe refreshed alongside the TTL heartbeat, or a join against tribe_memberships at read-time if the online set is small enough, pick whichever scales better for your expected concurrency and document the tradeoff), exposed via GET /v1/tribes/{tribe_id}/online-members for the chat presence dots.

Testing checklist:
- Integration test: a client that disconnects without a clean close (simulate a dropped connection) still ages out of the online count within the TTL window, no manual cleanup required
- Integration test: online-count and per-tribe online-members stay consistent with each other, no user counted in a tribe's online set while absent from the global count
```

```
CURSOR IMPLEMENTATION PROMPT: Historical Map Snapshots for Time-Lapse (lower priority)

Context: Powers the map history scrubber. Lowest priority item in this set, build last or defer, the app is fully functional and feels alive without it.

Target files: /backend/internal/conquest/snapshot.go, /migrations/0039_map_snapshots.sql

Tech stack alignment: Go scheduled worker, Postgres.

Requirements:
1. A scheduled job (default hourly) snapshots the full 81-city ownership state into a map_snapshots table (snapshot_at, city_ownership JSONB), cheap enough at 81 rows per snapshot that a straightforward JSONB blob per snapshot is fine, no need for a normalized per-city-per-snapshot table.
2. GET /v1/map-snapshots?from=&to= returns the ordered list of snapshots in a time range for the frontend scrubber to step through, capped to a reasonable max range per request (default 7 days) to keep payloads bounded.

Testing checklist:
- Integration test: snapshot job is idempotent for a given hour, re-running it does not create duplicate snapshots for the same timestamp bucket
- Integration test: snapshot range endpoint respects the max-range cap and returns a clear error rather than an enormous payload if exceeded
```

====================================================================
FRONTEND
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: App-Wide Capture Toast, Persistent Conquest Log Screen & Own-Capture Celebration

Context: The foundational reaction layer for every capture event. Build this before the supporter-badge and ticker prompts, they extend what this establishes.

Target files: /frontend/components/conquest/CaptureToast.tsx, /frontend/app/(main)/conquest-log/page.tsx, /frontend/components/conquest/ConquestLogList.tsx, /frontend/components/conquest/CaptureCelebration.tsx, /frontend/context/ConquestContext.tsx

Requirements:
1. ConquestContext subscribes to the region_supported/flip WebSocket event app-wide (mounted at the (main) layout level from the app-shell work, not per-screen, so a toast can fire even while the user is on the profile or leaderboard tab, not only while looking at the map).
2. CaptureToast renders a slide-in banner from the top for every flip event, city name, previous tribe crest fading into new tribe crest, auto-dismissing after a few seconds, tappable to jump straight to that city on the map. Multiple rapid captures queue rather than overlap or interrupt each other, show one at a time in order, don't drop any.
3. Conquest log screen (reached from the notification bell or a dedicated entry point) fetches GET /v1/conquest-log on mount, paginated infinite-scroll, each row showing city, previous to new tribe transition, timestamp, and tapping a row navigates to that city's supporter badge (next prompt). Calls the unread-count/mark-read endpoints appropriately so the bell badge clears correctly.
4. CaptureCelebration triggers only when the caused_flip flag (from the capture-attribution backend prompt) comes back true for the requesting user's own most recent support action, a distinct, bigger visual treatment than the generic toast, a short particle/confetti burst on the map at the captured city's location, a distinct success sound (respecting the device's silent/mute state and a settings toggle), and a haptic tap on supported platforms. This must not fire for captures the user merely witnessed or contributed to without being the tipping contribution, that distinction is the entire point of the feature.

Testing checklist:
- Manual QA: rapid sequential test captures queue and display one at a time without overlapping or dropping any
- Manual QA: the celebration treatment fires only on the exact action that flips a city, not on contributing support that doesn't cross the threshold
- Integration test: conquest log unread count clears correctly after visiting the log screen, and does not double-count entries already marked read on a prior visit
```

```
CURSOR IMPLEMENTATION PROMPT: Capture Badge with Ranked Supporter Avatars

Context: Extends both the toast and the city support sheet with the ranked, named, pictured supporter list.

Target files: /frontend/components/conquest/SupporterBadge.tsx

Requirements:
1. SupporterBadge fetches GET /v1/conquest-log/{log_id}/supporters and renders a vertically stacked, ranked list, top contributor first with a crown/#1 marker, avatar image, display name, and their credit contribution, remaining ranks below with progressively smaller visual weight, and an "+N kişi daha" (N more people) line using the total-contributor-count from the response when the list exceeds the top-N returned.
2. The requesting user's own row (is_you from the backend) is visually distinguished, a colored outline or "sen" label, whether they're rank 1 or rank 8, so a contributor can find themselves in the list without hunting.
3. Embed this component both inside the CaptureToast/conquest-log-row (tap to expand) and inside the city support sheet's current-controller section, so a user checking who holds a city right now sees not just the tribe but the actual people, reinforcing the "you're competing against named people" framing established in the support-sheet work.
4. Handle missing/broken avatar images gracefully with the initials-fallback pattern, never a broken image icon in a ranked social list, that undercuts the entire feature's polish.

Testing checklist:
- Manual QA: rank ordering matches the backend response exactly, no client-side re-sorting that could disagree with the attributed contribution amounts
- Manual QA: the signed-in test user's own row is visually distinguishable at any rank position
- Manual QA: a supporter with no avatar_url still renders a clean fallback, never a broken image
```

```
CURSOR IMPLEMENTATION PROMPT: Derby Urgency Map Styling

Context: Extends the existing Turkiye map (TurkiyeMap.tsx) and DerbiBanner work with visual urgency treatment on the map itself, not just the banner elsewhere in the app.

Target files: patch /frontend/components/map/TurkiyeMap.tsx, /frontend/components/map/DerbiCityOverlay.tsx

Requirements:
1. When an active or imminent derbi event's city_code matches a rendered city, boost that city's fill saturation to full intensity relative to the slightly muted default used for normally-held cities (patch the base style's paint expression to support this two-tier saturation, driven by a derbi-active feature-state flag set from the derbi event data already available via the leaderboard/derbi endpoints).
2. Add a pulsing glow/border animation around the derbi city polygon, a smooth scale or opacity loop on a duplicate outline layer, not the fill layer itself, subtle enough to not compete with legibility of the city name label, and a small flame or lightning-bolt icon badge layered near the tribe crest.
3. Render a floating countdown chip near the city ("2s 14dk kaldı" while active, or "Yakında" plus start time if scheduled-but-not-active-yet), updating at least once per minute, sourced from the derbi event's starts_at/ends_at already available from the backend.
4. All of this clears automatically and immediately when the event resolves, driven by the same event-status data the DerbiBanner already consumes, don't leave stale urgency styling on a city after its derby ends.

Testing checklist:
- Manual QA: derby city is visually unmistakable at country-wide zoom, distinguishable from every other captured city at a glance
- Manual QA: pulsing animation does not degrade map pan/zoom frame rate noticeably on a mid-range test device
- Manual QA: urgency styling and countdown chip disappear immediately on event resolution without requiring a manual refresh
```

```
CURSOR IMPLEMENTATION PROMPT: Nationwide Activity Ticker Strip

Context: The strip that shows the country is alive even outside your current viewport. Sits below the CreditHeader (and below the DerbiBanner when one's showing) on the map screen.

Target files: /frontend/components/map/ActivityTicker.tsx

Requirements:
1. Fetches GET /v1/activity-feed on mount and subscribes to the activity:feed WebSocket channel for live updates, rendering a continuously auto-scrolling horizontal strip of short event snippets (city name, tribe, brief action, using the same Turkish suffix-grammar composition pattern already established for the activity feed elsewhere in the app, not a separately hand-written string format).
2. Tapping any ticker item recenters the map on that city and briefly highlights it, turning passive awareness into a one-tap way to jump to wherever the action is.
3. Auto-scroll pauses on user touch/hover and resumes after a short idle period, never fighting the user's own interaction with the strip.
4. New live items entering via the WebSocket subscription insert smoothly at the entry point of the scroll rather than jarringly resetting scroll position.

Testing checklist:
- Manual QA: ticker continues scrolling smoothly with no jank across an extended idle session
- Manual QA: tapping a ticker item correctly recenters and highlights the referenced city
- Manual QA: a live-arriving event during active user interaction with the ticker doesn't interrupt or reset their scroll position
```

```
CURSOR IMPLEMENTATION PROMPT: Momentum Badges & Always-Visible Contest-Tension Ring

Context: Two ambient, always-on map indicators, built together since both read from the same GET /v1/cities fields added in the backend momentum/tension prompt.

Target files: patch /frontend/components/map/TurkiyeMap.tsx, /frontend/components/map/MomentumBadge.tsx

Requirements:
1. Any city with flips_today above a configurable display threshold (default 2) gets a small flame or double-arrow icon badge near its crest, with the count on tap/hover ("Bugün 3 kez el değiştirdi"), don't render this for every city, only genuinely volatile ones, so it stays a meaningful signal rather than visual noise.
2. current_streak_days above a configurable threshold (default 5) instead shows a small streak-flame-with-number badge on stably-held cities, momentum and streak badges are mutually exclusive per city, a city is either volatile or stable, never show both markers at once.
3. contest_tension from the backend drives a thin ambient ring around every city polygon whose tension exceeds a low display floor (default 0.3, below that render nothing, to avoid a ring around every single city all the time), ring opacity/color intensity scales continuously with the tension value, brightest and most saturated as it approaches the flip threshold, this must update live as support actions come in, not just on page load.
4. Keep this layer visually subordinate to the derby urgency styling from the previous prompt, a derby city should still read as the most urgent thing on the map even if a non-derby city also happens to have high contest tension at the same moment, tune opacity/z-ordering accordingly.

Testing checklist:
- Manual QA: momentum and streak badges never appear simultaneously on the same city
- Manual QA: contest-tension ring intensity visibly increases in near-real-time as a test account pushes a city's tension upward through repeated support actions
- Manual QA: a derby city with high contest tension still visually reads as more urgent than a non-derby city with equally high tension
```

```
CURSOR IMPLEMENTATION PROMPT: Sea Creatures & Ambient Day/Night Layer

Context: Pure delight, zero gameplay weight, must be cheap to render and never interfere with real interactions.

Target files: /frontend/components/map/AmbientLayer.tsx, /frontend/lib/map/ambientAssets.ts

Requirements:
1. Occasional, low-frequency sprite animations (dolphin arcs, seagull flocks, a small boat) drifting along a simple bezier or linear path across the sea areas of the map (Aegean, Mediterranean, Black Sea, Marmara), randomized timing (default roughly once every 3 to 8 minutes, jittered, not on a fixed metronome), randomized which creature and which sea region, implemented as a lightweight CSS/SVG or canvas overlay layer, not additional Maplibre GL layers, keep it decoupled from the main map rendering so it can never cause a map interaction stutter.
2. These animations are purely decorative: no click targets, no z-index conflicts with real map interactions, positioned and timed to never overlap the currently-selected city or an open support sheet.
3. A subtle day/night gradient overlay on the base map fill, driven by real Turkish local time (a soft warm tint in evening hours, a cooler tint at night), applied as a low-opacity overlay layer, not by altering the tribe-color fill logic itself, this must never reduce the legibility of city fill colors or labels.
4. Both features respect a "reduce motion" accessibility setting if the app has one, or add one now if not, disabling the sprite animations (day/night tinting can stay, it's static per render, not motion) for users who've opted out.

Testing checklist:
- Manual QA: ambient animations never block or intercept a tap intended for a city polygon or UI control beneath them
- Manual QA: day/night tint at no time of day meaningfully reduces the legibility of tribe fill colors, verified at both midday and midnight settings
- Manual QA: enabling "reduce motion" fully suppresses sprite animations while leaving the rest of the map fully functional
```

```
CURSOR IMPLEMENTATION PROMPT: Online User Counter & Tribe Chat Presence Dots

Context: Frontend for the presence-tracking backend prompt.

Target files: /frontend/components/shell/OnlineCounter.tsx, patch /frontend/components/chat/ChatThread.tsx

Requirements:
1. OnlineCounter polls or subscribes to GET /v1/presence/online-count at a reasonable interval (default every 30s, this doesn't need WebSocket-grade freshness), rendered small and unobtrusive in a map-screen corner or header area, labeled approximately ("~1.240 kişi haritada") consistent with the backend's approximate-count framing, never implying false precision.
2. ChatThread renders a small green dot on the avatar of any tribe member currently in GET /v1/tribes/{tribe_id}/online-members, refreshed on the same polling cadence as the online counter or piggybacked on the chat WebSocket connection's own heartbeat if that's cheaper, dot disappears promptly (within roughly the backend's TTL window) when a member goes offline, don't let stale presence linger visibly long after someone's actually left.

Testing checklist:
- Manual QA: online counter updates within its polling interval and never displays a misleadingly exact-looking number
- Manual QA: a test account's presence dot in tribe chat appears within one polling cycle of connecting and clears within one TTL window of disconnecting
```

```
CURSOR IMPLEMENTATION PROMPT: Animated Credit Flow on Support

Context: Small but high-value tactile polish on the existing City Support Sheet.

Target files: patch /frontend/components/map/CitySupportSheet.tsx, /frontend/components/shell/CreditFlowAnimation.tsx

Requirements:
1. On successful support submission, animate a small burst of coin/particle sprites originating from the CreditHeader's balance display, arcing toward the map location of the supported city, timed to roughly coincide with the optimistic balance decrement already implemented, purely visual, must not block or delay the actual optimistic-update/reconciliation logic already in place.
2. Keep this cheap (CSS/SVG transform animation, not a heavy particle engine) and respect the same "reduce motion" setting introduced in the ambient-layer prompt, falling back to a simple balance-tick with no flight animation when that setting is on.

Testing checklist:
- Manual QA: the animation plays correctly for a support action on a city currently visible on screen and degrades gracefully (skips the flight animation, still updates balance) for a city off-screen or on first support from the city-picker list rather than a map tap
- Manual QA: "reduce motion" setting suppresses the flight animation while the underlying balance update still functions normally
```

```
CURSOR IMPLEMENTATION PROMPT: Rival-Threat Alert UI

Context: Frontend consumption of the targeted rival-threat push notifications, plus an in-map visual echo for users already looking at the screen when the threat fires.

Target files: /frontend/components/conquest/ThreatAlertBanner.tsx, patch /frontend/lib/notifications/pushHandler.ts

Requirements:
1. Incoming rival-threat push notifications deep-link directly into the city's support sheet on tap, per the backend's payload design, verify this works correctly from a cold app launch (app not running) as well as a backgrounded/foregrounded app.
2. If the user is already active in the app and on the map screen when a threat alert fires for a city they can see, show a ThreatAlertBanner (distinct styling from the generic capture toast, more alarmed, using the controlling tribe's own color as the banner accent since this is specifically about defending, not a neutral system notice) in addition to the push, don't rely on push delivery alone for someone already looking at the relevant screen.
3. Banner includes a direct "Savun" (Defend) button that opens the support sheet for that city pre-focused on the credit input, minimizing taps between noticing the threat and acting on it.

Testing checklist:
- Manual QA: a test threat-alert push correctly deep-links to the right city's support sheet from a cold launch
- Manual QA: a threat alert for a currently-visible city shows the in-app banner without requiring the push notification to also be tapped
- Manual QA: the Defend button reliably lands the user in the credit-input step ready to act, not just a generic city view
```

```
CURSOR IMPLEMENTATION PROMPT: Time-Lapse History Scrubber (lower priority)

Context: Frontend for the historical-snapshot backend prompt. Build last, the app is fully alive without it.

Target files: /frontend/app/(main)/map/history/page.tsx, /frontend/components/map/HistoryScrubber.tsx

Requirements:
1. Fetches GET /v1/map-snapshots for a selected date range, renders a horizontal scrubber/slider the user can drag or auto-play through, re-rendering the map's city fill colors to match each snapshot's ownership state as the scrubber moves, reusing the same TurkiyeMap rendering component in a read-only, non-interactive mode (no support sheet, no taps trigger real actions while viewing history).
2. Auto-play steps through snapshots at a brisk, adjustable pace with play/pause controls, and a clear visual indicator (a banner or watermark) that the user is viewing historical, not live, data, so there's no confusion about whether tapping anything here does something real.

Testing checklist:
- Manual QA: scrubbing correctly re-renders city colors matching each snapshot's actual recorded ownership state
- Manual QA: no interaction while in history mode can trigger a real support action or navigate into the live support sheet
```
