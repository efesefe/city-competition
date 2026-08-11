"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getPaymentSurface,
  iapProviderForSurface,
  purchaseIapPack,
  type WebProvider,
} from "@/lib/iapBridge";
import type { PackOffer } from "@/lib/packOffers";
import { providersForSurface, webProvidersForOffer } from "@/lib/packOffers";
import {
  CHECKOUT_INTENT_STORAGE_KEY,
  startCheckout,
  verifyIap,
  type GrantResult,
} from "@/lib/topup-api";
import styles from "./CheckoutPanel.module.css";

type Props = {
  offer: PackOffer | null;
  onIapSuccess: (grant: GrantResult) => void;
};

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  iyzico: "providerIyzico",
  papara: "providerPapara",
  bkm_express: "providerBkm",
  apple: "providerApple",
  google: "providerGoogle",
};

export default function CheckoutPanel({ offer, onIapSuccess }: Props) {
  const t = useTranslations("profile.topup");
  const surface = getPaymentSurface();
  const available = useMemo(
    () => (offer ? providersForSurface(offer, surface) : []),
    [offer, surface],
  );
  const webProviders = useMemo(
    () => (offer ? webProvidersForOffer(offer) : []),
    [offer],
  );

  const [provider, setProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider =
    provider && available.includes(provider)
      ? provider
      : available[0] ?? null;

  async function handlePay() {
    if (!offer || !selectedProvider) return;
    setBusy(true);
    setError(null);
    try {
      if (surface === "web") {
        const returnUrl = `${window.location.origin}/profile/topup?checkout=1`;
        const result = await startCheckout({
          provider: selectedProvider as WebProvider,
          product_id: offer.product_id,
          return_url: returnUrl,
        });
        window.sessionStorage.setItem(
          CHECKOUT_INTENT_STORAGE_KEY,
          result.payment_intent_id,
        );
        window.location.assign(result.checkout_url);
        return;
      }

      const iapProvider = iapProviderForSurface(surface);
      if (!iapProvider) {
        setError(t("iapUnavailable"));
        return;
      }
      const receipt = await purchaseIapPack({
        provider: iapProvider,
        product_id: offer.product_id,
      });
      const grant = await verifyIap({
        provider: receipt.provider,
        product_id: receipt.product_id,
        receipt_data: receipt.receipt_data,
        purchase_token: receipt.purchase_token,
        package_name: receipt.package_name,
      });
      onIapSuccess(grant);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code ?? "")
          : "";
      if (code === "iap_unavailable") {
        setError(t("iapUnavailable"));
      } else {
        setError(t("payFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!offer) {
    return (
      <section className={styles.panel} data-testid="topup-checkout">
        <h2 className={styles.title}>{t("checkoutTitle")}</h2>
        <p className={styles.lead}>{t("selectPackFirst")}</p>
      </section>
    );
  }

  if (available.length === 0) {
    return (
      <section className={styles.panel} data-testid="topup-checkout">
        <h2 className={styles.title}>{t("checkoutTitle")}</h2>
        <p className={styles.lead}>{t("noProviders")}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} data-testid="topup-checkout">
      <h2 className={styles.title}>{t("checkoutTitle")}</h2>
      <p className={styles.lead}>
        {surface === "web" ? t("checkoutLeadWeb") : t("checkoutLeadNative")}
      </p>

      {surface === "web" ? (
        <div className={styles.providers} role="group" aria-label={t("providersAria")}>
          {webProviders.map((p) => {
            const selected = p === selectedProvider;
            const labelKey = PROVIDER_LABEL_KEYS[p] ?? p;
            return (
              <button
                key={p}
                type="button"
                className={
                  selected
                    ? `${styles.provider} ${styles.providerSelected}`
                    : styles.provider
                }
                aria-pressed={selected}
                data-testid={`topup-provider-${p}`}
                onClick={() => setProvider(p)}
              >
                {t(labelKey as "providerIyzico")}
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        className={styles.pay}
        data-testid="topup-pay"
        disabled={busy || !selectedProvider}
        onClick={() => void handlePay()}
      >
        {busy ? t("paying") : t("pay")}
      </button>

      <p className={styles.hint}>{t("hostedHint")}</p>
      {error ? (
        <p className={styles.error} data-testid="topup-checkout-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
