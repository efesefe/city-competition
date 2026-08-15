"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Derby } from "@/lib/derbies-api";
import type { Tribe } from "@/lib/tribes-api";
import { formatRemaining } from "@/lib/leaderboardVisibility";
import { tribeAccentColor } from "@/lib/tribeCrest";
import TribeEmblem from "@/components/conquest/TribeEmblem";
import styles from "./DerbiBanner.module.css";

type Props = {
  derby: Derby;
  hostTribe: Tribe | null;
  guestTribe: Tribe | null;
  cityName: string;
  onOpen: () => void;
};

export default function DerbiBanner({
  derby,
  hostTribe,
  guestTribe,
  cityName,
  onOpen,
}: Props) {
  const t = useTranslations("derbiBanner");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const scheduled = derby.status === "scheduled";
  const targetMs = Date.parse(scheduled ? derby.starts_at : derby.ends_at);
  const remainingMs = Number.isNaN(targetMs) ? 0 : targetMs - now;
  const remaining = formatRemaining(remainingMs);
  const countdownKey = scheduled ? "startsIn" : "remaining";

  return (
    <button
      type="button"
      className={styles.banner}
      onClick={onOpen}
      data-testid="derbi-banner"
      aria-label={t("aria", { city: cityName })}
    >
      <span className={styles.crests} aria-hidden>
        <span
          className={styles.crest}
          style={{ background: tribeAccentColor(hostTribe) }}
        >
          <TribeEmblem tribe={hostTribe} empty="?" />
        </span>
        <span className={styles.vs}>vs</span>
        <span
          className={styles.crest}
          style={{ background: tribeAccentColor(guestTribe) }}
        >
          <TribeEmblem tribe={guestTribe} empty="?" />
        </span>
      </span>
      <span className={styles.meta}>
        <span className={styles.city} data-testid="derbi-banner-city">
          {cityName}
        </span>
        <span className={styles.countdown} data-testid="derbi-banner-countdown">
          {t(countdownKey, {
            hours: remaining.hours,
            minutes: String(remaining.minutes).padStart(2, "0"),
            seconds: String(remaining.seconds).padStart(2, "0"),
          })}
        </span>
      </span>
    </button>
  );
}
