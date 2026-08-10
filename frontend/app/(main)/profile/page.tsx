"use client";

import { useTranslations } from "next-intl";
import shellStyles from "@/components/shell/shell.module.css";

export default function ProfilePage() {
  const t = useTranslations("shell");
  return (
    <main className={shellStyles.placeholder} data-testid="profile-screen">
      <h1 className={shellStyles.placeholderTitle}>{t("tabProfile")}</h1>
      <p className={shellStyles.placeholderLead}>{t("comingSoon")}</p>
    </main>
  );
}
