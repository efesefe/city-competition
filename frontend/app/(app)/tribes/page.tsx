"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { getSessionToken } from "@/lib/session";
import {
  hasTribeMembership,
  joinTribe,
  listTribes,
  switchTribe,
  Tribe,
  TribeMembership,
} from "@/lib/tribes-api";
import styles from "./tribes.module.css";

function mapError(code: string | undefined): string {
  switch (code) {
    case "tribe_switch_cooldown":
      return "Kabile değiştirme bekleme süresindesiniz. Daha sonra tekrar deneyin.";
    case "already_in_tribe":
      return "Zaten bir kabiledesiniz. Değiştirmek için geçiş kullanın.";
    case "tribe_not_found":
      return "Kabile bulunamadı.";
    case "error_unauthorized":
      return "Oturum gerekli.";
    default:
      return "Bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

function formatSwitchHint(membership: TribeMembership): string | null {
  if (!membership.switch_available_at) return null;
  const at = new Date(membership.switch_available_at);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
  return `Sonraki kabile değişikliği: ${at.toLocaleString("tr-TR")}`;
}

export default function TribesPage() {
  const router = useRouter();
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [membership, setMembership] = useState<TribeMembership | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await listTribes();
    setTribes(data.tribes);
    setMembership(data.membership);
    return data;
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .catch(() => setError("Kabileler yüklenemedi."))
      .finally(() => setLoading(false));
  }, [load, router]);

  const onSelect = async (tribe: Tribe) => {
    setError(null);
    setBusyId(tribe.id);
    try {
      if (!hasTribeMembership(membership)) {
        await joinTribe(tribe.id);
        router.replace("/");
        return;
      }
      if (membership?.tribe_id === tribe.id) {
        router.replace("/");
        return;
      }
      await switchTribe(tribe.id);
      router.replace("/");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(mapError(code));
      try {
        await load();
      } catch {
        /* keep prior list */
      }
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

  const switchHint = membership ? formatSwitchHint(membership) : null;
  const hasMembership = hasTribeMembership(membership);

  return (
    <>
      <DataResidencyBanner />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.brand}>City Competition</p>
          <h1 className={styles.title}>
            {hasMembership ? "Kabile değiştir" : "Kabileni seç"}
          </h1>
          <p className={styles.lead}>
            Haritada il desteklemek için bir kabileye katılman gerekir. İsimler
            kurmacadır; gerçek kulüp markaları kullanılmaz.
          </p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}
        {switchHint ? <p className={styles.notice}>{switchHint}</p> : null}

        <ul className={styles.list}>
          {tribes.map((t) => {
            const isCurrent = membership?.tribe_id === t.id;
            return (
              <li key={t.id} className={styles.item}>
                <div
                  className={styles.swatch}
                  style={{
                    background: `linear-gradient(135deg, ${t.primary_color} 50%, ${t.secondary_color} 50%)`,
                  }}
                  aria-hidden
                />
                <div className={styles.meta}>
                  <p className={styles.name}>{t.display_name}</p>
                  <p className={styles.sub}>
                    {t.short_name}
                    {typeof t.member_count === "number"
                      ? ` · ${t.member_count} üye`
                      : ""}
                  </p>
                </div>
                {isCurrent ? (
                  <span className={styles.current}>Senin kabilen</span>
                ) : (
                  <button
                    type="button"
                    className={
                      hasMembership
                        ? `${styles.button} ${styles.buttonSecondary}`
                        : styles.button
                    }
                    disabled={busyId !== null}
                    onClick={() => onSelect(t)}
                  >
                    {busyId === t.id
                      ? "…"
                      : hasMembership
                        ? "Geçiş yap"
                        : "Katıl"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
