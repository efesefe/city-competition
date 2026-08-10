"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import LocaleToggle from "@/components/LocaleToggle";
import { formatDateTime } from "@/lib/dateFormat";
import { Derby, getDerby } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import styles from "../derbies.module.css";

export default function DerbyDetailPage() {
  const t = useTranslations("derbies");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [derby, setDerby] = useState<Derby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await getDerby(params.id);
    setDerby(data);
  }, [params.id]);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .catch((e) => {
        const code = (e as { code?: string }).code;
        setError(
          code === "derby_not_found" ? t("notFound") : t("detailLoadFailed"),
        );
      })
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
          <h1 className={styles.title}>{t("detailTitle")}</h1>
          <p className={styles.lead}>
            <Link href="/derbies">{t("back")}</Link>
          </p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {derby ? (
          <div className={styles.detail}>
            <dl>
              <dt>{t("status")}</dt>
              <dd>{derby.status}</dd>
              <dt>{t("il")}</dt>
              <dd>{derby.il_code}</dd>
              <dt>{t("host")}</dt>
              <dd>{derby.host_tribe_id}</dd>
              <dt>{t("guest")}</dt>
              <dd>{derby.guest_tribe_id}</dd>
              <dt>{t("starts")}</dt>
              <dd>{formatDateTime(derby.starts_at)}</dd>
              <dt>{t("ends")}</dt>
              <dd>{formatDateTime(derby.ends_at)}</dd>
              <dt>{t("hostScore")}</dt>
              <dd>{derby.host_effective_total}</dd>
              <dt>{t("guestScore")}</dt>
              <dd>{derby.guest_effective_total}</dd>
            </dl>
          </div>
        ) : null}
      </main>
    </>
  );
}
