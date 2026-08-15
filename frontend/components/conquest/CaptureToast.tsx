"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { useConquest } from "@/context/ConquestContext";
import TribeCrestDisc from "@/components/conquest/TribeCrestDisc";
import styles from "./CaptureToast.module.css";

const SHOW_MS = 4000;
const EXIT_MS = 320;

export default function CaptureToast() {
  const t = useTranslations("conquest");
  const router = useRouter();
  const { tribesById } = useCityData();
  const { activeToast, dismissActiveToast } = useConquest();
  const [exiting, setExiting] = useState(false);
  const shownIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeToast) {
      setExiting(false);
      shownIdRef.current = null;
      return;
    }
    if (shownIdRef.current !== activeToast.id) {
      shownIdRef.current = activeToast.id;
      setExiting(false);
    }
    const exitTimer = window.setTimeout(() => setExiting(true), SHOW_MS);
    const doneTimer = window.setTimeout(() => {
      dismissActiveToast();
    }, SHOW_MS + EXIT_MS);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [activeToast, dismissActiveToast]);

  const toast = activeToast;
  if (!toast) {
    return null;
  }

  const prev = toast.previous_tribe_id
    ? tribesById[toast.previous_tribe_id]
    : null;
  const next = tribesById[toast.new_tribe_id];
  const targetIl = toast.il_code;

  return (
    <div className={styles.slot} aria-live="polite">
      <button
        type="button"
        className={`${styles.banner}${exiting ? ` ${styles.exit}` : ""}`}
        onClick={() => {
          router.push(`/map?il=${encodeURIComponent(targetIl)}`);
          dismissActiveToast();
        }}
        data-testid="capture-toast"
        data-il={toast.il_code}
        data-log-id={toast.id}
      >
        <span className={styles.crests}>
          <TribeCrestDisc tribe={prev} size="md" fading />
          <span className={styles.arrow} aria-hidden>
            →
          </span>
          <TribeCrestDisc tribe={next} size="md" />
        </span>
        <span className={styles.copy}>
          <span className={styles.city}>{toast.city_name}</span>
          <span className={styles.meta}>
            {toast.was_derbi_bonus ? t("toastDerbi") : t("toastCaptured")}
          </span>
        </span>
      </button>
    </div>
  );
}
