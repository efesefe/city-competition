"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import { formatDateTime } from "@/lib/dateFormat";
import {
  Flag,
  Report,
  dismissFlag,
  dismissReport,
  listFlags,
  listReports,
  reviewFlag,
  reviewReport,
} from "@/lib/moderation-api";
import { impersonateUser } from "@/lib/auth-api";
import {
  getSessionToken,
  getUserId,
  isRestrictedMode,
  pushImpersonationStack,
  setSession,
} from "@/lib/session";
import styles from "@/app/(app)/derbies/derbies.module.css";

type QueueStatus = "pending" | "reviewed" | "dismissed";

function mapError(code: string | undefined): string {
  switch (code) {
    case "error_unauthorized":
      return "Oturum gerekli.";
    case "error_forbidden":
    case "forbidden":
      return "Yalnızca yöneticiler erişebilir.";
    case "error_already_resolved":
      return "Bu kayıt zaten işlendi.";
    case "error_not_found":
      return "Kayıt bulunamadı.";
    default:
      return "Bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

export default function ModerationPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [reportStatus, setReportStatus] = useState<QueueStatus>("pending");
  const [flagStatus, setFlagStatus] = useState<QueueStatus>("pending");
  const [contextType, setContextType] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [reportData, flagData] = await Promise.all([
      listReports({
        status: reportStatus,
        context_type: contextType.trim() || undefined,
      }),
      listFlags({
        status: flagStatus,
        reason: flagReason.trim() || undefined,
      }),
    ]);
    setReports(reportData.reports);
    setFlags(flagData.flags);
  }, [reportStatus, flagStatus, contextType, flagReason]);

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

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusyKey(key);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(mapError((e as { code?: string }).code));
    } finally {
      setBusyKey(null);
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
          <h1 className={styles.title}>Moderasyon</h1>
          <p className={styles.lead}>
            Kullanıcı şikayetlerini ve işaretlenen hesapları inceleyin.
          </p>
        </header>

        <div className={styles.actions}>
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
          <Link
            className={`${styles.button} ${styles.buttonSecondary}`}
            href="/admin/promos"
          >
            Kredi kampanyaları
          </Link>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.header} style={{ marginTop: "2rem" }}>
          <h2 className={styles.title} style={{ fontSize: "1.35rem" }}>
            Şikayetler
          </h2>
          <div className={styles.form} style={{ marginTop: "0.75rem" }}>
            <label className={styles.label}>
              Durum
              <select
                className={styles.select}
                value={reportStatus}
                onChange={(e) =>
                  setReportStatus(e.target.value as QueueStatus)
                }
              >
                <option value="pending">pending</option>
                <option value="reviewed">reviewed</option>
                <option value="dismissed">dismissed</option>
              </select>
            </label>
            <label className={styles.label}>
              Tür (context_type)
              <input
                className={styles.input}
                value={contextType}
                onChange={(e) => setContextType(e.target.value)}
                placeholder="örn. dm, tribe_message"
              />
            </label>
          </div>
        </section>

        <ul className={styles.list}>
          {reports.length === 0 ? (
            <li className={styles.item}>
              <p className={styles.sub}>Şikayet yok.</p>
            </li>
          ) : (
            reports.map((r) => (
              <li key={r.id} className={styles.item}>
                <div className={styles.row}>
                  <p className={styles.name}>{r.reason}</p>
                  <span className={styles.status}>{r.status}</span>
                </div>
                <p className={styles.sub}>
                  Şikayet eden {r.reporter_id.slice(0, 8)}… → bildirilen{" "}
                  {r.reported_id.slice(0, 8)}…
                  {r.context_type ? ` · ${r.context_type}` : ""}
                </p>
                <p className={styles.sub}>
                  {formatDateTime(r.created_at)}
                </p>
                {r.status === "pending" ? (
                  <div className={styles.actions} style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busyKey === `report-review-${r.id}`}
                      onClick={() =>
                        runAction(`report-review-${r.id}`, () =>
                          reviewReport(r.id),
                        )
                      }
                    >
                      {busyKey === `report-review-${r.id}`
                        ? "İşleniyor…"
                        : "İncele"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      disabled={busyKey === `report-dismiss-${r.id}`}
                      onClick={() =>
                        runAction(`report-dismiss-${r.id}`, () =>
                          dismissReport(r.id),
                        )
                      }
                    >
                      {busyKey === `report-dismiss-${r.id}`
                        ? "İşleniyor…"
                        : "Reddet"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>

        <section className={styles.header} style={{ marginTop: "2.5rem" }}>
          <h2 className={styles.title} style={{ fontSize: "1.35rem" }}>
            İşaretlenen kullanıcılar
          </h2>
          <div className={styles.form} style={{ marginTop: "0.75rem" }}>
            <label className={styles.label}>
              Durum
              <select
                className={styles.select}
                value={flagStatus}
                onChange={(e) => setFlagStatus(e.target.value as QueueStatus)}
              >
                <option value="pending">pending</option>
                <option value="reviewed">reviewed</option>
                <option value="dismissed">dismissed</option>
              </select>
            </label>
            <label className={styles.label}>
              Tür (reason)
              <input
                className={styles.input}
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                placeholder="örn. referral_same_device"
              />
            </label>
          </div>
        </section>

        <ul className={styles.list}>
          {flags.length === 0 ? (
            <li className={styles.item}>
              <p className={styles.sub}>İşaret yok.</p>
            </li>
          ) : (
            flags.map((f) => (
              <li key={f.id} className={styles.item}>
                <div className={styles.row}>
                  <p className={styles.name}>{f.reason}</p>
                  <span className={styles.status}>{f.status}</span>
                </div>
                <p className={styles.sub}>
                  Kullanıcı {f.user_id.slice(0, 8)}…
                  {f.context_type ? ` · ${f.context_type}` : ""}
                </p>
                <p className={styles.sub}>
                  {formatDateTime(f.created_at)}
                </p>
                <div className={styles.actions} style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    disabled={busyKey === `impersonate-${f.user_id}`}
                    onClick={() =>
                      runAction(`impersonate-${f.user_id}`, async () => {
                        const token = getSessionToken();
                        const uid = getUserId();
                        if (!token || !uid) throw new Error("error_unauthorized");
                        pushImpersonationStack({
                          userId: uid,
                          sessionToken: token,
                          restrictedMode: isRestrictedMode(),
                        });
                        const res = await impersonateUser(f.user_id);
                        setSession(
                          res.user_id,
                          res.session_token,
                          res.restricted_mode,
                        );
                        window.location.assign("/map");
                      })
                    }
                  >
                    {busyKey === `impersonate-${f.user_id}`
                      ? "İşleniyor…"
                      : "Login as"}
                  </button>
                  {f.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={busyKey === `flag-review-${f.id}`}
                        onClick={() =>
                          runAction(`flag-review-${f.id}`, () =>
                            reviewFlag(f.id),
                          )
                        }
                      >
                        {busyKey === `flag-review-${f.id}`
                          ? "İşleniyor…"
                          : "İncele"}
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonSecondary}`}
                        disabled={busyKey === `flag-dismiss-${f.id}`}
                        onClick={() =>
                          runAction(`flag-dismiss-${f.id}`, () =>
                            dismissFlag(f.id),
                          )
                        }
                      >
                        {busyKey === `flag-dismiss-${f.id}`
                          ? "İşleniyor…"
                          : "Reddet"}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </main>
    </>
  );
}
