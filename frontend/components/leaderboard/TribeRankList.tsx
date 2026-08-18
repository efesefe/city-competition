"use client";

import { useTranslations } from "next-intl";
import type { Tribe } from "@/lib/tribes-api";
import type { TribeRankBoard, TribeRankEntry } from "@/lib/leaderboard-api";
import { tribeAccentColor } from "@/lib/tribeCrest";
import TribeEmblem from "@/components/conquest/TribeEmblem";
import styles from "./LeaderboardList.module.css";

type Props = {
  board: TribeRankBoard | null;
  loading: boolean;
  error: string | null;
  viewerTribeId: string | null;
};

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "0";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function asTribe(entry: TribeRankEntry): Tribe {
  return {
    id: entry.tribe_id,
    slug: entry.slug,
    display_name: entry.display_name,
    short_name: entry.short_name,
    primary_color: entry.primary_color,
    secondary_color: entry.secondary_color,
    is_active: true,
    created_at: "",
    updated_at: "",
  };
}

export default function TribeRankList({
  board,
  loading,
  error,
  viewerTribeId,
}: Props) {
  const t = useTranslations("leaderboard");
  const entries = board?.entries ?? [];
  const me = board?.me ?? null;
  const showFooter =
    me != null &&
    (viewerTribeId === null ||
      !entries.some((e) => e.tribe_id === viewerTribeId));

  return (
    <section className={styles.section} data-testid="leaderboard-tribe-rank">
      {loading ? (
        <p className={styles.message} data-testid="leaderboard-loading">
          {t("loading")}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} data-testid="leaderboard-error">
          {error}
        </p>
      ) : null}
      {!loading && !error && entries.length === 0 ? (
        <p className={styles.message} data-testid="leaderboard-empty">
          {t("empty")}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <ol className={styles.list}>
          {entries.map((entry) => {
            const tribe = asTribe(entry);
            const accent = tribeAccentColor(tribe);
            const isMine =
              viewerTribeId !== null && entry.tribe_id === viewerTribeId;
            return (
              <li
                key={entry.tribe_id}
                className={isMine ? styles.rowMe : styles.row}
                data-testid={
                  isMine ? "leaderboard-tribe-row-me" : "leaderboard-tribe-row"
                }
                data-rank={entry.rank}
                style={{ ["--tribe-accent" as string]: accent }}
              >
                <span className={styles.rank}>#{entry.rank}</span>
                <span className={styles.nameRow}>
                  <span
                    className={styles.crest}
                    style={{ background: accent }}
                    aria-hidden
                  >
                    <TribeEmblem tribe={tribe} />
                  </span>
                  <span className={styles.name}>{entry.display_name}</span>
                </span>
                <span className={styles.score}>{formatScore(entry.score)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {showFooter && me ? (
        <div className={styles.yourRank} data-testid="leaderboard-your-rank">
          <span className={styles.yourRankLabel}>{t("yourRank")}</span>
          <span className={styles.yourRankValue}>
            #{me.rank} · {formatScore(me.score)}
          </span>
        </div>
      ) : null}
    </section>
  );
}
