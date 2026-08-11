"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import shellStyles from "@/components/shell/shell.module.css";

export default function ProfileTopupPage() {
  const t = useTranslations("profile.topup");
  const tShell = useTranslations("shell");

  return (
    <main className={shellStyles.placeholder} data-testid="profile-topup-screen">
      <h1 className={shellStyles.placeholderTitle}>{t("title")}</h1>
      <p className={shellStyles.placeholderLead}>{t("lead")}</p>
      <p className={shellStyles.placeholderLead}>{tShell("comingSoon")}</p>
      <p>
        <Link href="/profile">{t("back")}</Link>
      </p>
    </main>
  );
}
