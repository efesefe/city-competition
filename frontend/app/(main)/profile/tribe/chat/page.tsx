"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import shellStyles from "@/components/shell/shell.module.css";

/** Stub until Track G tribe chat lands. */
export default function TribeChatStubPage() {
  const t = useTranslations("profile");
  const tShell = useTranslations("shell");

  return (
    <main className={shellStyles.placeholder} data-testid="tribe-chat-stub">
      <h1 className={shellStyles.placeholderTitle}>{t("tribeChat")}</h1>
      <p className={shellStyles.placeholderLead}>{tShell("comingSoon")}</p>
      <p>
        <Link href="/profile">{t("title")}</Link>
      </p>
    </main>
  );
}
