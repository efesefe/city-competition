"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AnalyticsHeatmap from "@/components/AnalyticsHeatmap";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import {
  CohortDay,
  FunnelDay,
  HeatmapProvince,
  fetchCohorts,
  fetchFunnel,
  fetchHeatmap,
} from "@/lib/analytics-api";
import { getSessionToken } from "@/lib/session";
import derbyStyles from "@/app/(app)/derbies/derbies.module.css";
import styles from "./analytics.module.css";

function mapError(code: string | undefined): string {
  switch (code) {
    case "error_unauthorized":
      return "Oturum gerekli.";
    case "error_forbidden":
    case "forbidden":
      return "Yalnızca yöneticiler erişebilir.";
    default:
      return "Bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function sumFunnel(days: FunnelDay[]) {
  return days.reduce(
    (acc, d) => ({
      installs: acc.installs + d.installs,
      consented: acc.consented + d.consented,
      joined_tribe: acc.joined_tribe + d.joined_tribe,
      first_support: acc.first_support + d.first_support,
      retained_d7: acc.retained_d7 + d.retained_d7,
    }),
    {
      installs: 0,
      consented: 0,
      joined_tribe: 0,
      first_support: 0,
      retained_d7: 0,
    },
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [funnelDays, setFunnelDays] = useState<FunnelDay[]>([]);
  const [cohorts, setCohorts] = useState<CohortDay[]>([]);
  const [provinces, setProvinces] = useState<HeatmapProvince[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [funnelData, cohortData, heatData] = await Promise.all([
      fetchFunnel(),
      fetchCohorts(),
      fetchHeatmap(),
    ]);
    setFunnelDays(funnelData.days);
    setCohorts(cohortData.cohorts);
    setProvinces(heatData.provinces);
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    setLoading(true);
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

  const funnelTotals = useMemo(() => sumFunnel(funnelDays), [funnelDays]);
  const funnelStages = useMemo(() => {
    const base = Math.max(funnelTotals.installs, 1);
    return [
      { key: "install", label: "Kurulum", value: funnelTotals.installs },
      { key: "consent", label: "Onay / ToS", value: funnelTotals.consented },
      { key: "tribe", label: "Kabile", value: funnelTotals.joined_tribe },
      {
        key: "support",
        label: "İlk destek",
        value: funnelTotals.first_support,
      },
      { key: "d7", label: "D7", value: funnelTotals.retained_d7 },
    ].map((s) => ({
      ...s,
      width: Math.max(2, (s.value / base) * 100),
    }));
  }, [funnelTotals]);

  if (loading) {
    return (
      <main className={derbyStyles.page} aria-busy="true">
        <p className={derbyStyles.lead}>Yükleniyor…</p>
      </main>
    );
  }

  return (
    <>
      <DataResidencyBanner />
      <main className={derbyStyles.page}>
        <header className={derbyStyles.header}>
          <p className={derbyStyles.brand}>City Competition Admin</p>
          <h1 className={derbyStyles.title}>Analitik</h1>
          <p className={derbyStyles.lead}>
            Anonim funnel, kohort tutma ve il destek ısı haritası (özet tablolar).
          </p>
        </header>

        <div className={derbyStyles.actions}>
          <Link
            className={`${derbyStyles.button} ${derbyStyles.buttonSecondary}`}
            href="/moderation"
          >
            Moderasyon
          </Link>
          <Link
            className={`${derbyStyles.button} ${derbyStyles.buttonSecondary}`}
            href="/admin/derbies"
          >
            Derbi yönetimi
          </Link>
          <Link
            className={`${derbyStyles.button} ${derbyStyles.buttonSecondary}`}
            href="/admin/promos"
          >
            Kredi kampanyaları
          </Link>
        </div>

        {error ? <p className={derbyStyles.error}>{error}</p> : null}

        <section className={styles.sectionNarrow}>
          <h2 className={styles.sectionTitle}>Funnel</h2>
          <p className={styles.sectionLead}>
            Kurulum → onay → kabile → ilk destek → D7 (son 30 gün toplamı).
          </p>
          {funnelTotals.installs === 0 ? (
            <p className={styles.empty}>Henüz funnel verisi yok.</p>
          ) : (
            <div className={styles.funnel}>
              {funnelStages.map((stage) => (
                <div key={stage.key} className={styles.funnelRow}>
                  <p className={styles.funnelLabel}>{stage.label}</p>
                  <div className={styles.funnelTrack}>
                    <div
                      className={styles.funnelFill}
                      style={{ width: `${stage.width}%` }}
                    />
                  </div>
                  <p className={styles.funnelValue}>{stage.value}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.sectionNarrow}>
          <h2 className={styles.sectionTitle}>Kohort tutma</h2>
          <p className={styles.sectionLead}>
            Kurulum gününe göre D1 / D7 / D30 anonim tutma oranları.
          </p>
          {cohorts.length === 0 ? (
            <p className={styles.empty}>Henüz kohort verisi yok.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Kohort</th>
                  <th>Boyut</th>
                  <th>D1</th>
                  <th>D7</th>
                  <th>D30</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={dateKey(c.cohort_day)}>
                    <td>{dateKey(c.cohort_day)}</td>
                    <td>{c.cohort_size}</td>
                    <td>
                      {c.retained_d1} ({pct(c.retained_d1, c.cohort_size)}%)
                    </td>
                    <td>
                      {c.retained_d7} ({pct(c.retained_d7, c.cohort_size)}%)
                    </td>
                    <td>
                      {c.retained_d30} ({pct(c.retained_d30, c.cohort_size)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>İl destek ısı haritası</h2>
          <p className={styles.sectionLead}>
            province_control_summary ve tribe_province_scores özetleri.
          </p>
          <AnalyticsHeatmap provinces={provinces} />
        </section>
      </main>
    </>
  );
}
