# Web payments — iyzico only

Web energy packs + monthly subscription go through **iyzico** hosted Checkout Form / **3DS**. Papara and BKM Express are not offered on web.

Native App Store / Google Play IAP is unchanged (store policy) — see CC-44 / CC-45.

## Season 0 slice (`apps/`)

Authoritative path for soft launch is documented in **[web-checkout-iyzico.md](web-checkout-iyzico.md)** (CC-46):

- `POST /v1/payments/iyzico/checkout` → hosted CF or mock 3DS page  
- Callback + webhook → idempotent `paid_energy` / `sub_active` grants  
- Expo web shop at `/shop`

## Legacy Next.js / Go stack

Season 0 web checkout is iyzico-only in `apps/` (no Papara/BKM). Historical `web_purchases` rows may still reference papara or bkm_express; those packs stay `active = false`. The retired Next/Go payments trees were deleted in D1.
