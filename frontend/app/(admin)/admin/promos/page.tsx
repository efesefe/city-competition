"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import {
  activateAdminPromo,
  deactivateAdminPromo,
  fetchAdminPromo,
  type AdminPromo,
} from "@/lib/promo-api";
import { getSessionToken } from "@/lib/session";
import styles from "@/app/(app)/derbies/derbies.module.css";

function mapError(code: string | undefined, status?: number): string {
  if (status === 403) return "Yalnızca yöneticiler erişebilir.";
  switch (code) {
    case "error_unauthorized":
      return "Oturum gerekli.";
    case "invalid_promo_percent":
      return "Bonus yüzdesi 1–200 arasında olmalıdır.";
    case "no_active_promo":
      return "Aktif kampanya yok.";
    default:
      return "Bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

export default function AdminPromosPage() {
  const router = useRouter();
  const [promo, setPromo] = useState<AdminPromo | null>(null);
  const [customPercent, setCustomPercent] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchAdminPromo();
    setPromo(data.promo);
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .catch((e) => {
        const status = (e as { status?: number }).status;
        const code = (e as { code?: string }).code;
        setError(mapError(code, status));
      })
      .finally(() => setLoading(false));
  }, [load, router]);

  const activate = async (percent: number) => {
    setError(null);
    setBusy(true);
    try {
      const data = await activateAdminPromo(percent);
      setPromo(data.promo);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const code = (e as { code?: string }).code;
      setError(mapError(code, status));
    } finally {
      setBusy(false);
    }
  };

  const onCustom = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(customPercent, 10);
    await activate(n);
  };

  const onDeactivate = async () => {
    setError(null);
    setBusy(true);
    try {
      await deactivateAdminPromo();
      setPromo(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const code = (e as { code?: string }).code;
      setError(mapError(code, status));
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
          <h1 className={styles.title}>Kredi kampanyaları</h1>
          <p className={styles.lead}>
            Satın almalara ekstra kredi ekleyin. Fiyat değişmez; oyuncu paket
            kredisinin yüzdesi kadar bonus alır.
          </p>
        </header>

        <div className={styles.actions}>
          <Link
            className={`${styles.button} ${styles.buttonSecondary}`}
            href="/moderation"
          >
            Moderasyon
          </Link>
          <Link
            className={`${styles.button} ${styles.buttonSecondary}`}
            href="/admin/derbies"
          >
            Derbi yönetimi
          </Link>
          <Link
            className={`${styles.button} ${styles.buttonSecondary}`}
            href="/analytics"
          >
            Analitik
          </Link>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.form} data-testid="admin-promo-status">
          <p className={styles.lead}>
            {promo
              ? `Aktif kampanya: %${promo.bonus_percent} ekstra kredi.`
              : "Şu anda aktif kampanya yok."}
          </p>
          <div className={styles.actions} style={{ margin: 0 }}>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              data-testid="admin-promo-50"
              onClick={() => void activate(50)}
            >
              +%50
            </button>
            {promo ? (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                disabled={busy}
                data-testid="admin-promo-off"
                onClick={() => void onDeactivate()}
              >
                Kapat
              </button>
            ) : null}
          </div>
          <form onSubmit={(e) => void onCustom(e)}>
            <label className={styles.label}>
              Özel yüzde (1–200)
              <input
                className={styles.input}
                type="number"
                min={1}
                max={200}
                step={1}
                value={customPercent}
                data-testid="admin-promo-custom"
                onChange={(e) => setCustomPercent(e.target.value)}
              />
            </label>
            <div className={styles.actions} style={{ margin: "0.75rem 0 0" }}>
              <button
                type="submit"
                className={styles.button}
                disabled={busy}
                data-testid="admin-promo-custom-submit"
              >
                Kampanyayı aç
              </button>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
