import { Platform } from "react-native";
import {
  allAndroidProductIds,
  allIosProductIds,
  androidSubEntitlementId,
  androidSubProductId,
  iosSubEntitlementId,
  iosSubProductId,
  revenueCatAndroidApiKey,
  revenueCatIosApiKey,
} from "./iapCatalog";

export type NativeBillingPlatform = "ios" | "android";

export type PurchaseSyncPayload = {
  productId: string;
  transactionId: string;
  platform: NativeBillingPlatform;
};

export type RcOfferingPackage = {
  identifier: string;
  product: { identifier: string; title?: string; priceString?: string };
};

type PurchasesModule = typeof import("react-native-purchases").default;

let configured = false;
let configuredPlatform: NativeBillingPlatform | null = null;
let purchases: PurchasesModule | null = null;

export function nativeBillingPlatform(): NativeBillingPlatform | null {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return null;
}

function apiKeyFor(platform: NativeBillingPlatform): string | null {
  return platform === "android" ? revenueCatAndroidApiKey() : revenueCatIosApiKey();
}

async function loadPurchases(platform: NativeBillingPlatform): Promise<PurchasesModule | null> {
  if (purchases) return purchases;
  try {
    const mod = await import("react-native-purchases");
    purchases = mod.default;
    return purchases;
  } catch {
    return null;
  }
}

/** Configure RevenueCat on iOS or Android when the matching public SDK key is set. */
export async function configureRevenueCat(appUserId?: string | null): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const platform = nativeBillingPlatform();
  if (!platform) return { ok: false, reason: "web_surface" };
  const apiKey = apiKeyFor(platform);
  if (!apiKey) return { ok: false, reason: "missing_api_key" };

  const RC = await loadPurchases(platform);
  if (!RC) return { ok: false, reason: "sdk_unavailable" };

  if (!configured || configuredPlatform !== platform) {
    RC.configure({
      apiKey,
      appUserID: appUserId ?? undefined,
    });
    configured = true;
    configuredPlatform = platform;
  } else if (appUserId) {
    await RC.logIn(appUserId);
  }
  return { ok: true };
}

export function isRevenueCatReady(): boolean {
  const platform = nativeBillingPlatform();
  if (!platform) return false;
  return Boolean(apiKeyFor(platform)) && configured && configuredPlatform === platform;
}

export async function identifyRevenueCatUser(userId: string): Promise<void> {
  const platform = nativeBillingPlatform();
  if (!platform || !apiKeyFor(platform)) return;
  const RC = await loadPurchases(platform);
  if (!RC) return;
  if (!configured || configuredPlatform !== platform) {
    await configureRevenueCat(userId);
    return;
  }
  await RC.logIn(userId);
}

export async function logoutRevenueCat(): Promise<void> {
  if (!configured) return;
  const platform = configuredPlatform ?? nativeBillingPlatform();
  if (!platform) return;
  const RC = await loadPurchases(platform);
  if (!RC) return;
  try {
    await RC.logOut();
  } catch {
    // Anonymous restore after logout is fine.
  }
}

/** Fetch store products for env-mapped SKUs on the current native platform. */
export async function getNativeProducts(): Promise<
  { identifier: string; title: string; priceString: string }[]
> {
  const platform = nativeBillingPlatform();
  if (!platform) return [];
  const RC = await loadPurchases(platform);
  if (!RC || !configured) return [];
  const ids = platform === "android" ? allAndroidProductIds() : allIosProductIds();
  const products = await RC.getProducts(ids);
  return products.map((p) => ({
    identifier: p.identifier,
    title: p.title,
    priceString: p.priceString,
  }));
}

/** @deprecated use getNativeProducts — kept for CC-44 call sites */
export async function getIosProducts() {
  return getNativeProducts();
}

function transactionIdFromInfo(
  info: {
    originalAppUserId: string;
    nonSubscriptionTransactions?: { productIdentifier: string; transactionIdentifier: string }[];
    entitlements?: {
      active: Record<
        string,
        { productIdentifier: string; latestPurchaseDateMillis?: number; originalPurchaseDateMillis?: number }
      >;
    };
  },
  productId: string,
): string | null {
  const nonSub = info.nonSubscriptionTransactions ?? [];
  for (let i = nonSub.length - 1; i >= 0; i--) {
    const t = nonSub[i]!;
    if (t.productIdentifier === productId && t.transactionIdentifier) {
      return t.transactionIdentifier;
    }
  }
  const active = info.entitlements?.active ?? {};
  for (const ent of Object.values(active)) {
    if (ent.productIdentifier === productId) {
      const stamp = ent.latestPurchaseDateMillis ?? ent.originalPurchaseDateMillis ?? 0;
      return `${info.originalAppUserId}:${productId}:${stamp}`;
    }
  }
  return null;
}

/**
 * Purchase a pack or subscription by store / RevenueCat product id.
 * Returns fields for POST /v1/iap/sync (shared iOS + Android entitlement hook).
 */
export async function purchaseNativeProduct(productId: string): Promise<PurchaseSyncPayload> {
  const platform = nativeBillingPlatform();
  if (!platform) {
    throw Object.assign(new Error("iap_native_only"), { code: "iap_native_only" });
  }
  const apiKey = apiKeyFor(platform);
  if (!apiKey) {
    throw Object.assign(new Error("iap_not_configured"), { code: "iap_not_configured" });
  }
  const RC = await loadPurchases(platform);
  if (!RC) {
    throw Object.assign(new Error("iap_unavailable"), { code: "iap_unavailable" });
  }
  if (!configured || configuredPlatform !== platform) await configureRevenueCat();

  const products = await RC.getProducts([productId]);
  const product = products[0];
  if (!product) {
    throw Object.assign(new Error("product_not_found"), { code: "product_not_found" });
  }

  const { customerInfo } = await RC.purchaseStoreProduct(product);
  const transactionId = transactionIdFromInfo(customerInfo, productId);
  if (!transactionId) {
    const fallback = `${customerInfo.originalAppUserId}:${productId}:${Date.now()}`;
    return { productId, transactionId: fallback, platform };
  }
  return { productId, transactionId, platform };
}

/** @deprecated use purchaseNativeProduct */
export async function purchaseIosProduct(productId: string): Promise<PurchaseSyncPayload> {
  return purchaseNativeProduct(productId);
}

/**
 * Restore store purchases; return sync payloads for active sub + recent packs.
 */
export async function restoreNativePurchases(): Promise<{
  payloads: PurchaseSyncPayload[];
  subActive: boolean;
}> {
  const platform = nativeBillingPlatform();
  if (!platform) {
    throw Object.assign(new Error("iap_native_only"), { code: "iap_native_only" });
  }
  const apiKey = apiKeyFor(platform);
  if (!apiKey) {
    throw Object.assign(new Error("iap_not_configured"), { code: "iap_not_configured" });
  }
  const RC = await loadPurchases(platform);
  if (!RC) {
    throw Object.assign(new Error("iap_unavailable"), { code: "iap_unavailable" });
  }
  if (!configured || configuredPlatform !== platform) await configureRevenueCat();

  const info = await RC.restorePurchases();
  const payloads: PurchaseSyncPayload[] = [];
  const seen = new Set<string>();

  for (const t of info.nonSubscriptionTransactions ?? []) {
    if (!t.transactionIdentifier || seen.has(t.transactionIdentifier)) continue;
    seen.add(t.transactionIdentifier);
    payloads.push({
      productId: t.productIdentifier,
      transactionId: t.transactionIdentifier,
      platform,
    });
  }

  const subEnt = platform === "android" ? androidSubEntitlementId() : iosSubEntitlementId();
  const activeSub = info.entitlements.active[subEnt];
  const subActive = Boolean(activeSub);
  if (activeSub?.productIdentifier) {
    const stamp = activeSub.latestPurchaseDateMillis || activeSub.originalPurchaseDateMillis || 0;
    const txn = `${info.originalAppUserId}:sub:${activeSub.productIdentifier}:${stamp}`;
    if (!seen.has(txn)) {
      payloads.push({
        productId:
          activeSub.productIdentifier ||
          (platform === "android" ? androidSubProductId() : iosSubProductId()),
        transactionId: txn,
        platform,
      });
    }
  }

  return { payloads, subActive };
}

/** @deprecated use restoreNativePurchases */
export async function restoreIosPurchases() {
  return restoreNativePurchases();
}
