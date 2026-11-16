# iOS App Store IAP via RevenueCat (CC-44)

**Stack:** Expo client (`apps/client`) + Fastify API (`apps/api`).  
**Channel lock:** native digital goods = App Store IAP; RevenueCat = entitlement / restore / webhook layer; server remains authoritative (economy-sheet pack amounts 200/600/1500 + sub +50/day; third-party-providers payment split).

## What shipped

| Surface | Behavior |
|---------|----------|
| Shop UI | Packs **200 / 600 / 1500** + monthly sub; Restore |
| Client | `react-native-purchases` configured on **iOS only** when `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` is set; `logIn(appUserId)` ties RC → our user id |
| Sync | `POST /v1/iap/sync` after purchase/restore (idempotent) |
| Webhook | `POST /v1/webhooks/revenuecat` with `Authorization` = `REVENUECAT_WEBHOOK_AUTHORIZATION` |
| Stub | `ALLOW_IAP_STUB=true` → `POST /v1/iap/stub` for local QA without StoreKit |
| Ledger | `iap_grants` + `users.sub_active` / paid_energy credits |

Android Play Billing is a sibling leaf ([android-play-billing-revenuecat.md](android-play-billing-revenuecat.md), CC-45) — **same** entitlement apply / sync / webhook routes; Play product IDs via `RC_ANDROID_*`.

## Env matrix

### API (`apps/api`)

| Variable | Required | Notes |
|----------|----------|--------|
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | Prod webhook | Exact dashboard Authorization value |
| `RC_IOS_PRODUCT_PACK_SMALL` | Optional | Default `cc_ios_pack_small_200` |
| `RC_IOS_PRODUCT_PACK_MEDIUM` | Optional | Default `cc_ios_pack_medium_600` |
| `RC_IOS_PRODUCT_PACK_LARGE` | Optional | Default `cc_ios_pack_large_1500` |
| `RC_IOS_PRODUCT_SUB_MONTHLY` | Optional | Default `cc_ios_sub_monthly` |
| `RC_ENTITLEMENT_SUB` | Optional | Default `monthly_sub` |
| `ALLOW_IAP_STUB` | Dev | `true` enables stub grants |
| `REVENUECAT_SECRET_API_KEY` | Optional | Reserved; never ship to Expo |

### Expo (`apps/client`)

| Variable | Required | Notes |
|----------|----------|--------|
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | iOS builds | Public `appl_…` SDK key |
| `EXPO_PUBLIC_RC_IOS_PRODUCT_PACK_*` | Optional | Must match API `RC_IOS_*` |
| `EXPO_PUBLIC_RC_IOS_PRODUCT_SUB_MONTHLY` | Optional | Same |
| `EXPO_PUBLIC_RC_ENTITLEMENT_SUB` | Optional | Same as `RC_ENTITLEMENT_SUB` |

## Entitlement rules

1. **Pack** → `paid_energy +=` locked amount (200 / 600 / 1500). Idempotent on `provider_transaction_id`.
2. **Subscription** → `users.sub_active = true` (no immediate energy). Daily **+50** is the midnight job (CC-33).
3. **EXPIRATION / CANCELLATION** (sub) → `sub_active = false`. Pack refunds are not clawed back in Season 0.
4. Client never trusts store success alone — sync/webhook apply grants.

## RevenueCat dashboard checklist

1. Create App Store app + products matching env product IDs (consumable packs + auto-renewable monthly).
2. Entitlement `monthly_sub` (or your `RC_ENTITLEMENT_SUB`) attached to the sub product.
3. Webhook URL: `https://<api-host>/v1/webhooks/revenuecat` + Authorization secret → Fly secret `REVENUECAT_WEBHOOK_AUTHORIZATION`.
4. Use the same app user id as our `users.id` (`Purchases.logIn`).

## How to test

```bash
cd apps/api && npm test
cd apps/api && npm run typecheck
```

Manual stub (no Apple account):

```bash
# API
ALLOW_IAP_STUB=true npm run dev

# After login:
curl -X POST http://localhost:8787/v1/iap/stub \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"productId":"cc_ios_pack_small_200"}'
```

Webhook dry-run:

```bash
curl -X POST http://localhost:8787/v1/webhooks/revenuecat \
  -H "Authorization: $REVENUECAT_WEBHOOK_AUTHORIZATION" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"NON_RENEWING_PURCHASE","id":"evt1","app_user_id":"<userId>","product_id":"cc_ios_pack_small_200","store":"APP_STORE","transaction_id":"1001"}}'
```

Real StoreKit needs an EAS **development build** (Expo Go uses RevenueCat Preview API Mode — no real charge).

## Out of scope

- Google Play Billing details (see CC-45 doc — shapes shared here)
- iyzico web checkout (separate payments leaf)
- Cross-platform entitlement unify beyond this ledger (CC-47)
- Personal boost IAP SKU
