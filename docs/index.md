# Docs index

Project context for future sessions. Update this list when adding a new module or architectural doc.

| Doc | Topic |
| --- | --- |
| [apps-boot-path.md](apps-boot-path.md) | W1: `apps/` sole boot path — README/env/compose/Makefile; API `.env` load; legacy pending delete |
| [expo-fastify-slice.md](expo-fastify-slice.md) | First Expo + Fastify vertical slice (map, auth stub, kabile, spend, flip) |
| [supabase-auth-providers.md](supabase-auth-providers.md) | CC-19: Supabase Auth phone/Google/Apple + Send SMS Hook seam |
| [netgsm-otp-sms-hook.md](netgsm-otp-sms-hook.md) | CC-20: Netgsm OTP send from `POST /v1/auth/hooks/send-sms` |
| [phone-verify-before-play.md](phone-verify-before-play.md) | CC-21: Phone verify wall before spend + Kabile pick |
| [gate-guest-actions.md](gate-guest-actions.md) | CC-23: Guests browse-only; other actions → login |
| [lost-sim-phone-rebind.md](lost-sim-phone-rebind.md) | CC-22: Season 0 support-assisted lost-SIM phone rebind (progress preserved) |
| [post-verify-kabile-picker.md](post-verify-kabile-picker.md) | CC-63: Kabile pick after phone verify; Big 4 first |
| [team-aliases.md](team-aliases.md) | Süper Lig → Kabile `public_alias` roster (picker source) |
| [confirm-spend-boost-ui.md](confirm-spend-boost-ui.md) | CC-27: always-confirm spend + boosted support UI (personal/team display; purchase stub) |
| [match-day-map-chrome.md](match-day-map-chrome.md) | CC-28: match-day thin banner + map city spotlight (fixture stub until Admin ops) |
| [soft-launch-chrome-hygiene.md](soft-launch-chrome-hygiene.md) | W2: hide Admin from guest/player bar; gate shop stub CTAs; dark `userInterfaceStyle`; soften auth stub labels |
| [map-spotlight-pulse-perf.md](map-spotlight-pulse-perf.md) | W3 partial: spotlight glow via ref/local layer — no 81-path rAF reconcile |
| [skippable-tutorial-flow.md](skippable-tutorial-flow.md) | CC-61: Skippable claim → mid-seed capture → live fight coach |
| [tutorial-capture-no-flip.md](tutorial-capture-no-flip.md) | CC-62: Capture beat completes after 3 confirms without flip |
| [city-sheet-combat-panel.md](city-sheet-combat-panel.md) | CC-26: City sheet owner / lead / real-handle contributors / Attack·Defend |
| [postgres-migration.md](postgres-migration.md) | API SQLite → Postgres (`DATABASE_URL`, migrations, Realtime ledger handoff) |
| [redis-realtime-ops.md](redis-realtime-ops.md) | Redis/`REDIS_URL` for ownership pub/sub, rate limits, alert coalesce hooks |
| [fly-deploy.md](fly-deploy.md) | CC-41: Fly.io `fra` deploy — `web` (API+WS) + `worker` |
| [fly-secrets-health-scale.md](fly-secrets-health-scale.md) | CC-42: env/secrets checklist, `/health` 503 semantics, match-day scale steps |
| [season-scoreboards.md](season-scoreboards.md) | CC-65–67: Season 0 team + player boards (guest browse) |
| [attack-alert-pipeline.md](attack-alert-pipeline.md) | CC-57: owned + 24h-spend attack alerts, 5-min coalesce, push + in-app |
| [persist-ledger-live-flips.md](persist-ledger-live-flips.md) | CC-35: `FOR UPDATE` spend, boost snapshot cols, strict-lead flips + Redis fan-out |
| [action-cost-tunable.md](action-cost-tunable.md) | CC-31: Admin-tunable action cost band 10–20 (default mid 15) |
| [daily-free-energy.md](daily-free-energy.md) | CC-30: Daily free energy grant (Europe/Istanbul) |
| [midnight-sub-bonus-jobs.md](midnight-sub-bonus-jobs.md) | CC-33: TR midnight free 100 + sub +50 stacked grants |
| [personal-boost-logic.md](personal-boost-logic.md) | CC-32: personal +50%/1h with real expiry; personal×team stack on spend; purchase stub |
| [admin-match-day-schedule.md](admin-match-day-schedule.md) | CC-50/51: admin schedule team +25% windows + derby timed city wars |
| [admin-ops-mvp.md](admin-ops-mvp.md) | CC-52…55: OTP-gated admin writes, team-add triage, seed load, ops metrics |
| [idempotent-spend.md](idempotent-spend.md) | CC-37: concurrent idempotent spend load/smoke tests + HTTP retry/single-flight harden |
| [websocket-city-digest.md](websocket-city-digest.md) | CC-36: guest/player WS subscribe, 81-city ownership+support digest, spend/flip live |
| [ws-delta-support-fanout.md](ws-delta-support-fanout.md) | W3: delta-only `support` fan-out; full digest on subscribe/flip |
| [turkiye-map-web-svg.md](turkiye-map-web-svg.md) | Expo web fix: Path `onPress` → WebShape unknown event handlers |
| [turkiye-map-harden.md](turkiye-map-harden.md) | Season 0 Wave 1: 81-path memo, taps, atlas guard, digest/sheet loading-error-empty |
| [presence.md](presence.md) | Redis TTL presence: online count (`SCARD`), per-tribe online members, map chip + chat dots |
| [conquest-ui.md](conquest-ui.md) | Capture toast, ranked supporter badge, conquest log unread, own-flip celebration |
| [derbi-map-urgency.md](derbi-map-urgency.md) | Derby city fill intensity, pulsing glow, countdown chip on the Türkiye map |
| [activity-ticker.md](activity-ticker.md) | Nationwide map ticker: activity-feed HTTP + WS, locative snippets, tap-to-recenter |
| [momentum-map-indicators.md](momentum-map-indicators.md) | Momentum/streak crest badges and live contest-tension ring on the Türkiye map |
| [ambient-layer.md](ambient-layer.md) | Decorative sea-creature overlay and Istanbul day/night tint on the Türkiye map |
| [credit-flow.md](credit-flow.md) | Coin burst from the CreditHeader balance to the supported city on spend |
| [threat-alert-ui.md](threat-alert-ui.md) | Rival-threat push deep links, in-map ThreatAlertBanner, Defend → credit input |
| [flip-gain-loss-alerts.md](flip-gain-loss-alerts.md) | CC-58: ownership flip gain/loss push + in-app for tribe members |
| [static-share-cards.md](static-share-cards.md) | CC-59: logged-in support/accomplishment static share cards (no guest map share) |
| [entitlement-grants.md](entitlement-grants.md) | CC-47: unified `entitlement_grants` for store IAP + iyzico → paid_energy / sub_active |
| [shop-skus.md](shop-skus.md) | CC-48: shop UI wired to real iOS/Android/web SKUs |
| [web-payments.md](web-payments.md) | Web checkout is iyzico-only; Papara/BKM packs deactivated; native IAP unchanged |
| [web-checkout-iyzico.md](web-checkout-iyzico.md) | CC-46: Expo web packs + sub via iyzico CF/3DS; mock + sandbox; energy grants |
| [ios-iap-revenuecat.md](ios-iap-revenuecat.md) | CC-44: App Store IAP via RevenueCat; shared `iap_grants` / `/v1/iap/sync` entitlement hook |
| [android-play-billing-revenuecat.md](android-play-billing-revenuecat.md) | CC-45: Google Play Billing via RevenueCat; same entitlement hook as iOS |
| [tribe-emblems.md](tribe-emblems.md) | Original mascot silhouettes on tribe crests (slug-keyed, no official club marks) |
| [tribe-stripes.md](tribe-stripes.md) | Vertical kit-color stripes on held Türkiye map provinces |
| [frontend-docker-build.md](frontend-docker-build.md) | Next `npm run build` in the frontend image; LeaderboardScope typecheck |
| [client-merge-syntax-fix.md](client-merge-syntax-fix.md) | Expo web bundling: double-comma merge artifact in `lib/api.ts` `adminMetrics` |

