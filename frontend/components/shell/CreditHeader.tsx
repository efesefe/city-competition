"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useWallet } from "@/context/WalletContext";
import { tribeAccentColor, tribeCrestInitial } from "@/lib/tribeCrest";
import styles from "./CreditHeader.module.css";

/** No unread API yet — badge stays hidden until backend lands. */
const UNREAD_COUNT = 0;

const creditFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

export default function CreditHeader() {
  const t = useTranslations("shell");
  const { balance, status, tribe } = useWallet();
  const accent = tribeAccentColor(tribe);
  const initial = tribe ? tribeCrestInitial(tribe) : "?";

  const balanceLabel =
    status === "loading"
      ? t("balanceLoading")
      : t("balance", { balance: creditFormatter.format(Math.round(balance)) });

  return (
    <header className={styles.header} data-testid="credit-header">
      <Link
        href="/profile"
        className={styles.crestBtn}
        style={{ background: accent, borderColor: accent }}
        aria-label={t("crestAria", { tribe: tribe?.display_name ?? "" })}
        data-testid="tribe-crest"
      >
        {initial}
      </Link>
      <p
        className={
          status === "loading"
            ? `${styles.balance} ${styles.balanceMuted}`
            : styles.balance
        }
        data-testid="credit-balance"
      >
        {balanceLabel}
      </p>
      <div className={styles.bellWrap}>
        <button
          type="button"
          className={styles.bell}
          aria-label={t("notificationsAria")}
          data-testid="notification-bell"
        >
          <BellIcon />
        </button>
        {UNREAD_COUNT > 0 ? (
          <span className={styles.badge} data-testid="notification-badge">
            {UNREAD_COUNT > 99 ? "99+" : UNREAD_COUNT}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
