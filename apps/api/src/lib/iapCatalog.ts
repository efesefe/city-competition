/**
 * Env-based native SKU map for RevenueCat (iOS App Store + Android Play Billing).
 * Energy amounts match economy-sheet.md; store product IDs are placeholders until stores go live.
 *
 * Shared by CC-44 (iOS) and CC-45 (Android). Same entitlement apply path (`applyIapGrant`).
 */

export type PackSku = "small" | "medium" | "large";
export type StorePlatform = "ios" | "android";

export type IapPackOffer = {
  sku: PackSku;
  kind: "pack";
  energy: number;
  productId: string;
  tryPlaceholder: number;
  platform: StorePlatform;
};

export type IapSubOffer = {
  sku: "monthly";
  kind: "subscription";
  productId: string;
  entitlementId: string;
  dailyBonus: number;
  tryPlaceholder: number;
  platform: StorePlatform;
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
      platform: "ios",
    },
    {
      sku: "medium",
      kind: "pack",
      energy: PACK_ENERGY.medium,
      productId: envOr("RC_IOS_PRODUCT_PACK_MEDIUM", "cc_ios_pack_medium_600"),
      tryPlaceholder: 129.99,
      platform: "ios",
    },
    {
      sku: "large",
      kind: "pack",
      energy: PACK_ENERGY.large,
      productId: envOr("RC_IOS_PRODUCT_PACK_LARGE", "cc_ios_pack_large_1500"),
      tryPlaceholder: 249.99,
      platform: "ios",
    },
  ];
}

export function androidPackOffers(): IapPackOffer[] {
  return [
    {
      sku: "small",
      kind: "pack",
      energy: PACK_ENERGY.small,
      productId: envOr("RC_ANDROID_PRODUCT_PACK_SMALL", "cc_android_pack_small_200"),
      tryPlaceholder: 49.99,
      platform: "android",
    },
    {
      sku: "medium",
      kind: "pack",
      energy: PACK_ENERGY.medium,
      productId: envOr("RC_ANDROID_PRODUCT_PACK_MEDIUM", "cc_android_pack_medium_600"),
      tryPlaceholder: 129.99,
      platform: "android",
    },
    {
      sku: "large",
      kind: "pack",
      energy: PACK_ENERGY.large,
      productId: envOr("RC_ANDROID_PRODUCT_PACK_LARGE", "cc_android_pack_large_1500"),
      tryPlaceholder: 249.99,
      platform: "android",
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
    platform: "ios",
  };
}

export function androidSubOffer(): IapSubOffer {
  return {
    sku: "monthly",
    kind: "subscription",
    productId: envOr("RC_ANDROID_PRODUCT_SUB_MONTHLY", "cc_android_sub_monthly"),
    entitlementId: envOr("RC_ENTITLEMENT_SUB", "monthly_sub"),
    dailyBonus: 50,
    tryPlaceholder: 99.99,
    platform: "android",
  };
}

export function packOffersFor(platform: StorePlatform): IapPackOffer[] {
  return platform === "android" ? androidPackOffers() : iosPackOffers();
}

export function subOfferFor(platform: StorePlatform): IapSubOffer {
  return platform === "android" ? androidSubOffer() : iosSubOffer();
}

/**
 * Meta shop payload — packs expose both store product ids; `productId` stays iOS
 * for CC-44 client backward compatibility.
 */
export function shopCatalog() {
  const iosPacks = iosPackOffers();
  const androidPacks = androidPackOffers();
  const iosSub = iosSubOffer();
  const androidSub = androidSubOffer();
  const packs = iosPacks.map((p, i) => ({
    sku: p.sku,
    kind: p.kind,
    energy: p.energy,
    tryPlaceholder: p.tryPlaceholder,
    productId: p.productId,
    iosProductId: p.productId,
    androidProductId: androidPacks[i]!.productId,
  }));
  return {
    stub: false,
    provider: "revenuecat" as const,
    packs,
    subscription: {
      sku: "monthly" as const,
      kind: "subscription" as const,
      productId: iosSub.productId,
      iosProductId: iosSub.productId,
      androidProductId: androidSub.productId,
      entitlementId: iosSub.entitlementId,
      dailyBonus: iosSub.dailyBonus,
      tryPlaceholder: iosSub.tryPlaceholder,
    },
    productIds: [
      ...iosPacks.map((p) => p.productId),
      ...androidPacks.map((p) => p.productId),
      iosSub.productId,
      androidSub.productId,
    ],
  };
}

export function lookupPackByProductId(productId: string): IapPackOffer | undefined {
  const id = productId.trim();
  return (
    iosPackOffers().find((p) => p.productId === id) ||
    androidPackOffers().find((p) => p.productId === id)
  );
}

export function isSubProductId(productId: string): boolean {
  const id = productId.trim();
  return id === iosSubOffer().productId || id === androidSubOffer().productId;
}

export function storeForPlatform(platform: StorePlatform): "app_store" | "play_store" {
  return platform === "android" ? "play_store" : "app_store";
}

export function revenuecatConfigured(): boolean {
  return Boolean(process.env.REVENUECAT_WEBHOOK_AUTHORIZATION?.trim());
}

export function iapStubEnabled(): boolean {
  return process.env.ALLOW_IAP_STUB === "true";
}
