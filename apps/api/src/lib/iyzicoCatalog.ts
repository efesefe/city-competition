/**
 * Web shop catalog for iyzico Checkout Form / 3DS (packs + monthly subscription).
 * Energy amounts match economy-sheet.md; TRY listing prices are placeholders until admin lock.
 */

export type PackSku = "small" | "medium" | "large";

export type WebPackOffer = {
  sku: PackSku;
  kind: "pack";
  energy: number;
  productId: string;
  tryPlaceholder: number;
  amountKurus: number;
};

export type WebSubOffer = {
  sku: "monthly";
  kind: "subscription";
  productId: string;
  dailyBonus: number;
  tryPlaceholder: number;
  amountKurus: number;
  /** iyzico Subscription pricing plan reference (merchant panel). */
  pricingPlanReferenceCode: string | null;
};

function envOr(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function tryToKurus(tryAmount: number): number {
  return Math.round(tryAmount * 100);
}

/** Locked energy amounts from economy sheet. */
export const PACK_ENERGY: Record<PackSku, number> = {
  small: 200,
  medium: 600,
  large: 1500,
};

export function webPackOffers(): WebPackOffer[] {
  const rows: { sku: PackSku; energy: number; productEnv: string; fallbackId: string; tryPlaceholder: number }[] = [
    {
      sku: "small",
      energy: PACK_ENERGY.small,
      productEnv: "IYZICO_PRODUCT_PACK_SMALL",
      fallbackId: "cc_web_pack_small_200",
      tryPlaceholder: 49.99,
    },
    {
      sku: "medium",
      energy: PACK_ENERGY.medium,
      productEnv: "IYZICO_PRODUCT_PACK_MEDIUM",
      fallbackId: "cc_web_pack_medium_600",
      tryPlaceholder: 129.99,
    },
    {
      sku: "large",
      energy: PACK_ENERGY.large,
      productEnv: "IYZICO_PRODUCT_PACK_LARGE",
      fallbackId: "cc_web_pack_large_1500",
      tryPlaceholder: 249.99,
    },
  ];
  return rows.map((r) => ({
    sku: r.sku,
    kind: "pack" as const,
    energy: r.energy,
    productId: envOr(r.productEnv, r.fallbackId),
    tryPlaceholder: r.tryPlaceholder,
    amountKurus: tryToKurus(r.tryPlaceholder),
  }));
}

export function webSubOffer(): WebSubOffer {
  const tryPlaceholder = 99.99;
  const plan = process.env.IYZICO_PRICING_PLAN_REF?.trim() || null;
  return {
    sku: "monthly",
    kind: "subscription",
    productId: envOr("IYZICO_PRODUCT_SUB_MONTHLY", "cc_web_sub_monthly"),
    dailyBonus: 50,
    tryPlaceholder,
    amountKurus: tryToKurus(tryPlaceholder),
    pricingPlanReferenceCode: plan,
  };
}

export function webShopCatalog() {
  const packs = webPackOffers();
  const subscription = webSubOffer();
  return {
    stub: false,
    platform: "web" as const,
    provider: "iyzico" as const,
    threeds: true,
    packs: packs.map(({ amountKurus: _a, ...rest }) => rest),
    subscription: {
      sku: subscription.sku,
      kind: subscription.kind,
      productId: subscription.productId,
      dailyBonus: subscription.dailyBonus,
      tryPlaceholder: subscription.tryPlaceholder,
      pricingPlanConfigured: Boolean(subscription.pricingPlanReferenceCode),
    },
  };
}

export function lookupPackBySku(sku: string): WebPackOffer | undefined {
  return webPackOffers().find((p) => p.sku === sku);
}

export function lookupPackByProductId(productId: string): WebPackOffer | undefined {
  const id = productId.trim();
  return webPackOffers().find((p) => p.productId === id);
}

export function isWebSubProductId(productId: string): boolean {
  return productId.trim() === webSubOffer().productId;
}

export function iyzicoMockMode(): boolean {
  if (process.env.IYZICO_MOCK === "true") return true;
  if (process.env.IYZICO_MOCK === "false") return false;
  // Default: mock when keys absent (local slice).
  return !process.env.IYZICO_API_KEY?.trim() || !process.env.IYZICO_SECRET_KEY?.trim();
}

export function iyzicoConfigured(): boolean {
  return Boolean(process.env.IYZICO_API_KEY?.trim() && process.env.IYZICO_SECRET_KEY?.trim());
}

export function publicApiBase(): string {
  return (
    process.env.PUBLIC_API_BASE?.trim() ||
    process.env.PAYMENTS_PUBLIC_BASE?.trim() ||
    `http://127.0.0.1:${process.env.PORT || 8787}`
  );
}

export function fmtMoneyTry(amountKurus: number): string {
  return (amountKurus / 100).toFixed(2);
}
