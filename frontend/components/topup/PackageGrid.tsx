"use client";

import { useTranslations } from "next-intl";
import type { PackOffer } from "@/lib/packOffers";
import { formatTryFromKurus, grantedCredits } from "@/lib/packOffers";
import styles from "./PackageGrid.module.css";

type Props = {
  offers: PackOffer[];
  selectedProductId: string | null;
  promoPercent?: number;
  onSelect: (productId: string) => void;
};

const creditFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

export default function PackageGrid({
  offers,
  selectedProductId,
  promoPercent = 0,
  onSelect,
}: Props) {
  const t = useTranslations("profile.topup");

  return (
    <ul className={styles.grid} data-testid="topup-package-grid">
      {offers.map((offer) => {
        const selected = offer.product_id === selectedProductId;
        return (
          <li key={offer.product_id}>
            <button
              type="button"
              className={
                selected ? `${styles.pack} ${styles.packSelected}` : styles.pack
              }
              aria-pressed={selected}
              data-testid={`topup-pack-${offer.product_id}`}
              onClick={() => onSelect(offer.product_id)}
            >
              <p className={styles.credits}>
                {t("credits", {
                  credits: creditFormatter.format(
                    grantedCredits(offer.credits, promoPercent),
                  ),
                })}
              </p>
              <p className={styles.price}>
                {offer.amount_kurus > 0
                  ? formatTryFromKurus(offer.amount_kurus)
                  : t("priceUnavailable")}
              </p>
              {promoPercent > 0 ? (
                <p className={styles.bonus} data-testid="topup-pack-promo">
                  {t("promoExtra", {
                    extra: creditFormatter.format(
                      grantedCredits(offer.credits, promoPercent) -
                        offer.credits,
                    ),
                    percent: promoPercent,
                  })}
                </p>
              ) : offer.bonus_percent > 0 ? (
                <p className={styles.bonus} data-testid="topup-pack-bonus">
                  {t("bonus", { percent: offer.bonus_percent })}
                </p>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
