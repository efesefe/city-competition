"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  fetchConquestSupporters,
  type ConquestSupporter,
  type ConquestSupportersResponse,
} from "@/lib/conquest-api";
import {
  COMPACT_SUPPORTER_LIMIT,
  hueFromUserId,
  moreCount,
  rankedSupporters,
  rankVisualWeight,
  resolveAvatarSrc,
  supporterInitials,
  supporterRowKey,
} from "@/lib/conquest/supporterDisplay";
import styles from "./SupporterBadge.module.css";

type SupporterBadgeProps = {
  logId: string;
  enabled?: boolean;
  compact?: boolean;
  className?: string;
};

export default function SupporterBadge({
  logId,
  enabled = true,
  compact = false,
  className,
}: SupporterBadgeProps) {
  const t = useTranslations("conquest.supporters");
  const [data, setData] = useState<ConquestSupportersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled || !logId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const limit = compact ? COMPACT_SUPPORTER_LIMIT : 10;
    fetchConquestSupporters(logId, limit)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, logId, compact]);

  if (!enabled || !logId) {
    return null;
  }

  const extra = className ? ` ${className}` : "";
  const compactClass = compact ? ` ${styles.compact}` : "";

  if (loading && !data) {
    return (
      <div
        className={`${styles.wrap}${compactClass}${extra}`}
        data-testid="supporter-badge"
        data-log-id={logId}
      >
        <p className={styles.status}>{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`${styles.wrap}${compactClass}${extra}`}
        data-testid="supporter-badge"
        data-log-id={logId}
      >
        <p className={styles.status}>{t("loadFailed")}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const rows = rankedSupporters(data.supporters);
  const leftover = moreCount(
    data.total_contributor_count,
    data.supporters.length,
  );

  return (
    <ol
      className={`${styles.wrap}${compactClass}${extra}`}
      data-testid="supporter-badge"
      data-log-id={logId}
    >
      {rows.length === 0 ? (
        <li className={styles.status}>{t("empty")}</li>
      ) : (
        rows.map(({ rank, supporter }) => (
          <SupporterRow
            key={supporterRowKey(supporter, rank)}
            rank={rank}
            supporter={supporter}
            youLabel={t("youLabel")}
            rankAria={t("rankAria", { rank })}
            crownAria={t("crownAria")}
            creditsLabel={t("credits", { n: supporter.contribution })}
          />
        ))
      )}
      {leftover > 0 ? (
        <li className={styles.more} data-testid="supporter-more">
          {t("morePeople", { n: leftover })}
        </li>
      ) : null}
    </ol>
  );
}

type RowProps = {
  rank: number;
  supporter: ConquestSupporter;
  youLabel: string;
  rankAria: string;
  crownAria: string;
  creditsLabel: string;
};

function SupporterRow({
  rank,
  supporter,
  youLabel,
  rankAria,
  crownAria,
  creditsLabel,
}: RowProps) {
  const weight = rankVisualWeight(rank);
  return (
    <li
      className={`${styles.row}${supporter.is_you ? ` ${styles.you}` : ""}`}
      style={{ ["--weight" as string]: String(weight) }}
      data-testid="supporter-row"
      data-rank={rank}
      data-is-you={supporter.is_you ? "true" : "false"}
      data-user-id={supporter.user_id}
    >
      <span className={styles.rankMark} aria-label={rankAria}>
        {rank === 1 ? (
          <span className={styles.crown} title={crownAria} aria-hidden>
            ♔
          </span>
        ) : null}
        <span className={styles.rankNum}>#{rank}</span>
      </span>
      <SupporterAvatar
        userId={supporter.user_id}
        displayName={supporter.display_name}
        avatarUrl={supporter.avatar_url}
      />
      <span className={styles.identity}>
        <span className={styles.name}>{supporter.display_name}</span>
        {supporter.is_you ? (
          <span className={styles.youChip} data-testid="supporter-you">
            {youLabel}
          </span>
        ) : null}
      </span>
      <span className={styles.credits}>{creditsLabel}</span>
    </li>
  );
}

function SupporterAvatar({
  userId,
  displayName,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string;
}) {
  const src = resolveAvatarSrc(avatarUrl);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src, userId]);
  const showImg = Boolean(src) && !broken;
  const hue = hueFromUserId(userId);
  return (
    <span
      className={styles.avatar}
      style={{ background: `hsl(${hue}, 55%, 42%)` }}
      aria-hidden
    >
      <span className={styles.initials}>{supporterInitials(displayName)}</span>
      {showImg ? (
        <img
          className={styles.photo}
          src={src}
          alt=""
          onError={() => setBroken(true)}
        />
      ) : null}
    </span>
  );
}
