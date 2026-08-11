"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { formatDateTime } from "@/lib/dateFormat";
import {
  fetchMySupports,
  type SupportHistoryItem,
} from "@/lib/support-api";
import { mergeSupportHistoryPages } from "@/lib/supportHistoryMerge";
import styles from "./SupportHistoryList.module.css";

const PAGE_SIZE = 20;

export default function SupportHistoryList() {
  const t = useTranslations("profile.history");
  const { cities, tribesById } = useCityData();
  const [items, setItems] = useState<SupportHistoryItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const citiesById = Object.fromEntries(cities.map((c) => [c.id, c]));

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      const res = await fetchMySupports(PAGE_SIZE, offset);
      setItems((prev) =>
        append ? mergeSupportHistoryPages(prev, res.supports) : res.supports,
      );
      setNextOffset(
        res.next_offset === undefined ? null : res.next_offset,
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPage(0, false)
      .catch(() => {
        if (!cancelled) setError(t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPage, t]);

  async function onLoadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      await loadPage(nextOffset, true);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className={styles.section} data-testid="profile-support-history">
      <h2 className={styles.title}>{t("title")}</h2>
      {loading ? <p className={styles.message}>{t("loading")}</p> : null}
      {error ? (
        <p className={styles.error} data-testid="profile-history-error">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className={styles.message}>{t("empty")}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className={styles.list} data-testid="profile-history-list">
          {items.map((row) => {
            const city = citiesById[row.il_code];
            const tribe = tribesById[row.tribe_id];
            const cityName =
              city?.name ?? t("unknownCity", { code: row.il_code });
            const tribeName = tribe?.display_name ?? t("unknownTribe");
            return (
              <li
                key={row.id}
                className={styles.row}
                data-testid="profile-history-row"
                data-support-id={row.id}
              >
                <div className={styles.rowTop}>
                  <p className={styles.city}>{cityName}</p>
                  <p className={styles.credits}>
                    {t("credits", { credits: row.credits_spent })}
                  </p>
                </div>
                <div className={styles.rowMeta}>
                  <span>{tribeName}</span>
                  <span>{formatDateTime(row.created_at)}</span>
                  {row.multiplier > 1 ? (
                    <span
                      className={styles.derbi}
                      data-testid="profile-history-derbi"
                    >
                      {t("derbiBonus", { multiplier: row.multiplier })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {nextOffset !== null && items.length > 0 ? (
        <button
          type="button"
          className={styles.more}
          onClick={onLoadMore}
          disabled={loadingMore}
          data-testid="profile-history-more"
        >
          {loadingMore ? t("loading") : t("loadMore")}
        </button>
      ) : null}
    </section>
  );
}
