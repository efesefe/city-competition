# Android Google Play Billing via RevenueCat (CC-45)

**Stack:** Expo client (`apps/client`) + Fastify API (`apps/api`).  
**Channel lock:** native digital goods = Google Play Billing; RevenueCat = entitlement / restore / webhook layer; server remains authoritative.  
**Sibling:** [ios-iap-revenuecat.md](ios-iap-revenuecat.md) (CC-44) — **same** `/v1/iap/sync`, `/v1/webhooks/revenuecat`, and `applyIapGrant` entitlement hook.

## Docs inspected

- Store: `third-party-providers.md`, `economy-sheet.md`, `season-0-tracker.md`
- Repo: `docs/ios-iap-revenuecat.md` (open [PR #61](https://github.com/efesefe/city-competition/pull/61)), `docs/web-payments.md`, `docs/midnight-sub-bonus-jobs.md` (CC-33 `sub_active`)

## What shipped

| Surface | Behavior |
|---------|----------|
| Shop UI | Packs **200 / 600 / 1500** + monthly sub; Restore; picks Android product ids on `Platform.OS === "android"` |
| Client | `react-native-purchases` when `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (or `EXPO_PUBLIC_RC_ANDROID_API_KEY`) is set; `logIn(appUserId)` |
| Sync | `POST /v1/iap/sync` with `platform: "android"` → ledger `store = play_store` |
| Webhook | Same `POST /v1/webhooks/revenuecat`; **PLAY_STORE** events now grant (no longer ignored) |
| Stub | `ALLOW_IAP_STUB=true` → `POST /v1/iap/stub` with `platform: "android"` |
| Ledger | Shared `iap_grants` + `users.sub_active` / `paid_energy` (CC-44 migration `004_iap_revenuecat.sql`) |

## Shared entitlement shapes (coordinate with iOS)

| Piece | Contract |
|-------|----------|
| Apply | `applyIapGrant({ userId, productId, transactionId, store, eventId?, deactivateSub? })` |
| Pack | `kind: "pack"` → `paid_energy +=` 200/600/1500; idempotent on `provider_transaction_id` |
| Sub | `kind: "subscription"` → `sub_active = true` (midnight +50 is CC-33) |
| Expire | Webhook `EXPIRATION` → `sub_active = false` |
| Client sync body | `{ productId, transactionId, platform: "ios" \| "android" }` |
| Auth webhook | `Authorization` = `REVENUECAT_WEBHOOK_AUTHORIZATION` |
| App user id | Our `users.id` via `Purchases.logIn` |

## Env matrix

### API

| Variable | Notes |
|----------|--------|
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | Same secret as iOS |
| `RC_ANDROID_PRODUCT_PACK_SMALL` | Default `cc_android_pack_small_200` |
| `RC_ANDROID_PRODUCT_PACK_MEDIUM` | Default `cc_android_pack_medium_600` |
| `RC_ANDROID_PRODUCT_PACK_LARGE` | Default `cc_android_pack_large_1500` |
| `RC_ANDROID_PRODUCT_SUB_MONTHLY` | Default `cc_android_sub_monthly` |
| `RC_ENTITLEMENT_SUB` | Default `monthly_sub` (shared with iOS) |
| `ALLOW_IAP_STUB` | Dev stub grants |

### Expo

| Variable | Notes |
|----------|--------|
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Public `goog_…` SDK key (alias: `EXPO_PUBLIC_RC_ANDROID_API_KEY`) |
| `EXPO_PUBLIC_RC_ANDROID_PRODUCT_PACK_*` | Must match API `RC_ANDROID_*` |
| `EXPO_PUBLIC_RC_ANDROID_PRODUCT_SUB_MONTHLY` | Same |
| `EXPO_PUBLIC_RC_ENTITLEMENT_SUB` | Same as API |

## How to test

```bash
cd apps/api && npm test
cd apps/api && npm run typecheck
cd apps/client && npx tsc --noEmit
```

Stub Android pack (no Play Console):

```bash
ALLOW_IAP_STUB=true npm run dev   # apps/api
curl -X POST http://localhost:8787/v1/iap/stub \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"productId":"cc_android_pack_small_200","platform":"android"}'
```

Play webhook dry-run:

```bash
curl -X POST http://localhost:8787/v1/webhooks/revenuecat \
  -H "Authorization: $REVENUECAT_WEBHOOK_AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","id":"evt1","app_user_id":"<userId>","product_id":"cc_android_pack_small_200","store":"PLAY_STORE","transaction_id":"GPA.1"}}'
```

Real Play Billing needs an EAS **development build** with the Google Play app linked in RevenueCat.

## Out of scope

- iyzico web checkout
- Unifying cross-channel ledger beyond `iap_grants` (CC-47)
- Personal boost SKU
