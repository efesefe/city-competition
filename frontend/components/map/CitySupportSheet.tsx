"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { useConquest } from "@/context/ConquestContext";
import { useWallet } from "@/context/WalletContext";
import { listDerbies } from "@/lib/derbies-api";
import {
  clampCredits,
  defaultChipAmount,
  isDerbiBonusActive,
  mapSupportErrorKey,
  ownershipBarSegments,
  submitSupportOptimistic,
  SUPPORT_CHIPS,
} from "@/lib/map/supportSubmit";
import {
  NEUTRAL_TRIBE_COLOR,
  tribeAccentColor,
  tribeCrestInitial,
} from "@/lib/tribeCrest";
import { fetchWalletBalance } from "@/lib/wallet-api";
import styles from "./CitySupportSheet.module.css";

type CitySupportSheetProps = {
  ilCode: string | null;
  onClose: () => void;
};

export default function CitySupportSheet({
  ilCode,
  onClose,
}: CitySupportSheetProps) {
  const t = useTranslations("map");
  const tSheet = useTranslations("map.sheet");
  const tErrors = useTranslations("map.errors");
  const { getCity, tribesById, applySupportDelta, registerPendingSupport, consumePendingSupport } =
    useCityData();
  const {
    balance,
    tribeId,
    applyOptimisticDelta,
    reconcileBalance,
  } = useWallet();
  const { reportOwnSupport } = useConquest();

  const city = ilCode ? getCity(ilCode) : undefined;
  const open = Boolean(ilCode && city);

  const [amount, setAmount] = useState(10);
  const [manualRaw, setManualRaw] = useState("10");
  const [clampedWarn, setClampedWarn] = useState(false);
  const [derbiActive, setDerbiActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !ilCode) {
      return;
    }
    const next = defaultChipAmount(balance);
    setAmount(next);
    setManualRaw(String(next || ""));
    setClampedWarn(false);
    setMessage(null);
    setError(null);
    setBusy(false);
  }, [open, ilCode]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on city open only

  useEffect(() => {
    if (!open || amount > 0 || balance < 1) {
      return;
    }
    const next = defaultChipAmount(balance);
    if (next < 1) {
      return;
    }
    setAmount(next);
    setManualRaw(String(next));
  }, [open, amount, balance]);

  useEffect(() => {
    if (!open || !ilCode || !tribeId) {
      setDerbiActive(false);
      return;
    }
    let cancelled = false;
    void listDerbies()
      .then((res) => {
        if (cancelled) return;
        setDerbiActive(isDerbiBonusActive(res.derbies, ilCode, tribeId));
      })
      .catch(() => {
        if (!cancelled) setDerbiActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ilCode, tribeId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const colorByTribe = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, tr] of Object.entries(tribesById)) {
      map[id] = tribeAccentColor(tr);
    }
    return map;
  }, [tribesById]);

  const segments = useMemo(
    () =>
      ownershipBarSegments(
        city?.competing_tribes ?? [],
        colorByTribe,
        NEUTRAL_TRIBE_COLOR,
      ),
    [city?.competing_tribes, colorByTribe],
  );

  const controlling = city?.controlling_tribe?.tribe_id
    ? tribesById[city.controlling_tribe.tribe_id]
    : null;
  const controllingColor = tribeAccentColor(
    controlling ??
      (city?.controlling_tribe?.primary_color
        ? { primary_color: city.controlling_tribe.primary_color }
        : null),
  );

  const validAmount = clampCredits(amount, balance);
  const canSubmit =
    Boolean(ilCode && tribeId && validAmount >= 1 && !busy);

  function applyManual(raw: string) {
    setManualRaw(raw);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setAmount(0);
      setClampedWarn(false);
      return;
    }
    if (parsed > balance) {
      setAmount(clampCredits(parsed, balance));
      setClampedWarn(true);
      return;
    }
    setAmount(clampCredits(parsed, balance));
    setClampedWarn(false);
  }

  async function onConfirm() {
    if (!ilCode || !tribeId || !canSubmit) {
      return;
    }
    const credits = validAmount;
    setBusy(true);
    setError(null);
    setMessage(null);
    const outcome = await submitSupportOptimistic(
      { ilCode, tribeId, credits, derbiActive },
      {
        applyOptimisticDelta,
        reconcileBalance,
        applySupportDelta,
        registerPendingSupport,
        consumePendingSupport,
        fetchWalletBalance,
      },
    );
    setBusy(false);
    if (outcome.ok) {
      reportOwnSupport(outcome.result, { cityName: city?.name });
      setMessage(
        t("supported", {
          province: city?.name ?? ilCode,
          credits: outcome.result.credits_spent,
          balance: outcome.result.balance_after,
        }),
      );
      return;
    }
    const key = mapSupportErrorKey(outcome.code);
    setError(tErrors(key as Parameters<typeof tErrors>[0]));
  }

  if (!open || !city) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-support-title"
        data-testid="city-support-sheet"
      >
        <div className={styles.header}>
          <h2 id="city-support-title" className={styles.title}>
            {city.name}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={tSheet("close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className={styles.ownerRow}>
          {controlling ? (
            <>
              <span
                className={styles.crest}
                style={{ background: controllingColor }}
                aria-hidden
              >
                {tribeCrestInitial(controlling)}
              </span>
              <p className={styles.ownerLabel}>{controlling.display_name}</p>
            </>
          ) : (
            <p className={styles.ownerLabel}>{tSheet("unowned")}</p>
          )}
        </div>

        <div
          className={styles.bar}
          role="img"
          aria-label={tSheet("ownershipBar")}
        >
          {segments.length === 0 ? (
            <div className={styles.barEmpty} />
          ) : (
            segments.map((seg) => (
              <div
                key={seg.tribe_id}
                className={styles.barSegment}
                style={{
                  width: `${Math.max(seg.share * 100, 2)}%`,
                  background: seg.color,
                }}
              />
            ))
          )}
        </div>

        {derbiActive ? (
          <p className={styles.derbi} data-testid="derbi-badge">
            {tSheet("derbiBadge")}
          </p>
        ) : null}

        <div className={styles.chips} role="group" aria-label={tSheet("chipsAria")}>
          {SUPPORT_CHIPS.map((chip) => {
            const disabled = chip > balance || busy;
            const active = amount === chip;
            return (
              <button
                key={chip}
                type="button"
                className={`${styles.chip}${active ? ` ${styles.chipActive}` : ""}`}
                disabled={disabled}
                onClick={() => {
                  setAmount(chip);
                  setManualRaw(String(chip));
                  setClampedWarn(false);
                }}
              >
                {chip}
              </button>
            );
          })}
        </div>

        <div className={styles.manual}>
          <label className={styles.label} htmlFor="support-credits">
            {t("credits")}
          </label>
          <input
            id="support-credits"
            className={styles.input}
            type="number"
            min={1}
            step={1}
            value={manualRaw}
            onChange={(e) => applyManual(e.target.value)}
            disabled={busy}
          />
          {clampedWarn ? (
            <p className={styles.clampWarn}>{tSheet("clampWarning")}</p>
          ) : null}
        </div>

        <p className={styles.remaining}>
          {tSheet("remaining", {
            n: Math.max(0, Math.floor(balance) - validAmount),
          })}
        </p>

        <button
          type="button"
          className={styles.confirm}
          disabled={!canSubmit}
          onClick={() => void onConfirm()}
          data-testid="support-confirm"
        >
          {busy ? t("supporting") : t("support")}
        </button>

        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </div>
  );
}
