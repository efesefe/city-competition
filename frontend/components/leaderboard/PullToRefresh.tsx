"use client";

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import { useTranslations } from "next-intl";
import styles from "./PullToRefresh.module.css";

const THRESHOLD_PX = 64;

type Props = {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  className?: string;
};

export default function PullToRefresh({
  onRefresh,
  children,
  className,
}: Props) {
  const t = useTranslations("leaderboard");
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const finishRefresh = useCallback(async () => {
    setRefreshing(true);
    setOffset(THRESHOLD_PX * 0.5);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setOffset(0);
    }
  }, [onRefresh]);

  function onTouchStart(e: TouchEvent) {
    const el = scrollerRef.current;
    if (!el || refreshing) return;
    if (el.scrollTop > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
    pulling.current = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!pulling.current || startY.current === null || refreshing) return;
    const y = e.touches[0]?.clientY ?? startY.current;
    const delta = Math.max(0, y - startY.current);
    if (delta > 0 && scrollerRef.current && scrollerRef.current.scrollTop <= 0) {
      setOffset(Math.min(delta * 0.45, THRESHOLD_PX * 1.25));
    }
  }

  function onTouchEnd() {
    if (!pulling.current) return;
    pulling.current = false;
    startY.current = null;
    if (offset >= THRESHOLD_PX && !refreshing) {
      void finishRefresh();
    } else {
      setOffset(0);
    }
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div
        className={styles.indicator}
        style={{ height: offset > 0 || refreshing ? offset || 40 : 0 }}
        aria-hidden={!refreshing && offset < THRESHOLD_PX}
        data-testid="leaderboard-ptr-indicator"
      >
        {refreshing || offset >= THRESHOLD_PX * 0.5 ? t("refreshing") : null}
      </div>
      <div
        ref={scrollerRef}
        className={styles.scroller}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        data-testid="leaderboard-ptr-scroller"
      >
        {children}
      </div>
      <button
        type="button"
        className={styles.desktopRefresh}
        onClick={() => void finishRefresh()}
        disabled={refreshing}
        data-testid="leaderboard-refresh"
      >
        {t("refresh")}
      </button>
    </div>
  );
}
