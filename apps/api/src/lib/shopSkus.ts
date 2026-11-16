/**
 * CC-48: Season 0 shop SKU matrix (iOS / Android / web product ids).
 * Channel checkout lives in IAP (#61/#67) and iyzico (#69) leaves — this leaf only
 * exposes the unified catalog on GET /v1/meta.shop so the client can render real SKUs.
 */

export type PackSku = "small" | "medium" | "large";

function envOr(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

const PACKS: { sku: PackSku; energy: number; tryPlaceholder: number; iosEnv: string; iosFb: string; androidEnv: string; androidFb: string; webEnv: string; webFb: string }[] = [
  {
    sku: "small",
    energy: 200,
    tryPlaceholder: 49.99,
    iosEnv: "RC_IOS_PRODUCT_PACK_SMALL",
    iosFb: "cc_ios_pack_small_200",
    androidEnv: "RC_ANDROID_PRODUCT_PACK_SMALL",
    androidFb: "cc_android_pack_small_200",
    webEnv: "IYZICO_PRODUCT_PACK_SMALL",
    webFb: "cc_web_pack_small_200",
  },
  {
    sku: "medium",
    energy: 600,
    tryPlaceholder: 129.99,
    iosEnv: "RC_IOS_PRODUCT_PACK_MEDIUM",
    iosFb: "cc_ios_pack_medium_600",
    androidEnv: "RC_ANDROID_PRODUCT_PACK_MEDIUM",
    androidFb: "cc_android_pack_medium_600",
    webEnv: "IYZICO_PRODUCT_PACK_MEDIUM",
    webFb: "cc_web_pack_medium_600",
  },
  {
    sku: "large",
    energy: 1500,
    tryPlaceholder: 249.99,
    iosEnv: "RC_IOS_PRODUCT_PACK_LARGE",
    iosFb: "cc_ios_pack_large_1500",
    androidEnv: "RC_ANDROID_PRODUCT_PACK_LARGE",
    androidFb: "cc_android_pack_large_1500",
    webEnv: "IYZICO_PRODUCT_PACK_LARGE",
    webFb: "cc_web_pack_large_1500",
  },
];

export function unifiedShopCatalog() {
  const packs = PACKS.map((p) => ({
    sku: p.sku,
    kind: "pack" as const,
    energy: p.energy,
    tryPlaceholder: p.tryPlaceholder,
    tryListingStatus: "tbd" as const,
    productId: envOr(p.iosEnv, p.iosFb),
    iosProductId: envOr(p.iosEnv, p.iosFb),
    androidProductId: envOr(p.androidEnv, p.androidFb),
    webProductId: envOr(p.webEnv, p.webFb),
  }));

  const iosSub = envOr("RC_IOS_PRODUCT_SUB_MONTHLY", "cc_ios_sub_monthly");
  const androidSub = envOr("RC_ANDROID_PRODUCT_SUB_MONTHLY", "cc_android_sub_monthly");
  const webSub = envOr("IYZICO_PRODUCT_SUB_MONTHLY", "cc_web_sub_monthly");

  return {
    stub: false,
    provider: "unified" as const,
    packs,
    subscription: {
      sku: "monthly" as const,
      kind: "subscription" as const,
      productId: iosSub,
      iosProductId: iosSub,
      androidProductId: androidSub,
      webProductId: webSub,
      entitlementId: envOr("RC_ENTITLEMENT_SUB", "monthly_sub"),
      dailyBonus: 50,
      tryPlaceholder: 99.99,
      tryListingStatus: "tbd" as const,
    },
    productIds: [
      ...packs.flatMap((p) => [p.iosProductId, p.androidProductId, p.webProductId]),
      iosSub,
      androidSub,
      webSub,
    ],
  };
}
