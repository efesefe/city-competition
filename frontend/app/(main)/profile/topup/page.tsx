"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import CheckoutPanel from "@/components/topup/CheckoutPanel";
import PackageGrid from "@/components/topup/PackageGrid";
import { useWallet } from "@/context/WalletContext";
import { groupPackOffers, formatKurusBreakdown } from "@/lib/packOffers";
import {
  CHECKOUT_INTENT_STORAGE_KEY,
  fetchCheckoutStatus,
  fetchCreditPacks,
  fetchInvoice,
  simulateIyzicoSuccess,
  type GrantResult,
  type InvoiceResponse,
} from "@/lib/topup-api";
import styles from "./topup.module.css";

type SuccessState = {
  creditsGranted: number;
  balanceAfter?: number;
  invoiceId?: string;
};

const creditFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

const showSimulate =
  process.env.NEXT_PUBLIC_DEV_QA_PANEL === "true" ||
  process.env.NODE_ENV === "development";

function ProfileTopupInner() {
  const t = useTranslations("profile.topup");
  const searchParams = useSearchParams();
  const { refetch, reconcileBalance } = useWallet();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [packsRaw, setPacksRaw] = useState<
    Awaited<ReturnType<typeof fetchCreditPacks>>["packs"]
  >([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [returnPending, setReturnPending] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const offers = useMemo(() => groupPackOffers(packsRaw), [packsRaw]);
  const selectedOffer =
    offers.find((o) => o.product_id === selectedProductId) ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetchCreditPacks();
        if (cancelled) return;
        setPacksRaw(res.packs);
        const grouped = groupPackOffers(res.packs);
        if (grouped[0]) {
          setSelectedProductId((prev) => prev ?? grouped[0].product_id);
        }
      } catch {
        if (!cancelled) setLoadError(t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const finishSuccess = useCallback(
    async (state: SuccessState) => {
      if (typeof state.balanceAfter === "number") {
        reconcileBalance(state.balanceAfter);
      }
      await refetch();
      setSuccess(state);
    },
    [reconcileBalance, refetch],
  );

  useEffect(() => {
    if (searchParams.get("checkout") !== "1") return;
    const intentId =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem(CHECKOUT_INTENT_STORAGE_KEY)
        : null;
    if (!intentId) {
      setReturnError(t("returnMissingIntent"));
      return;
    }

    setPendingIntentId(intentId);

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12;

    setReturnPending(true);
    setReturnError(null);

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        attempts += 1;
        try {
          const status = await fetchCheckoutStatus(intentId);
          if (cancelled) return;
          if (status.status === "succeeded") {
            window.sessionStorage.removeItem(CHECKOUT_INTENT_STORAGE_KEY);
            setReturnPending(false);
            await finishSuccess({
              creditsGranted: status.credits_granted ?? 0,
              balanceAfter: status.balance_after,
              invoiceId: status.invoice_id,
            });
            return;
          }
        } catch {
          // keep polling briefly; webhooks may lag
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) {
        setReturnPending(false);
        setReturnError(t("returnPendingTimeout"));
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [searchParams, finishSuccess, t]);

  async function handleSimulateSuccess() {
    const intentId =
      pendingIntentId ??
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem(CHECKOUT_INTENT_STORAGE_KEY)
        : null);
    if (!intentId) return;
    setSimBusy(true);
    setReturnError(null);
    try {
      await simulateIyzicoSuccess(intentId);
      const status = await fetchCheckoutStatus(intentId);
      if (status.status === "succeeded") {
        window.sessionStorage.removeItem(CHECKOUT_INTENT_STORAGE_KEY);
        setReturnPending(false);
        await finishSuccess({
          creditsGranted: status.credits_granted ?? 0,
          balanceAfter: status.balance_after,
          invoiceId: status.invoice_id,
        });
      } else {
        setReturnError(t("returnPendingTimeout"));
      }
    } catch {
      setReturnError(t("simulateFailed"));
    } finally {
      setSimBusy(false);
    }
  }

  async function handleIapSuccess(grant: GrantResult) {
    await finishSuccess({
      creditsGranted: grant.credits_granted,
      balanceAfter: grant.balance_after,
      invoiceId: grant.invoice_id,
    });
  }

  async function openInvoice() {
    if (!success?.invoiceId) return;
    setInvoiceError(null);
    if (invoice?.id === success.invoiceId) {
      setInvoiceOpen(true);
      return;
    }
    try {
      const inv = await fetchInvoice(success.invoiceId);
      setInvoice(inv);
      setInvoiceOpen(true);
    } catch {
      setInvoiceError(t("invoiceFailed"));
    }
  }

  if (success) {
    return (
      <main className={styles.page} data-testid="profile-topup-screen">
        <section className={styles.success} data-testid="topup-success">
          <h1 className={styles.successTitle}>{t("successTitle")}</h1>
          <p className={styles.successBody}>
            {t("successBody", {
              credits: creditFormatter.format(success.creditsGranted),
            })}
          </p>
          {success.invoiceId ? (
            <button
              type="button"
              className={styles.invoiceLink}
              data-testid="topup-invoice-link"
              onClick={() => void openInvoice()}
            >
              {t("viewInvoice")}
            </button>
          ) : null}
          {invoiceError ? (
            <p className={styles.error}>{invoiceError}</p>
          ) : null}
          {invoiceOpen && invoice ? (
            <div className={styles.invoice} data-testid="topup-invoice">
              <p className={styles.invoiceRow}>
                <span>{t("invoiceNet")}</span>
                <strong>{formatKurusBreakdown(invoice.net_kurus)}</strong>
              </p>
              <p className={styles.invoiceRow}>
                <span>
                  {t("invoiceTax", {
                    rate: (invoice.kdv_rate_bps / 100).toFixed(0),
                  })}
                </span>
                <strong>{formatKurusBreakdown(invoice.tax_kurus)}</strong>
              </p>
              <p className={styles.invoiceRow}>
                <span>{t("invoiceGross")}</span>
                <strong>{formatKurusBreakdown(invoice.gross_kurus)}</strong>
              </p>
            </div>
          ) : null}
          <Link
            href="/profile"
            className={styles.done}
            data-testid="topup-done"
          >
            {t("done")}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} data-testid="profile-topup-screen">
      <h1 className={styles.title}>{t("title")}</h1>
      <p className={styles.lead}>{t("lead")}</p>

      {returnPending ? (
        <p className={styles.status} data-testid="topup-return-pending">
          {t("confirming")}
        </p>
      ) : null}
      {returnError ? (
        <p className={styles.error} data-testid="topup-return-error">
          {returnError}
        </p>
      ) : null}
      {showSimulate && (returnError || returnPending) && pendingIntentId ? (
        <button
          type="button"
          className={styles.done}
          disabled={simBusy}
          data-testid="topup-simulate-success"
          onClick={() => void handleSimulateSuccess()}
        >
          {t("simulateSuccess")}
        </button>
      ) : null}

      {loading ? (
        <p className={styles.status}>{t("loading")}</p>
      ) : loadError ? (
        <p className={styles.error} data-testid="topup-load-error">
          {loadError}
        </p>
      ) : offers.length === 0 ? (
        <p className={styles.status}>{t("empty")}</p>
      ) : (
        <>
          <PackageGrid
            offers={offers}
            selectedProductId={selectedProductId}
            onSelect={setSelectedProductId}
          />
          <CheckoutPanel
            offer={selectedOffer}
            onIapSuccess={(grant) => void handleIapSuccess(grant)}
          />
        </>
      )}

      <Link href="/profile" className={styles.back}>
        {t("back")}
      </Link>
    </main>
  );
}

export default function ProfileTopupPage() {
  return (
    <Suspense
      fallback={
        <main
          className={styles.page}
          data-testid="profile-topup-screen"
          aria-busy="true"
        />
      }
    >
      <ProfileTopupInner />
    </Suspense>
  );
}
