"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import SettingsSection from "@/components/profile/SettingsSection";
import SupportHistoryList from "@/components/profile/SupportHistoryList";
import TribeBadge from "@/components/profile/TribeBadge";
import WalletSummary from "@/components/profile/WalletSummary";
import { isRestrictedMode } from "@/lib/session";
import styles from "@/components/profile/ProfilePage.module.css";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const [restricted, setRestricted] = useState(false);

  useEffect(() => {
    setRestricted(isRestrictedMode());
  }, []);

  return (
    <main className={styles.page} data-testid="profile-screen">
      <h1 className={styles.title}>{t("title")}</h1>
      {restricted ? (
        <p className={styles.restricted} data-testid="profile-restricted-banner">
          {t("restrictedBanner")}
        </p>
      ) : null}
      <TribeBadge />
      <WalletSummary />
      {!restricted ? (
        <Link
          href="/profile/tribe/chat"
          className={styles.chatLink}
          data-testid="profile-tribe-chat"
        >
          {t("tribeChat")}
        </Link>
      ) : null}
      <Link
        href="/conquest-log"
        className={styles.chatLink}
        data-testid="conquest-log-link"
      >
        {t("conquestLog")}
      </Link>
      <SupportHistoryList />
      <SettingsSection />
    </main>
  );
}
