# Unified entitlement grants (CC-47)

Store IAP (RevenueCat → App Store / Play Billing) and web iyzico both credit **one** cross-platform balance on the user:

| Field | Pack purchase | Subscription |
| --- | --- | --- |
| `users.paid_energy` | += pack energy (200 / 600 / 1500) | unchanged |
| `users.sub_active` | unchanged | `true` (midnight +50 via CC-33) |

## Ledger

`entitlement_grants` (`apps/api/migrations/017_entitlement_grants.sql`) is the authoritative purchase ledger:

- `channel`: `app_store` | `play_store` | `web`
- `provider`: `revenuecat` | `iyzico`
- Idempotency: unique `(provider, provider_transaction_id)` (+ optional event id)

Apply path: `applyEntitlementGrant` in `apps/api/src/lib/entitlementGrants.ts`.

IAP (#61/#67) and iyzico (#69) leaves own checkout/webhook surfaces; when those merge, their grant wrappers should call this apply path so energy/sub stay unified. Migration backfills from `iap_grants` / `iyzico_grants` when those tables exist.

## Why this shape

- Product rule: purchases on web must show as the same energy/sub on mobile (and vice versa).
- One apply path keeps idempotency and balance math in one place without duplicating full payment stacks in this PR.

## How to test

```bash
cd apps/api && npm test
```

Cross-channel case lives in `src/lib/entitlementGrants.test.ts` (store pack + web pack → single `paid_energy`).
