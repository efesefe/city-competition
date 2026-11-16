# Docs index

Project context for future sessions. Update this list when adding a new module or architectural doc.

| Doc | Topic |
| --- | --- |
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
| [skippable-tutorial-flow.md](skippable-tutorial-flow.md) | CC-61: Skippable claim → mid-seed capture → live fight coach |
| [tutorial-capture-no-flip.md](tutorial-capture-no-flip.md) | CC-62: Capture beat completes after 3 confirms without flip |
| [city-sheet-combat-panel.md](city-sheet-combat-panel.md) | CC-26: City sheet owner / lead / real-handle contributors / Attack·Defend |
| [postgres-migration.md](postgres-migration.md) | API SQLite → Postgres (`DATABASE_URL`, migrations, Realtime ledger handoff) |
| [redis-realtime-ops.md](redis-realtime-ops.md) | Redis/`REDIS_URL` for ownership pub/sub, rate limits, alert coalesce hooks |
| [fly-deploy.md](fly-deploy.md) | CC-41: Fly.io `fra` deploy — `web` (API+WS) + `worker` |
| [fly-secrets-health-scale.md](fly-secrets-health-scale.md) | CC-42: env/secrets checklist, `/health` 503 semantics, match-day scale steps |
| [season-scoreboards.md](season-scoreboards.md) | CC-65–67: Season 0 team + player boards (guest browse) |
| [persist-ledger-live-flips.md](persist-ledger-live-flips.md) | CC-35: `FOR UPDATE` spend, boost snapshot cols, strict-lead flips + Redis fan-out |
| [action-cost-tunable.md](action-cost-tunable.md) | CC-31: Admin-tunable action cost band 10–20 (default mid 15) |
| [daily-free-energy.md](daily-free-energy.md) | CC-30: Daily free energy grant (Europe/Istanbul) |
| [midnight-sub-bonus-jobs.md](midnight-sub-bonus-jobs.md) | CC-33: TR midnight free 100 + sub +50 stacked grants |
| [idempotent-spend.md](idempotent-spend.md) | CC-37: concurrent idempotent spend load/smoke tests + HTTP retry/single-flight harden |
| [websocket-city-digest.md](websocket-city-digest.md) | CC-36: guest/player WS subscribe, 81-city ownership+support digest, spend/flip live |
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
| [web-payments.md](web-payments.md) | Web checkout is iyzico-only; Papara/BKM packs deactivated; native IAP unchanged |
| [tribe-emblems.md](tribe-emblems.md) | Original mascot silhouettes on tribe crests (slug-keyed, no official club marks) |
| [tribe-stripes.md](tribe-stripes.md) | Vertical kit-color stripes on held Türkiye map provinces |
| [frontend-docker-build.md](frontend-docker-build.md) | Next `npm run build` in the frontend image; LeaderboardScope typecheck |
