"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { formatDateTime } from "@/lib/dateFormat";
import {
  fetchConquestUnreadCount,
  listConquestLog,
  markConquestLogRead,
  type ConquestLogEntry,
} from "@/lib/conquest-api";
import { syncConquestLogVisit } from "@/lib/conquest/unread";
import { useConquest } from "@/context/ConquestContext";
import TribeCrestDisc from "@/components/conquest/TribeCrestDisc";
import SupporterBadge from "@/components/conquest/SupporterBadge";
import styles from "./ConquestLogList.module.css";

const PAGE_SIZE = 20;

export default function ConquestLogList() {
  const t = useTranslations("conquest");
  const { tribesById } = useCityData();
  const { setUnreadCount } = useConquest();
  const [items, setItems] = useState<ConquestLogEntry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const loadingMoreRef = useRef(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await syncConquestLogVisit(
        {
          list: listConquestLog,
          markReadAll: () => markConquestLogRead({ all: true }),
          unreadCount: fetchConquestUnreadCount,
        },
        PAGE_SIZE,
      );
      setItems(result.entries);
      setNextOffset(result.nextOffset);
      setUnreadCount(result.unreadCount);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [setUnreadCount, t]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await listConquestLog(PAGE_SIZE, nextOffset);
      setItems((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const extra = page.entries.filter((e) => !seen.has(e.id));
        return extra.length ? [...prev, ...extra] : prev;
      });
      setNextOffset(
        page.next_offset === undefined || page.next_offset === null
          ? null
          : page.next_offset,
      );
    } catch {
      setError(t("loadFailed"));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextOffset, t]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || nextOffset === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, nextOffset]);

  return (
    <div className={styles.wrap} data-testid="conquest-log-list">
      {loading ? <p className={styles.status}>{t("loading")}</p> : null}
      {error ? (
        <p className={styles.error} data-testid="conquest-log-error">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className={styles.status} data-testid="conquest-log-empty">
          {t("empty")}
        </p>
      ) : null}
      <ul className={styles.list}>
        {items.map((entry) => {
          const prev = entry.previous_tribe_id
            ? tribesById[entry.previous_tribe_id]
            : null;
          const next = tribesById[entry.new_tribe_id];
          const expanded = expandedId === entry.id;
          return (
            <li key={entry.id}>
              <div
                className={`${styles.card}${expanded ? ` ${styles.cardOpen}` : ""}`}
              >
                <button
                  type="button"
                  className={styles.row}
                  data-testid="conquest-log-row"
                  data-log-id={entry.id}
                  data-il={entry.il_code}
                  data-expanded={expanded ? "true" : "false"}
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? t("supporters.collapseAria")
                      : t("supporters.expandAria")
                  }
                  onClick={() =>
                    setExpandedId((cur) => (cur === entry.id ? null : entry.id))
                  }
                >
                  <span className={styles.crests}>
                    <TribeCrestDisc tribe={prev} size="sm" fading />
                    <span className={styles.arrow} aria-hidden>
                      →
                    </span>
                    <TribeCrestDisc tribe={next} size="sm" />
                  </span>
                  <span className={styles.body}>
                    <span className={styles.city}>{entry.city_name}</span>
                    <span className={styles.meta}>
                      {formatDateTime(entry.occurred_at)}
                      {entry.was_derbi_bonus ? ` · ${t("derbiHint")}` : ""}
                    </span>
                  </span>
                </button>
                {expanded ? (
                  <div className={styles.panel}>
                    <SupporterBadge logId={entry.id} enabled />
                    <div className={styles.links}>
                      <Link
                        href={`/conquest-log/${encodeURIComponent(entry.id)}`}
                        className={styles.detailLink}
                        data-testid="conquest-log-open-detail"
                      >
                        {t("openDetail")}
                      </Link>
                      <Link
                        href={`/map?il=${encodeURIComponent(entry.il_code)}`}
                        className={styles.detailLink}
                        data-testid="conquest-log-open-map"
                      >
                        {t("openOnMap")}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        {nextOffset !== null ? (
          <li ref={sentinelRef} className={styles.sentinel} aria-hidden />
        ) : null}
      </ul>
      {loadingMore ? <p className={styles.status}>{t("loadingMore")}</p> : null}
    </div>
  );
}
