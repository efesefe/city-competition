"use client";

import { useTranslations } from "next-intl";
import ConquestLogList from "@/components/conquest/ConquestLogList";
import styles from "./conquest-log.module.css";

export default function ConquestLogPage() {
  const t = useTranslations("conquest");

  return (
    <main className={styles.page} data-testid="conquest-log-screen">
      <h1 className={styles.title}>{t("title")}</h1>
      <p className={styles.lead}>{t("lead")}</p>
      <ConquestLogList />
    </main>
  );
}
