"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { useRealtime } from "@/context/RealtimeContext";
import {
  listActivityFeed,
  type ActivityFeedItem,
  type ActivityKind,
} from "@/lib/activity-feed-api";
import {
  activityPlaceLabel,
  activityTribeLabel,
} from "@/lib/activitySnippet";
import {
  activityFeedFromSocket,
  appendActivityItem,
  toChronological,
} from "@/lib/activityTicker";
import { prefersReducedMotion } from "@/lib/map/derbiUrgency";
import styles from "./ActivityTicker.module.css";

const PX_PER_SEC = 36;
const IDLE_RESUME_MS = 1200;
const KIND_KEYS: Record<ActivityKind, ActivityKind> = {
  conquest: "conquest",
  large_support: "large_support",
  derby_support: "derby_support",
};

type Props = {
  onSelectCity: (ilCode: string) => void;
};

export default function ActivityTicker({ onSelectCity }: Props) {
  const t = useTranslations("activityTicker");
  const locale = useLocale();
  const { subscribe } = useRealtime();
  const { tribesById } = useCityData();
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [looping, setLooping] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const halfWidthRef = useRef(0);
  const dropWidthRef = useRef(0);
  const pausedRef = useRef(false);
  const hoveringRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listActivityFeed()
      .then((res) => {
        if (cancelled) return;
        const seeded = toChronological(res.events ?? []);
        setItems((prev) => {
          let merged = seeded;
          for (const live of prev) {
            merged = appendActivityItem(merged, live);
          }
          return merged;
        });
      })
      .catch(() => {
        /* keep the strip hidden until a live event arrives */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "activity_feed") return;
      const incoming = activityFeedFromSocket(event);
      setItems((prev) => {
        const next = appendActivityItem(prev, incoming);
        if (
          prev.length > 0 &&
          next.length > 0 &&
          next[0].id !== prev[0].id &&
          !next.some((item) => item.id === prev[0].id)
        ) {
          const el = groupRef.current?.querySelector(
            `[data-ticker-id="${prev[0].id}"]`,
          ) as HTMLElement | null;
          const sibling = el?.nextElementSibling as HTMLElement | null;
          dropWidthRef.current =
            el && sibling
              ? sibling.offsetLeft - el.offsetLeft
              : (el?.offsetWidth ?? 0);
        }
        return next;
      });
    });
  }, [subscribe]);

  const applyTransform = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
  }, []);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    const track = trackRef.current;
    if (!viewport || !group) {
      halfWidthRef.current = 0;
      setLooping(false);
      return;
    }
    const reduce = prefersReducedMotion();
    const contentWidth = group.offsetWidth;
    const viewWidth = viewport.clientWidth;
    const shouldLoop = !reduce && contentWidth > viewWidth && contentWidth > 0;
    if (shouldLoop && track && track.children.length >= 2) {
      const a = track.children[0] as HTMLElement;
      const b = track.children[1] as HTMLElement;
      halfWidthRef.current = Math.max(contentWidth, b.offsetLeft - a.offsetLeft);
    } else {
      halfWidthRef.current = shouldLoop ? contentWidth : 0;
    }
    setLooping(shouldLoop);
    if (!shouldLoop) {
      offsetRef.current = 0;
      if (track) track.style.transform = "";
    }
  }, []);

  useLayoutEffect(() => {
    if (dropWidthRef.current) {
      offsetRef.current = Math.max(0, offsetRef.current - dropWidthRef.current);
      dropWidthRef.current = 0;
    }
    measure();
    if (looping) {
      applyTransform();
    }
  }, [items, looping, applyTransform, measure]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    if (groupRef.current) observer.observe(groupRef.current);
    return () => observer.disconnect();
  }, [measure, items.length, looping]);

  useEffect(() => {
    if (!looping) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
      return;
    }

    const tick = (now: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = now;
      if (!pausedRef.current && last !== null) {
        const half = halfWidthRef.current;
        if (half > 0) {
          offsetRef.current += (PX_PER_SEC * (now - last)) / 1000;
          if (offsetRef.current >= half) {
            offsetRef.current -= half;
          }
          applyTransform();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
    };
  }, [looping, applyTransform]);

  const clearResume = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const pause = () => {
    pausedRef.current = true;
    clearResume();
  };

  const scheduleResume = () => {
    clearResume();
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      if (!hoveringRef.current) {
        pausedRef.current = false;
      }
    }, IDLE_RESUME_MS);
  };

  useEffect(() => () => clearResume(), []);

  const snippetFor = (item: ActivityFeedItem) => {
    const tribe = tribesById[item.tribe_id];
    const tribeLabel = activityTribeLabel(
      tribe,
      item.tribe_id.slice(0, 8),
    );
    const place = activityPlaceLabel(item.city_name, locale);
    return t(KIND_KEYS[item.kind], { tribe: tribeLabel, place });
  };

  if (items.length === 0) {
    return null;
  }

  const renderGroup = (copyId: string) => (
    <div
      key={copyId}
      className={styles.group}
      ref={copyId === "a" ? groupRef : undefined}
      aria-hidden={copyId !== "a"}
    >
      {items.map((item) => (
        <button
          key={`${copyId}-${item.id}`}
          type="button"
          className={styles.item}
          data-testid={copyId === "a" ? "activity-ticker-item" : undefined}
          data-ticker-id={item.id}
          data-il={item.il_code}
          tabIndex={copyId === "a" ? 0 : -1}
          aria-label={t("itemAria", { city: item.city_name })}
          onClick={() => onSelectCity(item.il_code)}
        >
          <span className={styles.snippet}>{snippetFor(item)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <nav
      className={styles.strip}
      aria-label={t("aria")}
      data-testid="activity-ticker"
      onPointerEnter={() => {
        hoveringRef.current = true;
        pause();
      }}
      onPointerLeave={() => {
        hoveringRef.current = false;
        scheduleResume();
      }}
      onPointerDown={pause}
      onPointerUp={scheduleResume}
      onFocusCapture={pause}
      onBlurCapture={scheduleResume}
    >
      <div
        ref={viewportRef}
        className={
          looping
            ? styles.viewport
            : `${styles.viewport} ${styles.viewportManual}`
        }
      >
        <div ref={trackRef} className={styles.track}>
          {renderGroup("a")}
          {looping ? renderGroup("b") : null}
        </div>
      </div>
    </nav>
  );
}
