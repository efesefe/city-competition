# Shop UI ↔ real SKUs (CC-48)

`GET /v1/meta` → `shop` exposes locked Season 0 SKUs with **real channel product IDs**. TRY listing prices stay **TBD placeholders** until admin locks currency.

Catalog: `unifiedShopCatalog()` in `apps/api/src/lib/shopSkus.ts` (`provider: "unified"`).

## Pack matrix

| sku | energy | iOS product | Android product | Web (iyzico) product | TRY |
| --- | --- | --- | --- | --- | --- |
| small | 200 | `cc_ios_pack_small_200` | `cc_android_pack_small_200` | `cc_web_pack_small_200` | TBD (placeholder ₺49.99) |
| medium | 600 | `cc_ios_pack_medium_600` | `cc_android_pack_medium_600` | `cc_web_pack_medium_600` | TBD (₺129.99) |
| large | 1500 | `cc_ios_pack_large_1500` | `cc_android_pack_large_1500` | `cc_web_pack_large_1500` | TBD (₺249.99) |

Monthly sub: +50/day; product ids `cc_ios_sub_monthly` / `cc_android_sub_monthly` / `cc_web_sub_monthly` (env-overridable). `tryListingStatus: "tbd"`.

## Client

`apps/client/app/shop.tsx` renders the unified SKU matrix (energy + channel product ids + TBD TRY). Channel checkout (RevenueCat / iyzico) lands with #61/#67/#69 — this leaf keeps personal-boost stub activate and sim grant for local QA.
