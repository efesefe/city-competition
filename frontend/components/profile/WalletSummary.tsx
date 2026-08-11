"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useWallet } from "@/context/WalletContext";
import styles from "./WalletSummary.module.css";

const creditFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

export default function WalletSummary() {
  const t = useTranslations("profile.wallet");
  const router = useRouter();
  const { balance, status } = useWallet();

  return (
    <section className={styles.wallet} data-testid="profile-wallet">
      <p className={styles.label}>{t("title")}</p>
      <p
        className={
          status === "loading"
            ? `${styles.balance} ${styles.muted}`
            : styles.balance
        }
        data-testid="profile-wallet-balance"
      >
        {status === "loading"
          ? "…"
          : t("balance", {
              balance: creditFormatter.format(Math.round(balance)),
            })}
      </p>
      <button
        type="button"
        className={styles.topUp}
        onClick={() => router.push("/profile/topup")}
        data-testid="profile-topup"
      >
        {t("topUp")}
      </button>
    </section>
  );
}
