# USE CASE CATALOG — Türkiye Social Map-Conquest Game

**Document Type:** Master Requirements / Epic Decomposition Matrix
**Status:** Pre-Sprint 0 — Baseline for backlog grooming
**Stack Reference:** Go (backend) · PostgreSQL/PostGIS (geospatial) · Next.js + Maplibre GL JS (client) · Redis (real-time/cache)

This catalog is the upstream artifact from which individual Cursor Implementation Prompts will be generated per sprint. Each use case below is tagged with an **Epic ID** for backlog traceability. When you're ready to build any single use case, request it by ID and you'll get the full Technical Blueprint + Cursor Prompt Block.

---

## EPIC 01 — Identity, Onboarding & KVKK Consent

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 01.1 | Phone-number OTP registration (Turkish carriers: Turkcell/Vodafone TR/Türk Telekom prefixes) | New User | SMS provider fallback chain required for deliverability |
| 01.2 | KVKK Aydınlatma Metni (Disclosure Text) consent gate — blocking modal before any location permission request | New User | Must be logged with timestamp + consent version hash |
| 01.3 | Açık Rıza (Explicit Consent) for continuous location tracking, separate from base ToS consent | New User | KVKK requires granular, revocable, purpose-specific consent |
| 01.4 | Data residency disclosure banner (server region: TR or EU) | New User | Legal requirement to disclose cross-border transfer if applicable |
| 01.5 | Consent withdrawal flow — user revokes location consent mid-session | Active User | Must immediately stop location writes, anonymize historical path data within SLA |
| 01.6 | Right to erasure (KVKK Art. 7) — full account + territory + path data deletion request | Active User | Async job; must cascade across Postgres, Redis, object storage, analytics warehouse |
| 01.7 | Underage user detection & restricted mode (social features disabled, no public leaderboard exposure) | New User | Age gate at registration |
| 01.8 | Social login (Google/Apple) merge-with-existing-phone-account flow | New/Existing User | Conflict resolution UX for duplicate identity |
| 01.9 | Turkish national ID / TCKN — explicitly OUT of scope, never collected | N/A | Guardrail note for architecture reviews |
| 01.10 | Username validation respecting Turkish alphabet (İ/ı/Ğ/ğ/Ş/ş/Ç/ç/Ö/ö/Ü/ü) and casing bug avoidance | New User | Must NOT use `strings.ToLower/ToUpper` naively in Go; needs `golang.org/x/text/cases` with `tr` tag |

---

## EPIC 02 — Core Conquest Loop (Geospatial)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 02.1 | Claim a map tile/hex by physically entering its geofence (PostGIS `ST_Contains`) | Player | GPS accuracy threshold enforcement (reject fixes >50m error) |
| 02.2 | Contest an enemy-held tile — timed capture bar requiring dwell time in zone | Player | Redis-backed real-time contest state, TTL-based |
| 02.3 | Tile decay — unvisited territory reverts to neutral after N days | System (cron) | Batch job via Go worker pool, PostGIS spatial index scan |
| 02.4 | District-level aggregation — visualize control % per one of Türkiye's 81 ils / ilçeler | Player | Requires canonical PostGIS boundary dataset for TR admin boundaries |
| 02.5 | Multi-tile "supply line" mechanic — connected territory bonus scoring | System | Graph traversal on adjacency, precomputed in Postgres or computed via Go service |
| 02.6 | Real-time "who's near me" radar (opt-in) | Player | Redis GEOADD/GEORADIUS for live proximity, KVKK anonymization on display (no raw coords to other users) |
| 02.7 | Anti-spoofing / GPS-jump detection (teleport heuristics, speed-impossible movement) | System | Server-side velocity check between consecutive location writes |
| 02.8 | Indoor/tunnel GPS-loss grace period (don't strip territory due to signal loss) | System | Debounce logic with last-known-good fix |
| 02.9 | Historic path visualization for a player's own conquest trail | Player | Must respect Art. 01.3/01.6 — anonymized or deletable on request |
| 02.10 | Neutral zone rules around sensitive locations (military, schools) — non-claimable geofences | System | Legal/safety exclusion polygons, seeded dataset |

---

## EPIC 03 — Guilds / Clans (Social Structures)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 03.1 | Create a clan (Turkish name validation, profanity filter tuned for Turkish slang/leetspeak) | Player | Needs Turkish profanity wordlist, not just English |
| 03.2 | Invite/join/kick clan members | Clan Leader/Member | Role-based permission matrix |
| 03.3 | Clan territory pooling — aggregate score from all members' held tiles | System | Materialized view or Redis ZSET aggregation |
| 03.4 | Clan war — timed event where two clans compete for a district | Clan Leader | State machine: scheduled → active → resolved |
| 03.5 | Clan chat (text) | Clan Member | Real-time via WebSocket/Redis Pub-Sub, needs profanity/abuse moderation hook |
| 03.6 | Clan disbandment & territory release-to-neutral | Clan Leader | Cascading cleanup job |
| 03.7 | Cross-clan alliance / non-aggression pact mechanic | Clan Leader | Optional — flag as V2 |

---

## EPIC 04 — Social & Engagement Layer

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 04.1 | Friend requests / friend list | Player | |
| 04.2 | Direct messaging (1:1) | Player | Abuse-report pipeline required |
| 04.3 | Activity feed ("Ahmet, Kadıköy'ü ele geçirdi") — localized notification strings | Player | Needs i18n string templates with correct Turkish grammar (agglutinative suffix handling — can't hardcode string concatenation) |
| 04.4 | Push notification — "your territory is under attack" | System → Player | Redis-queued fan-out, rate-limited per user |
| 04.5 | Emoji/sticker reactions on conquest events | Player | |
| 04.6 | Block/mute/report user | Player | Feeds moderation queue (Epic 08) |
| 04.7 | Referral system (invite friend, both get in-game currency) | Player | Fraud check: same-device/same-GPS referral abuse detection |

---

## EPIC 05 — Leaderboards & Progression

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 05.1 | Global leaderboard (Redis ZSET, top 100) | Player | Real-time rank lookup O(log N) |
| 05.2 | District/city leaderboard (per-il, per-ilçe) | Player | Sharded ZSET keys per region |
| 05.3 | Clan leaderboard | Player | |
| 05.4 | Seasonal reset with archival to Postgres (cold storage of past season standings) | System | Cron job, must not block live ZSET writes |
| 05.5 | XP/leveling curve & rank badges (Turkish military/Ottoman-themed rank names, TBD by design) | Player | Content table, not hardcoded in Go |
| 05.6 | Daily/weekly quests (e.g., "3 ilçe'de tile fethet") | Player | Quest engine state machine |

---

## EPIC 06 — Monetization

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 06.1 | In-app purchase — cosmetic tile skins / clan banners | Player | Apple/Google IAP receipt validation server-side |
| 06.2 | Battle-pass / season pass | Player | |
| 06.3 | Turkish payment method support (Papara, Iyzico, BKM Express) if web/direct billing offered | Player | PCI scope isolation — payment service must be separate Go microservice |
| 06.4 | KDV (Turkish VAT) invoice generation for purchases | System | Legal/finance requirement |
| 06.5 | Refund / chargeback handling flow | Support Agent | |

---

## EPIC 07 — Real-Time Infrastructure & Scale

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 07.1 | Location ingestion pipeline sized for millions of concurrent pings | System | Go worker pool + batched Postgres writes, Redis as write-behind buffer |
| 07.2 | WebSocket connection manager for live map updates in-viewport | System | Horizontal scaling via Redis Pub-Sub fan-out across Go instances |
| 07.3 | Geospatial query caching (tile ownership lookups) | System | Redis cache-aside pattern in front of PostGIS |
| 07.4 | Rate limiting per user (prevent GPS-spam claiming) | System | Redis token bucket |
| 07.5 | Database connection pooling tuned for read-heavy map queries vs write-heavy location ingestion | System | Separate pgbouncer pools recommended |
| 07.6 | Regional read replicas (Istanbul/Ankara edge latency optimization) | System | Infra-level, informs PostGIS replication strategy |
| 07.7 | Graceful degradation — map read-only mode if write path (Postgres primary) degrades | System | Circuit breaker pattern in Go services |

---

## EPIC 08 — Trust, Safety & Moderation

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 08.1 | Admin dashboard — review reported users/messages | Moderator | Internal Next.js admin panel |
| 08.2 | Automated GPS-spoofing ban/flag pipeline | System | Ties to 02.7 |
| 08.3 | Profanity/hate-speech filter tuned for Turkish (including transliterated/leetspeak variants) | System | Needs curated wordlist + ML classifier fallback |
| 08.4 | Shadow-ban capability (spoofers keep playing but claims don't register) | Moderator | Anti-cheat UX pattern to avoid tipping off cheaters |
| 08.5 | Appeal flow for banned users | Player | |
| 08.6 | Audit log of all moderator actions (KVKK accountability requirement) | System | Immutable append-only log table |

---

## EPIC 09 — Localization & Platform Polish

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 09.1 | Full Turkish/English locale toggle | Player | i18n framework (next-intl or similar), not string concatenation |
| 09.2 | Turkish date/time formatting (DD.MM.YYYY, 24h clock) | System | |
| 09.3 | Correct Turkish plural/suffix grammar in dynamic strings (place names take different suffixes: `Kadıköy'de`, `Ankara'da`) | System | Needs a small suffix-resolution helper, not naive string templates |
| 09.4 | Maplibre GL JS style localization — Turkish place labels rendering correctly (diacritics) | Player | Font/glyph coverage check for Turkish characters |
| 09.5 | Low-end Android device performance mode (reduced tile render density) | Player | Large addressable market on budget Android in TR |

---

## EPIC 10 — Analytics & Business Intelligence

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 10.1 | Cohort retention dashboard (D1/D7/D30) | Internal/Product | Must use anonymized/aggregated data per KVKK minimization principle |
| 10.2 | Heatmap of conquest activity by region for growth targeting | Internal/Product | Aggregate only — no individual path exposure |
| 10.3 | Funnel analysis: install → consent → first claim → D7 retention | Internal/Product | |
| 10.4 | Server health/observability dashboard (Go `slog` structured logs → aggregator) | Internal/SRE | |

---

## NEXT STEP

Pick any single ID (e.g., `02.1`, `01.3`, `07.1`) and I'll produce the full **Technical Blueprint + Cursor Implementation Prompt** for it, scoped tight enough to not blow Cursor's context window. Recommend starting with **01.2 → 01.3 → 02.1** in sequence, since consent gating must exist before any location-write code path is generated — building the conquest loop first creates KVKK-compliance rework risk.
