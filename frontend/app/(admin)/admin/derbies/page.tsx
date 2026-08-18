"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { formatDateTime } from "@/lib/dateFormat";
import { Derby, forceResolveDerby, listDerbies } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import styles from "@/app/(app)/derbies/derbies.module.css";

function mapError(code: string | undefined): string {
  switch (code) {
    case "error_unauthorized":
      return "Oturum gerekli.";
    case "error_forbidden":
    case "forbidden":
      return "Yalnızca yöneticiler erişebilir.";
    case "error_derby_already_resolved":
      return "Bu derbi zaten sonuçlandı.";
    default:
      return "Bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

export default function AdminDerbiesPage() {
  const router = useRouter();
  const [derbies, setDerbies] = useState<Derby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await listDerbies();
    setDerbies(data.derbies);
  }, []);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7849/ingest/90e13cc2-137a-478d-9a71-0d5b628b18f9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9afaa4'},body:JSON.stringify({sessionId:'9afaa4',runId:'post-fix',hypothesisId:'H-A',location:'admin/derbies/page.tsx:mount',message:'admin derbies list mounted; css module resolved',data:{cssImport:'@/app/(app)/derbies/derbies.module.css'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .catch((e) => {
        const code = (e as { code?: string; status?: number }).code;
        const status = (e as { status?: number }).status;
        if (status === 403) {
          setError(mapError("error_forbidden"));
          return;
        }
        setError(mapError(code));
      })
      .finally(() => setLoading(false));
  }, [load, router]);

  const onForceResolve = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await forceResolveDerby(id);
      await load();
    } catch (e) {
      setError(mapError((e as { code?: string }).code));
    } finally {
      setBusyId(null);
    }
  };

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
          <p className={styles.brand}>City Competition Admin</p>
          <h1 className={styles.title}>Derbi yönetimi</h1>
          <p className={styles.lead}>
            Derbi oluşturun veya aktif/planlı derbileri zorla sonuçlandırın.
          </p>
        </header>

        <div className={styles.actions}>
          <Link className={styles.button} href="/admin/derbies/new">
            Yeni derbi
          </Link>
          <Link className={`${styles.button} ${styles.buttonSecondary}`} href="/derbies">
            Oyuncu listesi
          </Link>
          <Link className={`${styles.button} ${styles.buttonSecondary}`} href="/analytics">
            Analitik
          </Link>
          <Link className={`${styles.button} ${styles.buttonSecondary}`} href="/admin/promos">
            Kredi kampanyaları
          </Link>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <ul className={styles.list}>
          {derbies.map((d) => (
            <li key={d.id} className={styles.item}>
              <div className={styles.row}>
                <p className={styles.name}>İl {d.il_code}</p>
                <span className={styles.status}>{d.status}</span>
              </div>
              <p className={styles.sub}>
                {formatDateTime(d.starts_at)} → {formatDateTime(d.ends_at)}
              </p>
              <p className={styles.scores}>
                Ev {d.host_effective_total} — Dep {d.guest_effective_total}
              </p>
              {d.status !== "resolved" ? (
                <div className={styles.actions} style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    disabled={busyId === d.id}
                    onClick={() => onForceResolve(d.id)}
                  >
                    {busyId === d.id ? "Sonuçlandırılıyor…" : "Zorla sonuçlandır"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
