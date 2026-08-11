export type PaymentSurface = "web" | "ios" | "android";

type CapacitorLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function readCapacitor(): CapacitorLike | null {
  if (typeof window === "undefined") return null;
  const cap = (window as Window & { Capacitor?: CapacitorLike }).Capacitor;
  return cap ?? null;
}

/** Detect web vs native payment surface. Defaults to web without Capacitor. */
export function getPaymentSurface(): PaymentSurface {
  const cap = readCapacitor();
  if (!cap?.isNativePlatform?.()) return "web";
  const platform = (cap.getPlatform?.() ?? "").toLowerCase();
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  return "web";
}

export function iapProviderForSurface(
  surface: PaymentSurface,
): "apple" | "google" | null {
  if (surface === "ios") return "apple";
  if (surface === "android") return "google";
  return null;
}

export const WEB_PROVIDERS = ["iyzico", "papara", "bkm_express"] as const;
export type WebProvider = (typeof WEB_PROVIDERS)[number];

export function isWebProvider(provider: string): provider is WebProvider {
  return (WEB_PROVIDERS as readonly string[]).includes(provider);
}

export type IapPurchaseResult = {
  provider: "apple" | "google";
  product_id: string;
  receipt_data?: string;
  purchase_token?: string;
  package_name?: string;
};

export type IapPurchaseFn = (input: {
  provider: "apple" | "google";
  product_id: string;
}) => Promise<IapPurchaseResult>;

let nativePurchaseImpl: IapPurchaseFn | null = null;

/** Register a native StoreKit/Play Billing bridge when available. */
export function registerIapPurchaseImpl(fn: IapPurchaseFn | null) {
  nativePurchaseImpl = fn;
}

/**
 * Start an in-app purchase on native builds.
 * Throws with code `iap_unavailable` until a native plugin is registered.
 */
export async function purchaseIapPack(input: {
  provider: "apple" | "google";
  product_id: string;
}): Promise<IapPurchaseResult> {
  if (!nativePurchaseImpl) {
    throw Object.assign(new Error("iap_unavailable"), {
      code: "iap_unavailable",
      status: 501,
    });
  }
  return nativePurchaseImpl(input);
}
