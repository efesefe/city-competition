"use client";

import { useTranslations } from "next-intl";
import DerbiScoreboard from "@/components/leaderboard/DerbiScoreboard";
import type { Derby, DerbyStandings } from "@/lib/derbies-api";
import type { Tribe } from "@/lib/tribes-api";
import styles from "./DerbiScoreboardSheet.module.css";

type Props = {
  open: boolean;
  derby: Derby | null;
  standings: DerbyStandings | null;
  hostTribe: Tribe | null;
  guestTribe: Tribe | null;
  cityName: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

export default function DerbiScoreboardSheet({
  open,
  derby,
  standings,
  hostTribe,
  guestTribe,
  cityName,
  loading,
  error,
  onClose,
}: Props) {
  const t = useTranslations("derbiBanner");
  if (!open || !derby) return null;

  return (
    <>
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t("closeScoreboard")}
        data-testid="derbi-scoreboard-backdrop"
        onClick={onClose}
      />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t("scoreboardTitle")}
        data-testid="derbi-scoreboard-sheet"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{t("scoreboardTitle")}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={t("closeScoreboard")}
            data-testid="derbi-scoreboard-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <DerbiScoreboard
          derby={derby}
          standings={standings}
          hostTribe={hostTribe}
          guestTribe={guestTribe}
          cityName={cityName}
          loading={loading}
          error={error}
        />
      </div>
    </>
  );
}
