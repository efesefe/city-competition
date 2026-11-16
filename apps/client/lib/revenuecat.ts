import { Platform } from "react-native";
import {
  allIosProductIds,
  iosSubEntitlementId,
  iosSubProductId,
  revenueCatIosApiKey,
} from "./iapCatalog";

export type PurchaseSyncPayload = {
  productId: string;
  transactionId: string;
  platform: "ios";
  environment?: string;
};

export type RcOfferingPackage = {
  identifier: string;
  product: { identifier: string; title?: string; priceString?: string };
};

type PurchasesModule = typeof import("react-native-purchases").default;

let configured = false;
let purchases: PurchasesModule | null = null;

async function loadPurchases(): Promise<PurchasesModule | null> {
  if (Platform.OS !== "ios") return null;
  if (purchases) return purchases;
  try {
    const mod = await import("react-native-purchases");
    purchases = mod.default;
    return purchases;
  } catch {
    return null;
  }
}

/** Configure RevenueCat once on iOS when EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is set. */
export async function configureRevenueCat(appUserId?: string | null): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (Platform.OS !== "ios") return { ok: false, reason: "not_ios" };
  const apiKey = revenueCatIosApiKey();
  if (!apiKey) return { ok: false, reason: "missing_api_key" };

  const RC = await loadPurchases();
  if (!RC) return { ok: false, reason: "sdk_unavailable" };

  if (!configured) {
    RC.configure({
      apiKey,
      appUserID: appUserId ?? undefined,
    });
    configured = true;
  } else if (appUserId) {
    await RC.logIn(appUserId);
  }
  return { ok: true };
}

export function isRevenueCatReady(): boolean {
  return Platform.OS === "ios" && Boolean(revenueCatIosApiKey()) && configured;
}

export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (Platform.OS !== "ios" || !revenueCatIosApiKey()) return;
  const RC = await loadPurchases();
  if (!RC) return;
  if (!configured) {
    await configureRevenueCat(userId);
    return;
  }
  await RC.logIn(userId);
}

export async function logoutRevenueCat(): Promise<void> {
  if (!configured) return;
  const RC = await loadPurchases();
  if (!RC) return;
  try {
    await RC.logOut();
  } catch {
    // Anonymous restore after logout is fine.
  }
}

/** Fetch store products for our env-mapped iOS SKUs. */
export async function getIosProducts(): Promise<
  { identifier: string; title: string; priceString: string }[]
> {
  const RC = await loadPurchases();
  if (!RC || !configured) return [];
  const products = await RC.getProducts(allIosProductIds());
  return products.map((p) => ({
    identifier: p.identifier,
    title: p.title,
    priceString: p.priceString,
  }));
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
 * Purchase an iOS pack or subscription by App Store / RevenueCat product id.
 * Returns fields for POST /v1/iap/sync.
 */
export async function purchaseIosProduct(productId: string): Promise<PurchaseSyncPayload> {
  if (Platform.OS !== "ios") {
    throw Object.assign(new Error("iap_ios_only"), { code: "iap_ios_only" });
  }
  const apiKey = revenueCatIosApiKey();
  if (!apiKey) {
    throw Object.assign(new Error("iap_not_configured"), { code: "iap_not_configured" });
  }
  const RC = await loadPurchases();
  if (!RC) {
    throw Object.assign(new Error("iap_unavailable"), { code: "iap_unavailable" });
  }
  if (!configured) await configureRevenueCat();

  const products = await RC.getProducts([productId]);
  const product = products[0];
  if (!product) {
    throw Object.assign(new Error("product_not_found"), { code: "product_not_found" });
  }

  const { customerInfo } = await RC.purchaseStoreProduct(product);
  const transactionId = transactionIdFromInfo(customerInfo, productId);
  if (!transactionId) {
    // Fallback: originalAppUserId + product + latest purchase date hash-ish
    const fallback = `${customerInfo.originalAppUserId}:${productId}:${Date.now()}`;
    return { productId, transactionId: fallback, platform: "ios" };
  }
  return { productId, transactionId, platform: "ios" };
}

/**
 * Restore App Store purchases, return sync payloads for active sub + recent packs.
 */
export async function restoreIosPurchases(): Promise<{
  payloads: PurchaseSyncPayload[];
  subActive: boolean;
}> {
  if (Platform.OS !== "ios") {
    throw Object.assign(new Error("iap_ios_only"), { code: "iap_ios_only" });
  }
  const apiKey = revenueCatIosApiKey();
  if (!apiKey) {
    throw Object.assign(new Error("iap_not_configured"), { code: "iap_not_configured" });
  }
  const RC = await loadPurchases();
  if (!RC) {
    throw Object.assign(new Error("iap_unavailable"), { code: "iap_unavailable" });
  }
  if (!configured) await configureRevenueCat();

  const info = await RC.restorePurchases();
  const payloads: PurchaseSyncPayload[] = [];
  const seen = new Set<string>();

  for (const t of info.nonSubscriptionTransactions ?? []) {
    if (!t.transactionIdentifier || seen.has(t.transactionIdentifier)) continue;
    seen.add(t.transactionIdentifier);
    payloads.push({
      productId: t.productIdentifier,
      transactionId: t.transactionIdentifier,
      platform: "ios",
    });
  }

  const subEnt = iosSubEntitlementId();
  const activeSub = info.entitlements.active[subEnt];
  const subActive = Boolean(activeSub);
  if (activeSub?.productIdentifier) {
    const stamp = activeSub.latestPurchaseDateMillis || activeSub.originalPurchaseDateMillis || 0;
    const txn = `${info.originalAppUserId}:sub:${activeSub.productIdentifier}:${stamp}`;
    if (!seen.has(txn)) {
      payloads.push({
        productId: activeSub.productIdentifier || iosSubProductId(),
        transactionId: txn,
        platform: "ios",
      });
    }
  }

  return { payloads, subActive };
}
