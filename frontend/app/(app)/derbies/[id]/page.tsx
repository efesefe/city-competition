"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { Derby, getDerby } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import styles from "../derbies.module.css";

export default function DerbyDetailPage() {
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
        setError(code === "derby_not_found" ? "Derbi bulunamadı." : "Derbi yüklenemedi.");
      })
      .finally(() => setLoading(false));
  }, [load, router]);

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.lead}>Yükleniyor…</p>
      </main>
    );
  }

  return (
    <>
      <DataResidencyBanner />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.brand}>City Competition</p>
          <h1 className={styles.title}>Derbi detayı</h1>
          <p className={styles.lead}>
            <Link href="/derbies">← Tüm derbiler</Link>
          </p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {derby ? (
          <div className={styles.detail}>
            <dl>
              <dt>Durum</dt>
              <dd>{derby.status}</dd>
              <dt>İl</dt>
              <dd>{derby.il_code}</dd>
              <dt>Ev sahibi</dt>
              <dd>{derby.host_tribe_id}</dd>
              <dt>Deplasman</dt>
              <dd>{derby.guest_tribe_id}</dd>
              <dt>Başlangıç</dt>
              <dd>{new Date(derby.starts_at).toLocaleString("tr-TR")}</dd>
              <dt>Bitiş</dt>
              <dd>{new Date(derby.ends_at).toLocaleString("tr-TR")}</dd>
              <dt>Ev skor</dt>
              <dd>{derby.host_effective_total}</dd>
              <dt>Dep skor</dt>
              <dd>{derby.guest_effective_total}</dd>
            </dl>
          </div>
        ) : null}
      </main>
    </>
  );
}
