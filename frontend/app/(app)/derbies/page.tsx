"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import LocaleToggle from "@/components/LocaleToggle";
import { formatDateTime } from "@/lib/dateFormat";
import { Derby, listDerbies } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import styles from "./derbies.module.css";

export default function DerbiesPage() {
  const t = useTranslations("derbies");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [derbies, setDerbies] = useState<Derby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function formatWindow(d: Derby): string {
    return t("window", {
      start: formatDateTime(d.starts_at),
      end: formatDateTime(d.ends_at),
    });
  }

  const load = useCallback(async () => {
    const data = await listDerbies();
    setDerbies(data.derbies);
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .catch(() => setError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [load, router, t]);

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.lead}>{tCommon("loading")}</p>
      </main>
    );
  }

  return (
    <>
      <DataResidencyBanner />
      <main className={styles.page}>
        <header className={styles.header}>
          <LocaleToggle />
          <p className={styles.brand}>{tCommon("brand")}</p>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.lead}>{t("lead")}</p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {derbies.length === 0 ? (
          <p className={styles.lead}>{t("empty")}</p>
        ) : (
          <ul className={styles.list}>
            {derbies.map((d) => (
              <li key={d.id}>
                <Link className={styles.item} href={`/derbies/${d.id}`}>
                  <div className={styles.row}>
                    <p className={styles.name}>
                      {t("province", { ilCode: d.il_code })}
                    </p>
                    <span className={styles.status}>{d.status}</span>
                  </div>
                  <p className={styles.sub}>{formatWindow(d)}</p>
                  <p className={styles.scores}>
                    {t("scores", {
                      host: d.host_effective_total,
                      guest: d.guest_effective_total,
                    })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
