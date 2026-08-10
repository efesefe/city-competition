# USE CASE CATALOG — Türkiye Social Map-Support Game

**Document Type:** Master Requirements / Epic Decomposition Matrix
**Status:** Post–Sprint 1 baseline — credit-based province support (GPS conquest superseded)
**Stack Reference:** Go (backend) · PostgreSQL/PostGIS (geospatial boundaries) · Next.js + Maplibre GL JS (client) · Redis (real-time/cache)

This catalog is the upstream artifact from which individual Cursor Implementation Prompts will be generated per sprint. Each use case below is tagged with an **Epic ID** for backlog traceability. When you're ready to build any single use case, request it by ID and you'll get the full Technical Blueprint + Cursor Prompt Block.

**Product model (canonical):** Users join a fixed **tribe** (parody of Türkiye’s most popular football clubs; fiction names only—no trademarks). They buy **credits**, then **support a province (il)** on the map for their tribe. Admins can start **derby** events (host tribe vs guest tribe in a city) that notify members and apply a **2×** support multiplier for that city while active. Continuous GPS / physical presence is **not** required for gameplay.

---

## EPIC 01 — Identity, Onboarding & KVKK Consent

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 01.1 | Phone-number OTP registration (Turkish carriers: Turkcell/Vodafone TR/Türk Telekom prefixes) | New User | SMS provider fallback chain required for deliverability |
| 01.2 | KVKK Aydınlatma Metni (Disclosure Text) consent gate — blocking modal before sensitive data flows | New User | Must be logged with timestamp + consent version hash. Sprint 1 shipped this before any map permission request; core gameplay no longer depends on continuous GPS |
| 01.3 | Açık Rıza (Explicit Consent) for continuous location tracking, separate from base ToS consent | New User | **Legacy from Sprint 1 bootstrap.** Not required for province-support gameplay (map tap / province select only). Retain for compliance if any optional location feature is reintroduced later |
| 01.4 | Data residency disclosure banner (server region: TR or EU) | New User | Legal requirement to disclose cross-border transfer if applicable |
| 01.5 | Consent withdrawal flow — user revokes location consent mid-session | Active User | **Legacy path** if location writes exist; must immediately stop location writes and anonymize historical path data within SLA. Province support does not write continuous GPS trails |
| 01.6 | Right to erasure (KVKK Art. 7) — full account + support history + ledger PII deletion request | Active User | Async job; must cascade across Postgres, Redis, object storage, analytics warehouse |
| 01.7 | Underage user detection & restricted mode (social features disabled, no public leaderboard exposure) | New User | Age gate at registration. Persist `users.restricted_mode`. **Required for later sprints:** Epic 03 tribe chat/DM and Epic 04 social endpoints must use `auth.RequireNotRestricted` (403 `error_restricted_mode`). Epic 05 public leaderboards must filter with `AND restricted_mode = false` (scores may still be tracked internally) |
| 01.8 | Social login (Google/Apple) merge-with-existing-phone-account flow | New/Existing User | Verify ID tokens server-side only. On email/phone match with an existing account return 409 + `merge_token`; complete link only after OTP on the existing phone. Never auto-merge |
| 01.9 | Turkish national ID / TCKN — explicitly OUT of scope, never collected | N/A | Guardrail note for architecture reviews |
| 01.10 | Username validation respecting Turkish alphabet (İ/ı/Ğ/ğ/Ş/ş/Ç/ç/Ö/ö/Ü/ü) and casing bug avoidance | New User | Must NOT use `strings.ToLower/ToUpper` naively in Go; needs `golang.org/x/text/cases` with `tr` tag |

---

## EPIC 02 — Core Support Loop (Province Map)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 02.1 | Select a province (il) on the map and spend credits to support the user’s tribe | Player | Atomic credit debit + tribe×province score increment. No GPS dwell / geofence entry required |
| 02.2 | Effective support with multipliers (default 1×; derby city 2× for competing tribes) | System | Multiplier resolved server-side at spend time; store both credits_spent and effective_support |
| 02.3 | Province control visualization — choropleth / % control per tribe across Türkiye’s 81 ils | Player | Requires canonical PostGIS il boundary dataset; control from aggregated effective support |
| 02.4 | Own support history — list of provinces supported and amounts | Player | Self-only; respects erasure (01.6) |
| 02.5 | Daily support streak tracking | Player | Engagement hook; resets on missed calendar day (TR timezone) |
| 02.6 | Rival-surge / lead-threatened alerts when another tribe closes the gap in a province the user’s tribe leads | System → Player | Rate-limited push/in-app; not GPS “under attack” |
| 02.7 | Rate limiting on support spend endpoints | System | Redis token bucket; prevent credit-spend spam / scripted bursts |
| 02.8 | Insufficient-credits and invalid-province error contracts | Player | Explicit 402/400 codes; never silently no-op a spend |

---

## EPIC 03 — Tribes (Fixed Parody Football Factions)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 03.1 | Seed / list fixed parody tribes (top-10 popular Turkish football clubs as fiction names/colors—no real trademarks) | System / Player | Names and assets in seed data only; never use official club marks |
| 03.2 | Join a tribe (one active tribe per user) | Player | Required before first support |
| 03.3 | Switch tribe with cooldown | Player | Configurable cooldown; prior supports remain attributed to the tribe at time of spend |
| 03.4 | Admin create / update / deactivate tribes | Admin | **Only** admins may add tribes beyond the initial seed |
| 03.5 | Tribe membership roster & public tribe profile | Player | Member count, colors, aggregate control summary |
| 03.6 | Tribe-level province control aggregation | System | Sum effective support per tribe per il; feed map + leaderboards |
| 03.7 | Tribe chat (text) | Tribe Member | Real-time via WebSocket/Redis Pub-Sub; Turkish profanity filter; restricted_mode → 403 |
| 03.8 | Cross-tribe alliances — OUT of scope / V2 | N/A | Deferred |

---

## EPIC 04 — Social & Engagement Layer

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 04.1 | Friend requests / friend list | Player | |
| 04.2 | Direct messaging (1:1) | Player | Abuse-report pipeline required |
| 04.3 | Activity feed (“Ahmet, İzmir’i destekledi”) — localized notification strings | Player | i18n templates with correct Turkish grammar (agglutinative suffix handling) |
| 04.4 | Push notification — derby starting, province lead threatened, streak at risk | System → Player | Redis-queued fan-out, rate-limited per user |
| 04.5 | Emoji/sticker reactions on feed events | Player | |
| 04.6 | Block/mute/report user | Player | Feeds moderation queue (Epic 08) |
| 04.7 | Referral system (invite friend, both get credits) | Player | Fraud check: same-device / abuse patterns; grant via credit ledger |
| 04.8 | Share achievement to socials — deep link + OG share card image | Player | Milestones: first support, derby MVP, top-N province/tribe supporter, season badge, streak |

---

## EPIC 05 — Leaderboards & Progression (Social Proof)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 05.1 | Global top supporters leaderboard (Redis ZSET) | Player | Rank by lifetime (or seasonal) effective support |
| 05.2 | Top supporters of a tribe | Player | Per-tribe ZSET; primary social-proof surface for tribe loyalty |
| 05.3 | Top supporters of a province (il) | Player | Per-province ZSET across all tribes or filtered; shows who is pouring credits into that il |
| 05.4 | Tribe standings per province (which tribe controls / leads each il) | Player | Derived from tribe×province aggregates |
| 05.5 | Derby event standings (host vs guest effective support in the derby city) | Player | Live during active derby; archived on resolve |
| 05.6 | Seasonal reset with archival to Postgres | System | Snapshot ZSETs then reset; dry-run mode required |
| 05.7 | XP/leveling curve & rank badges (content table, not hardcoded) | Player | Progress from support / derby / streak events |
| 05.8 | Daily/weekly quests (e.g. “3 il destekle”, “derby şehrinde destek ver”) | Player | Quest engine state machine on domain events |

---

## EPIC 06 — Monetization (Credits)

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 06.1 | Purchase credit packs (IAP and/or web checkout) | Player | Server-side receipt/webhook validation; append-only credit ledger; idempotent on provider txn ID |
| 06.2 | Optional cosmetics / tribe banners / battle-pass | Player | Secondary to credits; must not be required to play |
| 06.3 | Turkish payment method support (Papara, Iyzico, BKM Express) if web/direct billing offered | Player | PCI scope isolation — payment service must be separate Go microservice |
| 06.4 | KDV (Turkish VAT) invoice generation for purchases | System | Legal/finance requirement; snapshot rate at purchase time |
| 06.5 | Refund / chargeback handling — reverse unspent credits where possible | Support Agent | Chargebacks flag account for review; do not auto-ban |

---

## EPIC 07 — Real-Time Infrastructure & Scale

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 07.1 | WebSocket connection manager for live province-control map updates in-viewport | System | Horizontal scaling via Redis Pub-Sub fan-out across Go instances |
| 07.2 | Geospatial / control caching (province ownership & control % lookups) | System | Redis cache-aside in front of Postgres aggregates |
| 07.3 | Rate limiting per user on support and sensitive write routes | System | Redis token bucket |
| 07.4 | Database connection pooling tuned for read-heavy map queries vs write-heavy support/ledger | System | Separate pools recommended |
| 07.5 | Regional read replicas (Istanbul/Ankara edge latency optimization) | System | Infra-level; informs client routing |
| 07.6 | Graceful degradation — map read-only mode if write path (Postgres primary) degrades | System | Circuit breaker; support spends return 503 |

---

## EPIC 08 — Trust, Safety & Moderation

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 08.1 | Admin dashboard — review reported users/messages | Moderator | Internal Next.js admin panel |
| 08.2 | Abuse / spend-anomaly flag pipeline | System | Unusual credit spend patterns; feeds moderation queue |
| 08.3 | Profanity/hate-speech filter tuned for Turkish (including transliterated/leetspeak variants) | System | Curated wordlist + ML classifier fallback |
| 08.4 | Shadow-ban capability (user’s supports appear to succeed but do not mutate scores/ledger effects) | Moderator | Anti-abuse UX; no tip-off via error codes |
| 08.5 | Appeal flow for banned users | Player | |
| 08.6 | Audit log of all moderator and admin derby actions (KVKK accountability) | System | Immutable append-only log table |

---

## EPIC 09 — Localization & Platform Polish

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 09.1 | Full Turkish/English locale toggle | Player | i18n framework (next-intl or similar), not string concatenation |
| 09.2 | Turkish date/time formatting (DD.MM.YYYY, 24h clock) | System | |
| 09.3 | Correct Turkish plural/suffix grammar in dynamic strings (province names: `İzmir'de`, `Ankara'da`) | System | Suffix-resolution helper, not naive templates |
| 09.4 | Maplibre GL JS style localization — Turkish place labels (diacritics) | Player | Font/glyph coverage for Turkish characters |
| 09.5 | Low-end Android device performance mode (simplified province choropleth) | Player | Large addressable market on budget Android in TR |

---

## EPIC 10 — Analytics & Business Intelligence

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 10.1 | Cohort retention dashboard (D1/D7/D30) | Internal/Product | Anonymized/aggregated data per KVKK minimization |
| 10.2 | Heatmap of support activity by province for growth targeting | Internal/Product | Aggregate only — no individual spend PII |
| 10.3 | Funnel analysis: install → consent/ToS → join tribe → first support → D7 retention | Internal/Product | |
| 10.4 | Server health/observability dashboard (Go `slog` → aggregator) | Internal/SRE | |

---

## EPIC 11 — Derby Events

| ID | Use Case | Actor | Notes |
|---|---|---|---|
| 11.1 | Admin create derby — host tribe, guest tribe, competing city (il), start/end window | Admin | Distinct tribes required; city must be a valid il code |
| 11.2 | Derby state machine: scheduled → active → resolved | System | Cron/ticker driven; admin force-resolve allowed |
| 11.3 | Notify all members of host and guest tribes when derby is created / goes active | System → Player | Push + in-app; reuse notification queue |
| 11.4 | 2× effective support when a competing tribe’s member supports the derby city during active window | System | Applied inside support spend path; non-competing tribes get 1× even in that city |
| 11.5 | Live derby standings and post-event resolution archive | Player / Admin | Persist final host/guest effective totals |

---

## OUT OF SCOPE / SUPERSEDED

- GPS tile claim, dwell contest, path visualization, proximity radar, GPS anti-spoof, and supply-line mechanics from the original conquest catalog are **superseded** by credit-based province support.
- User-created clans/guilds and clan wars are **replaced** by fixed admin-managed tribes + derby events.
- 01.9 (no TCKN) remains an architectural guardrail.
- 03.8 (cross-tribe alliances) is V2.

## NEXT STEP

Pick any single ID (e.g. `02.1`, `03.2`, `11.1`) and produce the full **Technical Blueprint + Cursor Implementation Prompt**, scoped tight enough for Cursor’s context window. Recommended sequence after Sprint 1: **03.1/03.2 → credit wallet → 02.1 → 02.3 → 11.1**, since tribe membership and credits must exist before support spends, and derbies layer on top of the support path.
