IMPLEMENTATION ROADMAP & CURSOR PROMPT SET

Sequenced against dependency risk: identity/consent (Sprint 0–1, already implemented) before tribes and credits, credits before the province-support loop, support before derby multipliers, core loop before social/leaderboards, social before full monetization hardening, analytics last. Related low-complexity use cases are batched into one prompt; anything with legal, concurrency, or linguistic complexity gets its own isolated prompt.

Gameplay model: users join a fixed admin-managed parody tribe, buy credits, and support a province (il) on the map. No continuous GPS / physical presence is required for support. Admins create derby events (host vs guest tribe + city) that notify members and apply 2× effective support in that city while active.

Each prompt below is in a plain text block. Copy the whole block into Cursor.

====================================================================
SPRINT 0 — PLATFORM BOOTSTRAP (prerequisite, not in original catalog)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Monorepo & Infra Scaffold

Context: Establishes the Go/PostgreSQL+PostGIS/Redis/Next.js skeleton every later prompt builds on. No game logic yet.

Target files: /backend/cmd/api/main.go, /backend/internal/config/, /backend/internal/db/, /backend/internal/cache/, /migrations/0001_init.sql, /frontend/ (Next.js app dir), docker-compose.yml, .env.example

Tech stack alignment: Go 1.22+ with slog structured logging, pgx driver + pgxpool, PostGIS extension enabled in migration 0001, go-redis/v9, Next.js 14 App Router, Maplibre GL JS base map component pointed at a self-hosted or MapTiler TR-region tile source.

Requirements:
1. docker-compose.yml spins up: postgres:16 with postgis/postgis:16-3.4 image, redis:7, backend, frontend.
2. Migration 0001 creates extensions postgis, pg_trgm. Set collation per-column later using ICU locale tr-TR-x-icu on relevant text columns, not a database-wide MySQL-style collation.
3. pgxpool configured with explicit MaxConns, MinConns, MaxConnLifetime read from env, not hardcoded.
4. slog configured with JSON handler in production, text handler in dev, request-ID middleware injecting a UUID into every log line.
5. Health check endpoint GET /healthz verifying DB and Redis connectivity, returning 503 with explicit reason on failure, no silent 200s.
6. Next.js base layout with Maplibre canvas centered on Turkiye (lat 39.0, lon 35.0, zoom 5.5) as placeholder.

Testing checklist:
- docker-compose up boots all four services with no manual steps
- /healthz returns 200 when DB/Redis are up and 503 with a JSON error body when either is stopped
- Migration is idempotent (migrate up twice does not error)
- Go module has golang.org/x/text pulled in for later Turkish casing work
```

====================================================================
SPRINT 1 — IDENTITY & KVKK CONSENT FOUNDATION (Epic 01)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Phone OTP Registration + Turkish-Safe Username Validation (covers 01.1, 01.10)

Context: First user-facing flow. Must be correct before any other identity work stacks on top of it.

Target files: /backend/internal/auth/otp.go, /backend/internal/auth/handlers.go, /backend/internal/user/username.go, /migrations/0002_users.sql, /frontend/app/(auth)/register/

Tech stack alignment: Go, Postgres (users table), Redis (OTP code storage with TTL), Next.js form.

Requirements:
1. POST /v1/auth/otp/request accepts E.164 Turkish numbers (+90 prefix enforced), validates against Turkcell/Vodafone/Turk Telekom prefix ranges, rejects malformed numbers with explicit 400 error_invalid_phone_format.
2. OTP code (6-digit) stored in Redis with key otp:{phone} and 120s TTL. Resend endpoint enforces a 60s cooldown via a separate Redis key otp_cooldown:{phone}.
3. SMS provider call is behind an interface SMSProvider with two implementations stubbed (primary, fallback) and automatic fallback on primary provider error, logged via slog with provider name and latency.
4. Username validation in username.go uses golang.org/x/text/cases.Fold with the tr language tag. Do NOT use Go's built-in strings.ToLower/ToUpper anywhere in this path, since it mishandles Turkish dotted/dotless I. Add a unit test asserting Istanbul with a dotted capital I and istanbul lowercase are treated as distinct usernames by default but an all-caps ISTANBUL correctly case-folds under the Turkish-aware fold.
5. Username column uses Postgres ICU collation tr-TR-x-icu for uniqueness comparison and sort order.

Testing checklist:
- Unit test: OTP request/verify round trip succeeds within TTL and fails after expiry
- Unit test: resend before cooldown returns 429
- Unit test: Turkish dotted/dotless I casing does not produce false-duplicate or false-unique username collisions
- Integration test: SMS primary provider failure triggers fallback and still returns 200 to client
```

```
CURSOR IMPLEMENTATION PROMPT: KVKK Consent Gate - Disclosure + Explicit Location Consent + Data Residency Banner (covers 01.2, 01.3, 01.4)

Context: Legally blocking flow. No location permission may be requested by the client until both consents are recorded server-side.

Target files: /backend/internal/consent/, /migrations/0003_consent.sql, /frontend/app/(auth)/consent/, /frontend/components/ConsentModal.tsx

Tech stack alignment: Go, Postgres (append-only consent log table, never UPDATE, only INSERT new rows per consent event), Next.js modal gating navigation.

Requirements:
1. consent_events table: id, user_id, consent_type (enum: aydinlatma_metni, acik_riza_location, terms_of_service), consent_version, granted (bool), created_at, ip_address, user_agent. Never mutate rows. Withdrawal is a new row with granted=false.
2. GET /v1/consent/status returns current effective state per consent_type (latest row per type per user).
3. POST /v1/consent/grant requires consent_type + consent_version matching the currently published version (stored in a consent_versions config table). Reject stale-version consent attempts with 409 consent_version_outdated, forcing client to re-fetch latest text.
4. Client: ConsentModal.tsx is a blocking overlay (no dismiss/skip) shown before any navigator.geolocation call. The disclosure text and location consent are two visually distinct, independently-checked checkboxes. Do not combine them into one "I agree" checkbox, since KVKK requires granular consent per purpose.
5. Data residency banner component reads a build-time env var NEXT_PUBLIC_DATA_REGION (TR or EU) and renders the corresponding disclosure text. No hardcoded region string in the component.

Testing checklist:
- Integration test: client cannot reach the map screen without both consent types granted
- Unit test: granting consent with an outdated consent_version is rejected
- Unit test: consent table is never updated in place, assert via row count growth, not row mutation, across repeated grant/withdraw cycles
```

```
CURSOR IMPLEMENTATION PROMPT: Consent Withdrawal & Right-to-Erasure Cascade (covers 01.5, 01.6)

Context: Highest-risk data-handling flow in the app. Must cascade correctly across every store or the company is non-compliant. Kept isolated from the grant flow due to its cross-service blast radius.

Target files: /backend/internal/consent/withdraw.go, /backend/internal/erasure/, /backend/internal/erasure/worker.go, /migrations/0004_erasure_jobs.sql

Tech stack alignment: Go worker pool (bounded, e.g. 10 concurrent erasure jobs), Postgres, Redis, object storage client interface (stub acceptable), async job table for auditability.

Requirements:
1. POST /v1/consent/withdraw with consent_type acik_riza_location immediately, synchronously, in-request, stops future location writes for that user by flipping a Redis flag location_tracking_disabled:{user_id} checked at the top of the location-ingestion handler. This must be synchronous, not eventually-consistent.
2. Withdrawal additionally enqueues an anonymization job: historical path points for that user get user_id nulled and replaced with a non-reversible bucket ID for aggregate analytics retention only.
3. POST /v1/account/erasure-request creates a row in erasure_jobs (id, user_id, status, requested_at, completed_at) and enqueues to the Go worker pool. Worker executes in order: delete from location_history, release all held map tiles to neutral and delete tile_ownership rows for that user, delete Redis keys matching user:{id}:* via SCAN (never KEYS in production, it blocks Redis), delete/anonymize rows in users and consent_events (retain only the fact that consent existed, without PII), emit a deletion event for the analytics warehouse consumer to purge.
4. Every step logs success/failure independently via slog with job_id. Partial failure marks the job status partial_failure and is retryable per-step, not restarted from scratch.
5. SLA: job must reach terminal state within 30 days per KVKK. Add a slog.Warn alert hook if any job remains pending past 25 days.

Testing checklist:
- Integration test: withdrawing location consent mid-session causes the very next location-write attempt to be rejected with 403
- Integration test: erasure job leaves zero rows referencing the user's raw user_id in location_history and tile_ownership
- Unit test: Redis cleanup uses SCAN-based iteration, not KEYS
- Unit test: partial failure on one step does not re-run already-completed prior steps
```

> **Follow-up (credits, Sprint 2):** When implementing the erasure worker above, also anonymize/delete `credit_accounts` and `credit_ledger` PII linkage for that `user_id` (KVKK erasure is the documented exception to the append-only ledger rule). Do not rewrite the frozen Sprint 1 prompt body — apply this as an extra cascade step in the worker implementation.

```
CURSOR IMPLEMENTATION PROMPT: Age Gate & Social Login Merge (covers 01.7, 01.8)

Context: Auth edge cases layered on top of Sprint 1's OTP flow.

Target files: /backend/internal/auth/agegate.go, /backend/internal/auth/social.go, /migrations/0005_social_identities.sql

Tech stack alignment: Go, Postgres, Google/Apple OAuth token verification libraries.

Requirements:
1. Registration requires birth date. Users under 18 are flagged restricted_mode=true on the users row. This flag must be checked by the social/leaderboard/clan endpoints built in later sprints, note this as a required check for those prompts.
2. Restricted-mode accounts: leaderboard endpoints exclude them from public rank listing (still tracked internally). Clan chat/DM endpoints return 403 restricted_mode.
3. Social login verifies the provider ID token server-side, never trust client-supplied profile data. On first login, check social_identities for an existing link by provider + provider_user_id.
4. If the verified email/phone from the social provider matches an existing phone-registered account, do NOT auto-merge. Return 409 with a merge_token requiring the user to confirm via their existing OTP flow before linking, to prevent account-takeover via a spoofed social profile.

Testing checklist:
- Unit test: under-18 birth date sets restricted_mode=true
- Integration test: restricted-mode user hitting clan-chat endpoint gets 403
- Integration test: social login matching an existing phone account requires OTP confirmation before merge completes, never auto-merges
```

====================================================================
SPRINT 2 — TRIBES & CREDITS FOUNDATION (Epic 03 subset, Epic 06 prep)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Fixed Parody Tribes Seed, Join/Switch & Admin CRUD (covers 03.1, 03.2, 03.3, 03.4, 03.5)

Context: First post–Sprint-1 gameplay prerequisite. Users must belong to a tribe before they can support provinces. Tribes are fixed fiction factions parodying Türkiye’s most popular football clubs — never use real club names, crests, or trademarks.

Target files: /backend/internal/tribe/, /migrations/0006_tribes.sql, /backend/internal/tribe/seed/parody_tribes.json, /frontend/app/(app)/tribes/

Tech stack alignment: Go, Postgres, Next.js tribe picker UI.

Requirements:
1. tribes table: id, slug, display_name, short_name, primary_color, secondary_color, is_active, created_by_admin_id (nullable for seed), created_at, updated_at. Seed exactly 10 parody tribes from parody_tribes.json (fiction names only). Do not hardcode tribe names in Go source.
2. Only admins may POST /v1/admin/tribes (create) and PATCH /v1/admin/tribes/{id} (update/deactivate). Regular users cannot create tribes. Admin auth uses a distinct role check middleware, not the regular-user session alone.
3. users.tribe_id (nullable FK). POST /v1/tribes/{id}/join sets the user’s active tribe. One active tribe per user. Switching via POST /v1/tribes/{id}/switch enforces a configurable cooldown (default 7 days) via users.tribe_switched_at; reject with 429 tribe_switch_cooldown if within window.
4. Prior supports remain attributed to the tribe_id recorded on each support row at spend time; switching does not rewrite history.
5. GET /v1/tribes lists active tribes. GET /v1/tribes/{id} returns public profile (member_count, colors, names). Restricted-mode users may join a tribe but later tribe-chat prompts must still return 403.

Testing checklist:
- Integration test: non-admin POST /v1/admin/tribes returns 403
- Integration test: join succeeds; second join without switch endpoint is rejected or treated as idempotent same-tribe
- Integration test: switch before cooldown returns 429; after cooldown succeeds
- Unit test: seed loads 10 tribes with unique slugs and no empty display_name
```

```
CURSOR IMPLEMENTATION PROMPT: Credit Wallet & Append-Only Ledger (covers 06.1 prep, 02.8 prep)

Context: Credits gate every support action. Real payment providers land in Sprint 11; this prompt ships the wallet, ledger invariants, and a dev-only stub top-up so Sprint 3 can be tested end-to-end.

Target files: /backend/internal/credits/wallet.go, /backend/internal/credits/ledger.go, /migrations/0007_credits.sql

Tech stack alignment: Go, Postgres (transactional balance + ledger), Redis optional for read-through balance cache with write-through invalidation.

Requirements:
1. credit_accounts table: user_id PK, balance (bigint, never negative), updated_at. credit_ledger table: id, user_id, delta (signed bigint), balance_after, reason enum (purchase, stub_grant, support_spend, refund, referral, admin_adjust), ref_type, ref_id, idempotency_key (unique), created_at. Ledger is append-only; never UPDATE/DELETE ledger rows from application code.
2. All balance mutations happen in a single Postgres transaction: insert ledger row, update credit_accounts.balance with a CHECK (balance >= 0) or equivalent WHERE balance + delta >= 0 guard. Concurrent spends must not overdraw; use row lock on credit_accounts or an atomic UPDATE ... RETURNING pattern.
3. GET /v1/credits/balance returns current balance. POST /v1/credits/stub-grant (enabled only when CREDITS_STUB_ENABLED=true) grants a configurable amount for local/dev/QA, requiring idempotency_key. Production must refuse stub-grant with 404/403.
4. Expose an internal Go API GrantCredits / SpendCredits used by support and later payment webhooks — handlers must not duplicate SQL.
5. Erasure worker (Sprint 1) follow-up note: account erasure must anonymize/delete credit_accounts and credit_ledger PII linkage for that user_id; add this as an explicit patch to the erasure step list without rewriting Sprint 1’s shipped prompt text beyond a callout in this prompt’s target follow-up.

Testing checklist:
- Concurrency test: 50 parallel spends against balance 10 with amount 1 never drive balance negative, go test -race clean
- Unit test: duplicate idempotency_key grant does not double-credit
- Integration test: stub-grant disabled when CREDITS_STUB_ENABLED is false
- Unit test: ledger reason support_spend with insufficient funds returns a typed error mapped to 402 insufficient_credits
```

```
CURSOR IMPLEMENTATION PROMPT: Rate Limiting on Support & Credit Write Routes (covers 02.7, 07.3)

Context: Guards spend-spam and stub-grant abuse independent of payment fraud.

Target files: /backend/internal/ratelimit/tokenbucket.go, /backend/internal/middleware/ratelimit.go

Tech stack alignment: Go middleware, Redis-backed token bucket (Lua script for atomicity).

Requirements:
1. Token bucket implemented as a Redis Lua script (atomic check-and-decrement) keyed ratelimit:{user_id}:{route_group}.
2. Default limits: support-spend route group 2 req/sec sustained, burst 5. Credit-write route group (stub-grant / purchase callbacks) 1 req/sec sustained, burst 3. Both configurable via env.
3. Exceeding the limit returns 429 with Retry-After computed from the bucket refill rate.
4. Rate-limit hits logged via slog at Warn with user_id and route_group.

Testing checklist:
- Unit test: Lua script denies the 6th burst request and allows the first refilled request after the window
- Integration test: 429 includes a valid Retry-After header
- Concurrency test: 50 parallel requests against the same bucket never over-allow, go test -race clean
```

====================================================================
SPRINT 3 — CORE SUPPORT LOOP & LIVE MAP (Epic 02 core + Epic 07.1/07.2)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Province Boundaries & Support Spend (covers 02.1, 02.2, 02.8)

Context: Central gameplay action. User selects a province (il) on the map and spends credits for their tribe. No navigator.geolocation and no GPS ping pipeline.

Target files: /backend/internal/support/spend.go, /backend/internal/geo/provinces.go, /migrations/0008_admin_boundaries.sql, /migrations/0009_support.sql, /frontend/components/ProvinceMap.tsx

Tech stack alignment: Go, PostGIS (il polygons), Postgres transactions, Maplibre province interaction (click → il_code).

Requirements:
1. admin_boundaries table holds il polygons for all 81 provinces (il_code, name_tr, name_en, geom). Load from a canonical dataset via import script path — do not inline GeoJSON in this prompt.
2. supports table: id, user_id, tribe_id, il_code, credits_spent, multiplier, effective_support, derby_id nullable, created_at. tribe_id is snapshotted from the user at spend time.
3. POST /v1/support body: { il_code, credits }. Requires authenticated user with a non-null tribe_id; otherwise 409 tribe_required. Validates il_code exists. Rejects credits <= 0 with 400.
4. Spend path in one transaction: SpendCredits(credits), insert supports row with multiplier (default 1.0; derby resolution is a seam called from Sprint 5 — export ResolveSupportMultiplier(user, tribe, il_code, now) interface stub returning 1.0 until derby lands), effective_support = credits_spent * multiplier, upsert tribe_province_scores (tribe_id, il_code, effective_support_sum) += effective_support.
5. On success publish Redis Pub/Sub event support_applied:{il_code} with tribe_id and delta for the live map layer. Do not call navigator.geolocation anywhere in the client support flow.

Testing checklist:
- Integration test: support without tribe returns 409
- Integration test: support with insufficient credits returns 402 and inserts zero supports rows
- Integration test: successful support decrements balance by credits_spent and increments tribe_province_scores by effective_support
- Unit test: invalid il_code returns 400
```

```
CURSOR IMPLEMENTATION PROMPT: WebSocket Real-Time Province Control Layer (covers 07.1)

Context: Live map updates when supports land. Required before engagement alerts feel real-time.

Target files: /backend/internal/realtime/hub.go, /backend/internal/realtime/ws_handler.go, /frontend/lib/mapSocket.ts

Tech stack alignment: Go websocket, Redis Pub/Sub cross-instance fan-out, Next.js client hook.

Requirements:
1. Each Go instance runs a local Hub of connected clients, subscribed to support_applied:* (pattern subscribe) or per-viewport channels — document the choice.
2. Client sends current map viewport bbox on connect and on significant pan/zoom (debounced). Server forwards only events for provinces intersecting the client’s last-known viewport.
3. Disconnect cleanup unsubscribes Redis channels and removes the client from the Hub; verify no goroutine leak per closed connection.
4. Client reconnect with exponential backoff capped at 30s in mapSocket.ts.

Testing checklist:
- Load test: 5,000 concurrent WS connections on one instance without unbounded goroutine growth (pprof)
- Integration test: support event outside viewport is NOT delivered
- Integration test: closing a connection clears that client’s Redis subscriptions within 1s
```

```
CURSOR IMPLEMENTATION PROMPT: Province Control Cache (covers 07.2)

Context: Read-side optimization once support writes exist.

Target files: /backend/internal/support/cache.go

Tech stack alignment: Go, Redis cache-aside in front of tribe_province_scores / control % reads.

Requirements:
1. Map viewport / province control reads check Redis first (province_control:{il_code}), miss → Postgres → populate with TTL (default 300s) plus explicit invalidation.
2. Every successful support spend invalidates or updates province_control:{il_code} in the same code path (push-based, not TTL-only).
3. Cache stampede protection: short-lived Redis lock (SET NX PX) around DB-fallback-and-repopulate.

Testing checklist:
- Integration test: support immediately updates the value seen by a subsequent control read (no stale window)
- Concurrency test: 100 concurrent cache-miss reads for the same il result in exactly one Postgres query, go test -race clean
```

====================================================================
SPRINT 4 — CONTROL VIZ & ENGAGEMENT HOOKS (Epic 02 remainder)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Materialized Province Control % & Support History (covers 02.3, 02.4)

Context: Choropleth and personal history read paths.

Target files: /backend/internal/support/control.go, /backend/internal/support/history.go, /frontend/components/ProvinceChoropleth.tsx

Tech stack alignment: Go, Postgres summary table, Maplibre fill-extrusion or data-driven paint by leading tribe color.

Requirements:
1. province_control_summary table (il_code, tribe_id, effective_support_sum, control_pct, refreshed_at) maintained by a Go worker every N seconds (default 30s) or incrementally on spend — pick one and document; reads must not recompute ST_Area live per request.
2. GET /v1/provinces/control returns all 81 ils with leading tribe and control_pct (leading tribe’s share of total effective support in that il; 0 if no supports).
3. GET /v1/me/supports returns the authenticated user’s support history only (no client-supplied user id). Paginated, newest first.
4. Frontend choropleth colors provinces by leading tribe primary_color with opacity/intensity from control_pct.

Testing checklist:
- Integration test: user A cannot fetch user B’s support history via parameter tampering
- Unit test: control_pct for a single-tribe province is 100
- Integration test: after supports from two tribes, control percentages sum to ~100 within rounding tolerance
```

```
CURSOR IMPLEMENTATION PROMPT: Daily Support Streak & Lead-Threatened Alerts (covers 02.5, 02.6, 04.4 subset)

Context: Lightweight retention hooks on top of the support loop.

Target files: /backend/internal/engagement/streak.go, /backend/internal/engagement/rival_alerts.go, /migrations/0010_engagement.sql

Tech stack alignment: Go, Postgres streak state, Redis notification queue.

Requirements:
1. user_support_streaks: user_id, current_streak, longest_streak, last_support_date (DATE in Europe/Istanbul). On each successful support, update streak: same day no change; yesterday +1; else reset to 1.
2. Lead-threatened detector: when a support causes the second-place tribe’s effective sum in an il to cross a configurable gap threshold behind the leader (e.g. within 10%), enqueue a rate-limited notification to members of the leading tribe (max 1 per user per il per 30 minutes).
3. Notifications go to notif_queue in Redis for the Sprint 7 push worker; this prompt only enqueues structured payloads (type province_lead_threatened, il_code, tribe_id).

Testing checklist:
- Unit test: supporting on consecutive Istanbul calendar days increments streak; skipping a day resets to 1
- Integration test: gap-threshold crossing enqueues exactly one notif per user within the rate window
- Unit test: support that does not threaten the lead enqueues nothing
```

====================================================================
SPRINT 5 — DERBY EVENTS (Epic 11)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Admin Derby Create, State Machine & Member Notify (covers 11.1, 11.2, 11.3, 11.5)

Context: Match-day style events. Admin picks host tribe, guest tribe, and competing city (il).

Target files: /backend/internal/derby/, /migrations/0011_derbies.sql, /frontend/app/(admin)/derbies/, /frontend/app/(app)/derbies/

Tech stack alignment: Go, Postgres, Redis (live scores), notification enqueue.

Requirements:
1. derbies table: id, host_tribe_id, guest_tribe_id, il_code, starts_at, ends_at, status (scheduled|active|resolved), host_effective_total, guest_effective_total, created_by_admin_id, created_at. CHECK host_tribe_id <> guest_tribe_id.
2. POST /v1/admin/derbies creates a derby; validates both tribes active and il_code exists. GET /v1/derbies and GET /v1/derbies/{id} are public to authenticated users.
3. State transitions scheduled → active → resolved driven by a Go ticker/cron comparing starts_at/ends_at. Admin may POST /v1/admin/derbies/{id}/force-resolve. Do not skip active even if ends_at already passed at check time — transition through active briefly and slog.Warn the anomaly.
4. On create and on transition to active, enqueue notifications to all members of host and guest tribes (type derby_announced / derby_started). Fan-out via Redis notif_queue; do not inline FCM calls here.
5. While active, maintain Redis counters derby_score:{derby_id}:host and :guest updated from the support path (Sprint 5 multiplier prompt). On resolve, persist totals into derbies row and set a TTL on Redis keys rather than deleting immediately (crash-safe retry).

Testing checklist:
- Integration test: create with identical host/guest rejected
- Unit test: state machine will not jump scheduled → resolved without active
- Integration test: create enqueues notifications targeting only host+guest members
- Integration test: force-resolve persists Redis scores into Postgres
```

```
CURSOR IMPLEMENTATION PROMPT: Derby 2x Support Multiplier Wiring (covers 11.4, 02.2)

Context: Patches ResolveSupportMultiplier used by Sprint 3’s spend path.

Target files: /backend/internal/derby/multiplier.go (implements the Sprint 3 seam), update /backend/internal/support/spend.go call site

Tech stack alignment: Go, Postgres derby lookup (cache active derbies in Redis set active_derbies).

Requirements:
1. ResolveSupportMultiplier returns 2.0 when: an active derby exists for il_code AND the user’s tribe_id is host_tribe_id or guest_tribe_id. Otherwise 1.0.
2. Non-competing tribe members supporting the derby city still get 1.0. Competing tribe members supporting a different city get 1.0.
3. Persist multiplier and derby_id on the supports row when 2× applies. Increment the correct Redis derby_score counter by effective_support (not raw credits).
4. Cache active derby-by-il lookups; invalidate on derby state transitions.

Testing checklist:
- Integration test: competing tribe support in derby city stores multiplier=2 and doubles effective_support vs credits_spent
- Integration test: non-competing tribe in same city stores multiplier=1
- Integration test: competing tribe in a non-derby city stores multiplier=1
- Unit test: no active derby → always 1.0
```

====================================================================
SPRINT 6 — SCALE HARDENING (Epic 07.4, 07.5, 07.6)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Connection Pool Separation, Read Replicas & Circuit Breaker

Context: Ops hardening once the support loop is load-testable. No location-ingestion workers.

Target files: /backend/internal/db/pools.go, /backend/internal/db/circuitbreaker.go, /backend/internal/config/config.go

Tech stack alignment: Go, pgxpool (separate pools), Postgres streaming replication (client routing only in this prompt).

Requirements:
1. Two pgxpool.Pool instances: WritePool (support spends, ledger, derby admin writes) and ReadPool (map control, leaderboards, tribe lists), independently tuned MaxConns from config.
2. ReadPool uses DB_READ_REPLICA_DSN when set, else falls back to primary for local/dev.
3. Circuit breaker wraps WritePool: after configurable consecutive failures (default 5), open for cooldown (default 30s); write handlers return 503 write_path_degraded. GET /v1/system/status reports breaker state for a frontend read-only banner.

Testing checklist:
- Integration test: 5 consecutive write failures trip the breaker; 6th short-circuits without DB
- Integration test: half-open after cooldown allows a trial request
- Config test: ReadPool falls back to primary when replica DSN unset
```

====================================================================
SPRINT 7 — SOCIAL & ENGAGEMENT (Epic 04)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Friends, Block/Mute/Report (covers 04.1, 04.6)

Context: Relationship-state CRUD shared across social features.

Target files: /backend/internal/social/friends.go, /backend/internal/social/moderationflags.go, /migrations/0012_social_relations.sql

Requirements:
1. Single user_relations table with type enum (friend_request, friend, blocked, muted).
2. Blocking is bidirectional-effective via reusable IsBlocked(a, b) used by DM, feed visibility, and referral surfaces.
3. POST /v1/reports creates user_reports (reporter_id, reported_id, reason, context_type, context_id, status=pending).

Testing checklist:
- Integration test: blocked user’s friend request to blocker is rejected pre-insert
- Integration test: report defaults to status=pending
```

```
CURSOR IMPLEMENTATION PROMPT: Direct Messaging & Tribe Chat (covers 04.2, 03.7)

Context: Reuses realtime Hub; tribe chat keyed by tribe:{id}.

Target files: /backend/internal/social/dm.go, /backend/internal/tribe/chat.go, /migrations/0013_messages.sql, /backend/internal/moderation/profanity_tr.go, /backend/internal/moderation/data/tr_wordlist.txt

Requirements:
1. Write-then-broadcast persistence for DMs and tribe chat. Profanity filter (Turkish wordlist + leetspeak normalization + Turkish-aware case fold from Sprint 1 username helpers) before store/broadcast; flagged messages stored with flagged=true and withheld from broadcast.
2. Restricted-mode users: tribe chat 403; DMs only with existing friends (config flag to fully disable later).
3. IsBlocked rejects DM attempts before write.

Testing checklist:
- Integration test: message persists if broadcast fails
- Integration test: profanity-flagged message not delivered to other members
- Integration test: restricted-mode tribe chat rejected pre-write
```

```
CURSOR IMPLEMENTATION PROMPT: Localized Activity Feed with Turkish Suffix Grammar (covers 04.3)

Context: Linguistics-correctness problem — isolated prompt.

Target files: /backend/internal/feed/events.go, /backend/internal/i18n/turkish_suffix.go, /migrations/0014_activity_feed.sql

Requirements:
1. Store structured events (event_type, actor_id, place_name, place_type, tribe_id, created_at), never pre-rendered strings. Render at read-time.
2. turkish_suffix.go implements vowel-harmony locative -de/-da/-te/-ta for province names; proper-noun apostrophe rule (İzmir'de, Ankara'da).
3. Fallback: unclassifiable names get the most common suffix form + slog.Warn, never panic.

Testing checklist:
- Unit test table ≥15 real Turkish province names covering all four locative forms
- Unit test: proper-noun apostrophe applied correctly
- Unit test: unrecognized input hits logged fallback
```

```
CURSOR IMPLEMENTATION PROMPT: Push Worker, Reactions, Referral Credits & Achievement Share (covers 04.4, 04.5, 04.7, 04.8)

Context: Engagement fan-out plus social proof sharing.

Target files: /backend/internal/notifications/push.go, /backend/internal/social/reactions.go, /backend/internal/social/referral.go, /backend/internal/share/achievements.go, /migrations/0015_notifications_reactions_referral_share.sql, /frontend/app/share/[achievementId]/

Requirements:
1. Push worker drains notif_queue to FCM/APNs, per-user rate limits (e.g. max 1 province_lead_threatened per il per 30 minutes; derby announces once per derby per user).
2. event_reactions unique (event_id, user_id); upsertable emoji.
3. Referral codes: on valid redemption GrantCredits to both sides via ledger reason referral; fraud checks on same device fingerprint; flag suspicious redemptions to flagged_users rather than granting immediately.
4. Achievements: on milestones (first_support, derby_mvp, top_n_province_supporter, top_n_tribe_supporter, season_badge, streak_n) create shareable achievement records with public id. GET /share/{id} returns OG meta tags + card image (or server-rendered OG image route). Client exposes Web Share API / copy-link for Instagram/Twitter/WhatsApp. Deep link opens the app map focused on the relevant province when installed.

Testing checklist:
- Integration test: duplicate threatened-lead events within window produce one push
- Unit test: reaction upsert changes emoji, no duplicate row
- Integration test: same-device referral flagged and credits withheld
- Integration test: achievement share page returns non-empty og:title and og:image
```

====================================================================
SPRINT 8 — LEADERBOARDS & PROGRESSION (Epic 05)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Global, Tribe, Province & Derby Leaderboards (covers 05.1–05.5)

Context: Primary social-proof surfaces. Identical ZSET pattern, multiple scopes.

Target files: /backend/internal/leaderboard/zset.go, /backend/internal/leaderboard/handlers.go

Requirements:
1. Reusable LeaderboardStore parameterized by scope key:
   - lb:global:supporters
   - lb:tribe:{tribe_id}:supporters
   - lb:province:{il_code}:supporters
   - lb:derby:{derby_id}:supporters (optional per-user within event)
   Plus read API for tribe standings per province from tribe_province_scores / province_control_summary (05.4) and derby host/guest totals (05.5).
2. Score updates subscribe to support_applied (and derby resolve) events — do not scatter ZINCRBY inside unrelated handlers.
3. Restricted-mode users written to ZSETs for internal tracking but excluded from public GET responses at read-time.
4. Rank lookup via ZREVRANK, not full scan.

Testing checklist:
- Integration test: one support increments global, tribe, and province supporter boards in one update path
- Integration test: restricted-mode user present in Redis, absent from public API
- Performance test: rank lookup on a large ZSET is sub-millisecond at Redis; document measured latency
```

```
CURSOR IMPLEMENTATION PROMPT: Seasonal Reset & Archival (covers 05.6)

Target files: /backend/cmd/worker-season/main.go, /migrations/0016_season_archive.sql

Requirements:
1. Snapshot all supporter ZSET scopes into season_archive Postgres rows, then DEL live keys — strict order so crash mid-job never loses data.
2. --dry-run logs intended archive/reset without mutations.

Testing checklist:
- Integration test: kill after archive insert before DEL, re-run does not duplicate archive rows
- Integration test: --dry-run leaves Redis and Postgres unmodified
```

```
CURSOR IMPLEMENTATION PROMPT: XP, Ranks & Quests Retargeted to Support/Derby (covers 05.7, 05.8)

Target files: /backend/internal/progression/xp.go, /backend/internal/progression/quests.go, /migrations/0017_progression.sql

Requirements:
1. rank_tiers config table for XP thresholds and badge names — content-editable without redeploy.
2. quest_templates with criteria JSONB (e.g. type support_count, target 3, scope province; type derby_support, target 1; type streak, target 5). Generic evaluator, not one Go function per quest.
3. Progress via domain events (support_applied, derby_resolved, streak_updated), no polling loop.

Testing checklist:
- Unit test: XP threshold boundary lookup
- Unit test: support_count quest completes after N events
- Integration test: new quest template row is evaluable without code change
```

====================================================================
SPRINT 9 — TRUST, SAFETY & MODERATION (Epic 08)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Admin Moderation Dashboard & Audit Log (covers 08.1, 08.6)

Target files: /frontend/app/(admin)/moderation/, /backend/internal/admin/moderation_api.go, /migrations/0018_audit_log.sql

Requirements:
1. Admin panel lists user_reports and flagged_users with status/type filters. Admin role middleware distinct from regular auth.
2. Every moderator action and admin derby force-resolve writes an immutable audit_log row. No UPDATE/DELETE endpoints for audit_log.

Testing checklist:
- Integration test: non-admin admin-route access → 403
- Integration test: each moderator action → exactly one audit_log row
- Static check: no route can UPDATE or DELETE audit_log
```

```
CURSOR IMPLEMENTATION PROMPT: Ban, Shadow-Ban on Support & Spend Anomaly Flags (covers 08.2, 08.4)

Target files: /backend/internal/moderation/actions.go

Requirements:
1. Ban: users.status=banned; auth middleware rejects earliest.
2. Shadow-ban: users.status=shadow_banned. Support API returns 200-shaped success to the client, but must not debit credits in a user-visible inconsistent way — preferred: accept request, no-op score mutation and no ledger spend (or immediately compensating grant) so balance appears unchanged and tribe_province_scores untouched. Document the chosen inert behavior; never tip off via a distinct error code.
3. Shadow-banned users excluded from leaderboard writes and tribe control aggregation.
4. Spend-anomaly detector flags sudden bursts (e.g. N supports or credit grants in M minutes) into flagged_users for review.

Testing checklist:
- Integration test: banned user any authed request → 403
- Integration test: shadow-banned support returns success-shaped response with zero tribe_province_scores delta and unchanged balance
- Integration test: shadow-banned supports never appear on public leaderboards
```

```
CURSOR IMPLEMENTATION PROMPT: Turkish Profanity Hardening & Appeals (covers 08.3, 08.5)

Target files: /backend/internal/moderation/classifier.go, /backend/internal/moderation/appeals.go, /migrations/0019_appeals.sql

Requirements:
1. ContentClassifier interface with wordlist fast-path then ML fallback for ambiguous tribe chat/DM content.
2. Document sync vs async call sites.
3. POST /v1/appeals for banned/flagged/shadow-banned users; resolution writes to shared audit_log.

Testing checklist:
- Unit test: wordlist hit never calls classifier
- Integration test: shadow-banned user appeal appears in moderator queue
- Integration test: appeal resolution writes audit_log
```

====================================================================
SPRINT 10 — LOCALIZATION & PLATFORM POLISH (Epic 09)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: i18n Framework & Turkish Grammar Rollout (covers 09.1, 09.2, 09.3)

Target files: /frontend/i18n/, /frontend/lib/dateFormat.ts, reuse /backend/internal/i18n/turkish_suffix.go from Sprint 7

Requirements:
1. next-intl (or equivalent) with tr and en bundles. No string concatenation for interpolated user-facing Turkish. Flag earlier violations as follow-ups rather than silent drive-by fixes outside scope.
2. dateFormat.ts centralizes DD.MM.YYYY + 24h via Intl.DateTimeFormat locale tr-TR.
3. Place-name strings in feed/UI use backend-rendered suffix strings from Sprint 7.

Testing checklist:
- Static check: no template-literal concatenation for interpolated Turkish UI copy
- Unit test: dateFormat matches DD.MM.YYYY, HH:mm for a fixed timestamp
- Manual QA: locale tr shows no residual English on core screens
```

```
CURSOR IMPLEMENTATION PROMPT: Maplibre Turkish Glyphs & Low-End Choropleth Perf Mode (covers 09.4, 09.5)

Target files: /frontend/components/ProvinceMap.tsx, /frontend/lib/performanceMode.ts

Requirements:
1. Confirm Maplibre style font stack covers Turkish diacritics; document verification.
2. performanceMode.ts (deviceMemory heuristic + settings toggle) reduces choropleth detail / animation without blocking support spend.

Testing checklist:
- Manual QA: Turkish province labels render at multiple zooms
- Unit test: low-memory profile enables perf mode
- Integration test: perf mode still allows province select + support
```

====================================================================
SPRINT 11 — MONETIZATION (Epic 06)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Credit Pack IAP & Optional Cosmetics/Battle Pass (covers 06.1, 06.2)

Target files: /backend/internal/monetization/iap.go, /backend/internal/monetization/battlepass.go, /migrations/0020_monetization.sql

Requirements:
1. Server-side Apple/Google receipt validation for every purchase. Never trust client-reported success to GrantCredits.
2. Credit packs map provider product IDs → credit amounts in a config table. Grant via ledger reason purchase with idempotency_key = provider_transaction_id.
3. Optional cosmetics/battle-pass may reuse XP events from Sprint 8; must not be required to support provinces.
4. Duplicate webhook/callback for the same transaction ID grants credits exactly once (unique constraint).

Testing checklist:
- Integration test: forged client purchase success without valid receipt rejected
- Integration test: duplicate webhook grants once
- Unit test: product ID maps to expected credit amount
```

```
CURSOR IMPLEMENTATION PROMPT: Turkish Payment Methods — Papara / Iyzico / BKM Express Isolated Service (covers 06.3)

Context: Hard PCI-scope boundary — separate deployable.

Target files: /services/payments/ (separate Go module), /services/payments/cmd/main.go, /services/payments/internal/providers/

Requirements:
1. Standalone deployable with isolated DB schema/process/pool from the main game API.
2. PaymentProvider interface (Charge, Refund, VerifyWebhookSignature) for Iyzico, Papara, BKM Express. Webhook signature verification mandatory.
3. No raw card data stored; hosted/tokenized checkout only.
4. Emits internal event consumed by main API to GrantCredits; payments service has zero knowledge of tribe/support semantics.

Testing checklist:
- Security test: invalid webhook signature rejected
- Static check: no PAN/CVV fields in schema or logs
- Integration test: successful charge triggers credit grant in main API without payments service writing game tables
```

```
CURSOR IMPLEMENTATION PROMPT: KDV Invoicing & Refund/Chargeback (covers 06.4, 06.5)

Target files: /backend/internal/monetization/invoicing.go, /backend/internal/monetization/refunds.go, /migrations/0021_invoices.sql

Requirements:
1. Every completed purchase writes invoices with KDV net/tax/gross snapshotted at purchase time.
2. Refunds (admin/support gated): reverse unspent credits via ledger where balance allows; call PaymentProvider.Refund on the payments service. Do not claw back already-spent support scores.
3. Chargeback webhooks flag the account into the moderation queue; do not auto-ban.

Testing checklist:
- Unit test: invoice snapshot unaffected by later KDV rate config change
- Integration test: refund calls payments service, not local payment-state mutation
- Integration test: chargeback creates moderation-queue entry, not automatic ban
```

====================================================================
SPRINT 12 — ANALYTICS & BI (Epic 10)
====================================================================

```
CURSOR IMPLEMENTATION PROMPT: Cohort/Funnel Dashboards & Province Support Heatmap (covers 10.1, 10.2, 10.3)

Target files: /backend/internal/analytics/aggregates.go, /frontend/app/(admin)/analytics/

Requirements:
1. Dashboard queries only aggregated/anonymized data — never join raw user_id/PII in dashboard-facing SQL.
2. Funnel stages: install → consent/ToS → join tribe → first support → D7, computed by nightly batch jobs.
3. Heatmap reuses province_control_summary / support aggregates by il, not raw per-user ledger scans.

Testing checklist:
- Static check: no analytics dashboard query selects raw user_id or PII
- Integration test: funnel batch idempotent for the same day
- Integration test: heatmap latency flat vs raw event volume (reads summary tables)
```

```
CURSOR IMPLEMENTATION PROMPT: Observability Pipeline (covers 10.4)

Target files: /backend/internal/observability/, docker-compose.yml (extend with log aggregator)

Requirements:
1. Consistent slog schema across API, payments service, and workers (service, request_id, level, msg, contextual fields).
2. Aggregator (e.g. Loki) ingests all services. Dashboard: error-rate, p50/p95/p99 latency per route group, Redis/Postgres pool saturation, reusing Sprint 6 breaker metrics.

Testing checklist:
- Integration test: request_id traces from API into async workers (erasure, notifications)
- Manual check: induced circuit-breaker trip surfaces as a visible alert
```

====================================================================
OUT OF SCOPE / DEFERRED
====================================================================

01.9 (no TCKN collection) is an architectural guardrail, not a code deliverable. Enforce via code review checklist, not a prompt.

03.8 (cross-tribe alliances) is flagged V2. Revisit after tribes + derbies are stable in production.

GPS conquest mechanics (tile claim/contest/decay, path visualization, proximity radar, GPS anti-spoof, supply lines) and user-created clans/clan wars from the original catalog are superseded by credit-based province support, fixed admin-managed tribes, and derby events. Do not reintroduce them in Sprint 2+ prompts.

Sprint 0–1 prompts above are frozen as implemented; newer prompts must not require continuous GPS for the support loop even though Sprint 1 still contains location-consent language.
