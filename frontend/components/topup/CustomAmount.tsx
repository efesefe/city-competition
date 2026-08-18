"use client";

import { useTranslations } from "next-intl";
import {
  CUSTOM_PRODUCT_ID,
  customAmountKurus,
  formatTryFromKurus,
  grantedCredits,
} from "@/lib/packOffers";
import styles from "./PackageGrid.module.css";

export type CustomPricing = {
  min_credits: number;
  max_credits: number;
  credits: number;
  amount_kurus: number;
};

type Props = {
  selected: boolean;
  credits: string;
  pricing: CustomPricing;
  promoPercent: number;
  onSelect: () => void;
  onCreditsChange: (value: string) => void;
};

const creditFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

export default function CustomAmount({
  selected,
  credits,
  pricing,
  promoPercent,
  onSelect,
  onCreditsChange,
}: Props) {
  const t = useTranslations("profile.topup");
  const parsed = Number.parseInt(credits, 10);
  const valid =
    Number.isFinite(parsed) &&
    parsed >= pricing.min_credits &&
    parsed <= pricing.max_credits;
  const price = valid
    ? customAmountKurus(parsed, pricing.credits, pricing.amount_kurus)
    : 0;
  const granted = valid ? grantedCredits(parsed, promoPercent) : 0;

  return (
    <section className={styles.custom} data-testid="topup-custom">
      <button
        type="button"
        className={
          selected ? `${styles.pack} ${styles.packSelected}` : styles.pack
        }
        aria-pressed={selected}
        data-testid={`topup-pack-${CUSTOM_PRODUCT_ID}`}
        onClick={onSelect}
      >
        <p className={styles.credits}>{t("customTitle")}</p>
        <p className={styles.price}>{t("customLead")}</p>
      </button>
      {selected ? (
        <div className={styles.customFields}>
          <label className={styles.customLabel} htmlFor="topup-custom-credits">
            {t("customCreditsLabel")}
          </label>
          <input
            id="topup-custom-credits"
            className={styles.customInput}
            type="number"
            min={pricing.min_credits}
            max={pricing.max_credits}
            step={1}
            value={credits}
            data-testid="topup-custom-credits"
            onChange={(e) => onCreditsChange(e.target.value)}
          />
          <p className={styles.customHint}>
            {t("customRange", {
              min: creditFormatter.format(pricing.min_credits),
              max: creditFormatter.format(pricing.max_credits),
            })}
          </p>
          {valid ? (
            <p className={styles.customPreview} data-testid="topup-custom-preview">
              {promoPercent > 0
                ? t("customPreviewPromo", {
                    credits: creditFormatter.format(granted),
                    extra: creditFormatter.format(granted - parsed),
                    price: formatTryFromKurus(price),
                  })
                : t("customPreview", {
                    credits: creditFormatter.format(granted),
                    price: formatTryFromKurus(price),
                  })}
            </p>
          ) : (
            <p className={styles.customHint}>{t("customInvalid")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
