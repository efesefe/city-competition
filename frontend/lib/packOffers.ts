import type { CreditPack } from "@/lib/topup-api";
import {
  getPaymentSurface,
  iapProviderForSurface,
  isWebProvider,
  type PaymentSurface,
  type WebProvider,
} from "@/lib/iapBridge";

export type PackOffer = {
  product_id: string;
  credits: number;
  amount_kurus: number;
  /** Percent extra credits vs cheapest pack value; 0 if none. */
  bonus_percent: number;
  providers: string[];
};

const BONUS_THRESHOLD = 10;

export const CUSTOM_PRODUCT_ID = "credits_custom";

export function grantedCredits(base: number, promoPercent: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(promoPercent) || promoPercent <= 0) return Math.floor(base);
  return Math.floor(base) + Math.floor((Math.floor(base) * promoPercent) / 100);
}

export function customAmountKurus(
  credits: number,
  rateCredits: number,
  rateKurus: number,
): number {
  if (credits <= 0 || rateCredits <= 0 || rateKurus <= 0) return 0;
  return Math.ceil((credits * rateKurus) / rateCredits);
}

/** Format kuruş as TRY for display (e.g. 999 → "₺9,99"). */
export function formatTryFromKurus(kurus: number, locale = "tr-TR"): string {
  const tryAmount = kurus / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "TRY",
  }).format(tryAmount);
}

export function formatKurusBreakdown(
  kurus: number,
  locale = "tr-TR",
): string {
  return formatTryFromKurus(kurus, locale);
}

/**
 * Group raw pack rows by product_id and compute bonus framing vs the
 * cheapest credits-per-kuruş baseline among priced packs.
 */
export function groupPackOffers(packs: CreditPack[]): PackOffer[] {
  const byProduct = new Map<
    string,
    { credits: number; amount_kurus: number; providers: Set<string> }
  >();

  for (const pack of packs) {
    const amount = pack.amount_kurus ?? 0;
    const existing = byProduct.get(pack.product_id);
    if (!existing) {
      byProduct.set(pack.product_id, {
        credits: pack.credits,
        amount_kurus: amount,
        providers: new Set([pack.provider]),
      });
      continue;
    }
    existing.providers.add(pack.provider);
    if (amount > 0 && (existing.amount_kurus <= 0 || amount < existing.amount_kurus)) {
      existing.amount_kurus = amount;
    }
    if (pack.credits > existing.credits) {
      existing.credits = pack.credits;
    }
  }

  const priced = [...byProduct.values()].filter((p) => p.amount_kurus > 0);
  let baselineRate = 0;
  for (const p of priced) {
    const rate = p.credits / p.amount_kurus;
    if (baselineRate === 0 || rate < baselineRate) {
      baselineRate = rate;
    }
  }

  const offers: PackOffer[] = [];
  for (const [product_id, row] of byProduct) {
    let bonus = 0;
    if (baselineRate > 0 && row.amount_kurus > 0) {
      const rate = row.credits / row.amount_kurus;
      const pct = Math.round(((rate - baselineRate) / baselineRate) * 100);
      if (pct >= BONUS_THRESHOLD) {
        bonus = pct;
      }
    }
    offers.push({
      product_id,
      credits: row.credits,
      amount_kurus: row.amount_kurus,
      bonus_percent: bonus,
      providers: [...row.providers].sort(),
    });
  }

  return offers.sort((a, b) => a.credits - b.credits || a.amount_kurus - b.amount_kurus);
}

export function providersForSurface(
  offer: PackOffer,
  surface: PaymentSurface = getPaymentSurface(),
): string[] {
  if (surface === "web") {
    return offer.providers.filter(isWebProvider);
  }
  const iap = iapProviderForSurface(surface);
  if (!iap) return [];
  return offer.providers.filter((p) => p === iap);
}

export function webProvidersForOffer(offer: PackOffer): WebProvider[] {
  return offer.providers.filter(isWebProvider);
}
