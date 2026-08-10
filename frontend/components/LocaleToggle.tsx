"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { localeCookieName, type Locale } from "@/i18n/config";
import styles from "./LocaleToggle.module.css";

export default function LocaleToggle() {
  const locale = useLocale() as Locale;
  const router = useRouter();

  function setLocale(next: Locale) {
    document.cookie = `${localeCookieName}=${next};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }

  return (
    <div className={styles.root} role="group" aria-label="Language">
      <button
        type="button"
        className={locale === "tr" ? styles.active : styles.btn}
        onClick={() => setLocale("tr")}
        lang="tr"
      >
        TR
      </button>
      <button
        type="button"
        className={locale === "en" ? styles.active : styles.btn}
        onClick={() => setLocale("en")}
        lang="en"
      >
        EN
      </button>
    </div>
  );
}
