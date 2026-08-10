"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { createDerby } from "@/lib/derbies-api";
import { getSessionToken } from "@/lib/session";
import { listTribes, Tribe } from "@/lib/tribes-api";
import styles from "@/app/(app)/derbies/derbies.module.css";

function mapError(code: string | undefined, status?: number): string {
  if (status === 403) return "Yalnızca yöneticiler derbi oluşturabilir.";
  switch (code) {
    case "error_derby_same_tribe":
      return "Ev sahibi ve deplasman kabileleri farklı olmalıdır.";
    case "error_derby_invalid_window":
      return "Bitiş zamanı başlangıçtan sonra olmalıdır.";
    case "invalid_il_code":
      return "Geçersiz il kodu.";
    case "tribe_inactive":
    case "tribe_not_found":
      return "Seçilen kabileler aktif olmalıdır.";
    case "error_unauthorized":
      return "Oturum gerekli.";
    default:
      return "Derbi oluşturulamadı.";
  }
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminNewDerbyPage() {
  const router = useRouter();
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [hostTribeId, setHostTribeId] = useState("");
  const [guestTribeId, setGuestTribeId] = useState("");
  const [ilCode, setIlCode] = useState("34");
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000)),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7849/ingest/90e13cc2-137a-478d-9a71-0d5b628b18f9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9afaa4'},body:JSON.stringify({sessionId:'9afaa4',runId:'post-fix',hypothesisId:'H-A',location:'admin/derbies/new/page.tsx:mount',message:'admin new derby page mounted; css module resolved',data:{cssImport:'@/app/(app)/derbies/derbies.module.css'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    listTribes()
      .then((data) => {
        setTribes(data.tribes);
        if (data.tribes[0]) setHostTribeId(data.tribes[0].id);
        if (data.tribes[1]) setGuestTribeId(data.tribes[1].id);
      })
      .catch(() => setError("Kabileler yüklenemedi."))
      .finally(() => setLoading(false));
  }, [router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const derby = await createDerby({
        host_tribe_id: hostTribeId,
        guest_tribe_id: guestTribeId,
        il_code: ilCode,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
      });
      router.replace(`/derbies/${derby.id}`);
    } catch (err) {
      const e2 = err as { code?: string; status?: number };
      setError(mapError(e2.code, e2.status));
    } finally {
      setBusy(false);
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
          <h1 className={styles.title}>Yeni derbi</h1>
          <p className={styles.lead}>
            <Link href="/admin/derbies">← Derbi listesi</Link>
          </p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            Ev sahibi kabile
            <select
              className={styles.select}
              value={hostTribeId}
              onChange={(e) => setHostTribeId(e.target.value)}
              required
            >
              {tribes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            Deplasman kabile
            <select
              className={styles.select}
              value={guestTribeId}
              onChange={(e) => setGuestTribeId(e.target.value)}
              required
            >
              {tribes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            İl kodu
            <input
              className={styles.input}
              value={ilCode}
              onChange={(e) => setIlCode(e.target.value)}
              pattern="[0-9]{2}"
              maxLength={2}
              required
            />
          </label>

          <label className={styles.label}>
            Başlangıç
            <input
              className={styles.input}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
          </label>

          <label className={styles.label}>
            Bitiş
            <input
              className={styles.input}
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
            />
          </label>

          <button className={styles.button} type="submit" disabled={busy}>
            {busy ? "Oluşturuluyor…" : "Derbi oluştur"}
          </button>
        </form>
      </main>
    </>
  );
}
