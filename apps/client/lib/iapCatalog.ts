/**
 * Client-side iOS SKU map — keep in sync with apps/api/src/lib/iapCatalog.ts defaults.
 * Override via EXPO_PUBLIC_RC_* env (EAS / .env).
 */

export type PackSku = "small" | "medium" | "large";

function envOr(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

export const PACK_ENERGY: Record<PackSku, number> = {
  small: 200,
  medium: 600,
  large: 1500,
};

export function iosPackProductId(sku: PackSku): string {
  switch (sku) {
    case "small":
      return envOr("EXPO_PUBLIC_RC_IOS_PRODUCT_PACK_SMALL", "cc_ios_pack_small_200");
    case "medium":
      return envOr("EXPO_PUBLIC_RC_IOS_PRODUCT_PACK_MEDIUM", "cc_ios_pack_medium_600");
    case "large":
      return envOr("EXPO_PUBLIC_RC_IOS_PRODUCT_PACK_LARGE", "cc_ios_pack_large_1500");
  }
}

export function iosSubProductId(): string {
  return envOr("EXPO_PUBLIC_RC_IOS_PRODUCT_SUB_MONTHLY", "cc_ios_sub_monthly");
}

export function iosSubEntitlementId(): string {
  return envOr("EXPO_PUBLIC_RC_ENTITLEMENT_SUB", "monthly_sub");
}

export function revenueCatIosApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  return key || null;
}

export function allIosProductIds(): string[] {
  return [
    iosPackProductId("small"),
    iosPackProductId("medium"),
    iosPackProductId("large"),
    iosSubProductId(),
  ];
}
