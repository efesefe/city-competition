"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Derby, DerbyStandings } from "@/lib/derbies-api";
import type { Tribe } from "@/lib/tribes-api";
import { formatRemaining } from "@/lib/leaderboardVisibility";
import { tribeAccentColor, tribeCrestInitial } from "@/lib/tribeCrest";
import styles from "./DerbiScoreboard.module.css";

type Props = {
  derby: Derby;
  standings: DerbyStandings | null;
  hostTribe: Tribe | null;
  guestTribe: Tribe | null;
  cityName: string;
  loading: boolean;
  error: string | null;
};

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function DerbiScoreboard({
  derby,
  standings,
  hostTribe,
  guestTribe,
  cityName,
  loading,
  error,
}: Props) {
  const t = useTranslations("leaderboard");
  const [now, setNow] = useState(() => Date.now());

  const status = standings?.status ?? derby.status;
  const hostScore =
    standings?.host_effective_total ?? derby.host_effective_total;
  const guestScore =
    standings?.guest_effective_total ?? derby.guest_effective_total;
  const total = Math.max(0, hostScore) + Math.max(0, guestScore);
  const hostShare = total > 0 ? Math.max(0, hostScore) / total : 0.5;
  const guestShare = total > 0 ? Math.max(0, guestScore) / total : 0.5;

  const hostAccent = tribeAccentColor(hostTribe);
  const guestAccent = tribeAccentColor(guestTribe);
  const hostName = hostTribe?.display_name ?? t("host");
  const guestName = guestTribe?.display_name ?? t("guest");
  const ended = status === "resolved";
  const endsAt = Date.parse(derby.ends_at);
  const remainingMs = Number.isNaN(endsAt) ? 0 : endsAt - now;

  useEffect(() => {
    if (ended) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ended]);

  const remaining = formatRemaining(remainingMs);

  return (
    <section className={styles.section} data-testid="derbi-scoreboard">
      {loading ? (
        <p className={styles.message}>{t("loading")}</p>
      ) : null}
      {error ? (
        <p className={styles.error} data-testid="derbi-scoreboard-error">
          {error}
        </p>
      ) : null}

      <p className={styles.city} data-testid="derbi-scoreboard-city">
        {cityName}
      </p>

      <div className={styles.teams}>
        <div className={styles.team}>
          <span
            className={styles.crest}
            style={{ background: hostAccent }}
            aria-hidden
          >
            {hostTribe ? tribeCrestInitial(hostTribe) : "?"}
          </span>
          <span className={styles.teamName}>{hostName}</span>
          <span className={styles.teamScore} data-testid="derbi-host-score">
            {formatScore(hostScore)}
          </span>
        </div>
        <span className={styles.vs} aria-hidden>
          vs
        </span>
        <div className={styles.team}>
          <span
            className={styles.crest}
            style={{ background: guestAccent }}
            aria-hidden
          >
            {guestTribe ? tribeCrestInitial(guestTribe) : "?"}
          </span>
          <span className={styles.teamName}>{guestName}</span>
          <span className={styles.teamScore} data-testid="derbi-guest-score">
            {formatScore(guestScore)}
          </span>
        </div>
      </div>

      <div
        className={styles.bar}
        role="img"
        aria-label={t("scoreBarAria", {
          host: formatScore(hostScore),
          guest: formatScore(guestScore),
        })}
        data-testid="derbi-score-bar"
      >
        <span
          className={styles.barHost}
          style={{
            flexGrow: hostShare,
            background: hostAccent,
          }}
        />
        <span
          className={styles.barGuest}
          style={{
            flexGrow: guestShare,
            background: guestAccent,
          }}
        />
      </div>

      {ended ? (
        <p className={styles.status} data-testid="derbi-ended">
          {t("ended")}
        </p>
      ) : (
        <p className={styles.status} data-testid="derbi-remaining">
          {t("remaining", {
            hours: remaining.hours,
            minutes: String(remaining.minutes).padStart(2, "0"),
            seconds: String(remaining.seconds).padStart(2, "0"),
          })}
        </p>
      )}
    </section>
  );
}
