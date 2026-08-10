"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { Derby, listDerbies } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import styles from "./derbies.module.css";

function formatWindow(d: Derby): string {
  const start = new Date(d.starts_at).toLocaleString("tr-TR");
  const end = new Date(d.ends_at).toLocaleString("tr-TR");
  return `${start} → ${end}`;
}

export default function DerbiesPage() {
  const router = useRouter();
  const [derbies, setDerbies] = useState<Derby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      .catch(() => setError("Derbiler yüklenemedi."))
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
          <h1 className={styles.title}>Derbiler</h1>
          <p className={styles.lead}>
            Kabileler arası maç günü etkinlikleri. Canlı skorlar aktif derbilerde
            güncellenir.
          </p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {derbies.length === 0 ? (
          <p className={styles.lead}>Henüz derbi yok.</p>
        ) : (
          <ul className={styles.list}>
            {derbies.map((d) => (
              <li key={d.id}>
                <Link className={styles.item} href={`/derbies/${d.id}`}>
                  <div className={styles.row}>
                    <p className={styles.name}>İl {d.il_code}</p>
                    <span className={styles.status}>{d.status}</span>
                  </div>
                  <p className={styles.sub}>{formatWindow(d)}</p>
                  <p className={styles.scores}>
                    Ev {d.host_effective_total} — Dep {d.guest_effective_total}
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
