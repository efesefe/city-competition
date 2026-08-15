"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  PRESENCE_POLL_MS,
  formatApproximateCount,
  getOnlineCount,
} from "@/lib/presence";
import styles from "./OnlineCounter.module.css";

export default function OnlineCounter() {
  const t = useTranslations("map");
  const locale = useLocale();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let seq = 0;

    async function refresh() {
      const mine = ++seq;
      try {
        const res = await getOnlineCount();
        if (!cancelled && mine === seq) {
          setCount(res.approximate_count);
        }
      } catch {
        /* keep last successful count; never flash a fake 0 */
      }
    }

    function schedule() {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          void refresh();
        }
        if (!cancelled) {
          schedule();
        }
      }, PRESENCE_POLL_MS);
    }

    void refresh();
    schedule();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (count == null) {
    return null;
  }

  return (
    <p className={styles.chip} data-testid="online-counter">
      {t("onlineCount", { count: formatApproximateCount(count, locale) })}
    </p>
  );
}
