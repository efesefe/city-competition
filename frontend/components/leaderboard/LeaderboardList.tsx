"use client";

import { useTranslations } from "next-intl";
import type { Tribe } from "@/lib/tribes-api";
import type { LeaderboardBoard } from "@/lib/leaderboard-api";
import { getUserId } from "@/lib/session";
import { shouldShowYourRankFooter } from "@/lib/leaderboardVisibility";
import { tribeAccentColor } from "@/lib/tribeCrest";
import TribeEmblem from "@/components/conquest/TribeEmblem";
import styles from "./LeaderboardList.module.css";

type Props = {
  board: LeaderboardBoard | null;
  loading: boolean;
  error: string | null;
  tribe?: Tribe | null;
};

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "0";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export default function LeaderboardList({
  board,
  loading,
  error,
  tribe,
}: Props) {
  const t = useTranslations("leaderboard");
  const viewerId = getUserId();
  const entries = board?.entries ?? [];
  const me = board?.me ?? null;
  const showFooter = shouldShowYourRankFooter(entries, me, viewerId);
  const accent = tribeAccentColor(tribe);

  return (
    <section className={styles.section} data-testid="leaderboard-list">
      {tribe ? (
        <header
          className={styles.tribeHeader}
          style={{ ["--tribe-accent" as string]: accent }}
          data-testid="leaderboard-tribe-header"
        >
          <span
            className={styles.crest}
            style={{ background: accent }}
            aria-hidden
          >
            <TribeEmblem tribe={tribe} />
          </span>
          <h2 className={styles.tribeName}>{tribe.display_name}</h2>
        </header>
      ) : null}

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
            const isMe = viewerId !== null && entry.user_id === viewerId;
            return (
              <li
                key={entry.user_id}
                className={isMe ? styles.rowMe : styles.row}
                data-testid={isMe ? "leaderboard-row-me" : "leaderboard-row"}
                data-rank={entry.rank}
              >
                <span className={styles.rank}>#{entry.rank}</span>
                <span className={styles.name}>{entry.username}</span>
                <span className={styles.score}>{formatScore(entry.score)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {showFooter && me ? (
        <div
          className={styles.yourRank}
          data-testid="leaderboard-your-rank"
        >
          <span className={styles.yourRankLabel}>{t("yourRank")}</span>
          <span className={styles.yourRankValue}>
            #{me.rank} · {formatScore(me.score)}
          </span>
        </div>
      ) : null}
    </section>
  );
}
