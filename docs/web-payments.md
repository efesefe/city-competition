# Web payments — iyzico only

Web credit top-up goes through **iyzico** hosted checkout. Papara and BKM Express are not offered, not listed in `GET /v1/credit-packs`, and are rejected by `POST /v1/payments/checkout`.

Native App Store / Google Play IAP is unchanged (store policy).

## Why this shape

- The checkout UI used to let the player pick iyzico, Papara, or BKM Express. Product is iyzico-only on web.
- Frontend filtering alone is not enough: a client could still POST `provider: "papara"`. `IsWebProvider` on the main API and the payments-service registry must match.
- Historical `web_purchases` / refunds may still reference papara or bkm_express, so CHECK constraints and pack rows stay; those packs are `active = false`.

## Layers

| Layer | Behavior |
|---|---|
| Frontend | `WEB_PROVIDERS = ["iyzico"]` in [`frontend/lib/iapBridge.ts`](../frontend/lib/iapBridge.ts). Checkout hides the provider picker when only one method remains. |
| Main API | `IsWebProvider` is true only for `iyzico`. `ListPacks` skips papara/bkm rows even if a pack is still marked active. |
| Payments service | Registry in `services/payments/cmd/main.go` registers only iyzico. Papara/BKM implementations remain for unit tests. |
| DB | Migration `0039_iyzico_only_web` sets `credit_packs.active = false` for papara and bkm_express. |

## How to test

```bash
cd frontend && npm test -- lib/packOffers
```

Manual: open `/profile/topup` on web, pick a pack, confirm there is no Papara/BKM choice and Pay starts iyzico checkout.
