/**
 * Env-based iOS App Store SKU map for RevenueCat (packs + monthly sub).
 * Energy amounts match docs/economy-sheet.md; store product IDs are placeholders until App Store Connect is live.
 */

export type PackSku = "small" | "medium" | "large";

export type IapPackOffer = {
  sku: PackSku;
  kind: "pack";
  energy: number;
  productId: string;
  tryPlaceholder: number;
};

export type IapSubOffer = {
  sku: "monthly";
  kind: "subscription";
  productId: string;
  entitlementId: string;
  dailyBonus: number;
  tryPlaceholder: number;
};

function envOr(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

/** Locked energy amounts from economy sheet. */
export const PACK_ENERGY: Record<PackSku, number> = {
  small: 200,
  medium: 600,
  large: 1500,
};

export function iosPackOffers(): IapPackOffer[] {
  return [
    {
      sku: "small",
      kind: "pack",
      energy: PACK_ENERGY.small,
      productId: envOr("RC_IOS_PRODUCT_PACK_SMALL", "cc_ios_pack_small_200"),
      tryPlaceholder: 49.99,
    },
    {
      sku: "medium",
      kind: "pack",
      energy: PACK_ENERGY.medium,
      productId: envOr("RC_IOS_PRODUCT_PACK_MEDIUM", "cc_ios_pack_medium_600"),
      tryPlaceholder: 129.99,
    },
    {
      sku: "large",
      kind: "pack",
      energy: PACK_ENERGY.large,
      productId: envOr("RC_IOS_PRODUCT_PACK_LARGE", "cc_ios_pack_large_1500"),
      tryPlaceholder: 249.99,
    },
  ];
}

export function iosSubOffer(): IapSubOffer {
  return {
    sku: "monthly",
    kind: "subscription",
    productId: envOr("RC_IOS_PRODUCT_SUB_MONTHLY", "cc_ios_sub_monthly"),
    entitlementId: envOr("RC_ENTITLEMENT_SUB", "monthly_sub"),
    dailyBonus: 50,
    tryPlaceholder: 99.99,
  };
}

export function shopCatalog() {
  const packs = iosPackOffers();
  const subscription = iosSubOffer();
  return {
    stub: false,
    platform: "ios" as const,
    provider: "revenuecat" as const,
    packs,
    subscription,
    productIds: [...packs.map((p) => p.productId), subscription.productId],
  };
}

export function lookupPackByProductId(productId: string): IapPackOffer | undefined {
  const id = productId.trim();
  return iosPackOffers().find((p) => p.productId === id);
}

export function isSubProductId(productId: string): boolean {
  return productId.trim() === iosSubOffer().productId;
}

export function revenuecatConfigured(): boolean {
  return Boolean(process.env.REVENUECAT_WEBHOOK_AUTHORIZATION?.trim());
}

export function iapStubEnabled(): boolean {
  return process.env.ALLOW_IAP_STUB === "true";
}
