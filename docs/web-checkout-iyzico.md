# Web checkout — iyzico Checkout Form / 3DS (CC-46)

Season 0 **web** monetization for energy packs (200 / 600 / 1500) and the monthly subscription (+50/day at 00:00 TR). Hosted **iyzico Checkout Form** with **3DS**; server is authoritative for grants. Native binaries stay on App Store IAP / Google Play Billing (CC-44 / CC-45). Product lock: web = iyzico only.

Legacy Next.js `frontend/` + Go `services/payments` remain in-repo but are **not** this slice. This doc covers `apps/api` + `apps/client`.

## Why this shape

- Product lock: **web = iyzico**; packs one-shot CF; sub = Subscription CF (or mock) → `sub_active`.
- PCI-light: card data stays on iyzico; we only store checkout intent + payment id.
- Idempotent grants on `provider_payment_id` so callback + webhook retries do not double-credit.
- Mock mode when keys are absent so local QA does not need sandbox reachability.

## Flow

```
Shop (web) → POST /v1/payments/iyzico/checkout
           → redirect checkoutUrl (hosted CF or mock 3DS page)
           → iyzico POSTs token to /v1/payments/iyzico/callback
           → retrieve CF / subscription result
           → iyzico_grants + paid_energy | sub_active
           → redirect returnUrl?iyzico=success&checkoutId=…
           → client GET /v1/payments/iyzico/checkout/:id → refresh wallet
```

Webhook `POST /v1/webhooks/iyzico` (signed `X-IYZ-SIGNATURE-V3`) is the same finalize path for sandbox/live redundancy.

| SKU | On success |
|-----|------------|
| Pack small / medium / large | `paid_energy += 200 / 600 / 1500` |
| Monthly sub | `sub_active = true` (daily +50 is midnight job / CC-33) |

## Env

| Variable | Notes |
|----------|--------|
| `PUBLIC_API_BASE` | Callback + mock page absolute base (default `http://127.0.0.1:$PORT`) |
| `IYZICO_MOCK` | `true` / default when keys missing; `false` + keys → sandbox/live |
| `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` | Merchant panel — server only |
| `IYZICO_BASE_URL` | Default `https://sandbox-api.iyzipay.com` |
| `IYZICO_PRICING_PLAN_REF` | Required for **live** subscription CF |
| `IYZICO_PRODUCT_*` | Optional product id overrides |

## How to test

```bash
cd apps/api
npm test                 # catalog + signature + idempotent grant
npm run typecheck
```

Manual (mock):

1. `IYZICO_MOCK=true` (or omit keys), API + Expo web up.
2. Phone-verify → Dükkan → **iyzico ile al** on a pack → mock **3DS Başarılı**.
3. Return to `/shop?iyzico=success…` — energy total includes new paid bucket.
4. **Abone ol** → `subActive` true on `/v1/me`.

Sandbox: set keys, `IYZICO_MOCK=false`, test card `5526080000000006` (docs.iyzico.com test cards). Ensure `PUBLIC_API_BASE` is reachable for the CF callback (tunnel if local).

## Schema

Migration `014_iyzico_web.sql`: `iyzico_checkouts`, `iyzico_grants`, `users.sub_active` (IF NOT EXISTS for CC-33/44 ordering).
