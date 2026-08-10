"use client";

import { useTranslations } from "next-intl";
import {
  setPerformanceModePreference,
  type PerformanceModePreference,
} from "@/lib/performanceMode";
import styles from "./LocaleToggle.module.css";

const OPTIONS: PerformanceModePreference[] = ["auto", "on", "off"];

export default function PerfModeToggle({
  value,
  onChange,
}: {
  value: PerformanceModePreference;
  onChange: (next: PerformanceModePreference) => void;
}) {
  const t = useTranslations("map");

  function select(next: PerformanceModePreference) {
    setPerformanceModePreference(next);
    onChange(next);
  }

  return (
    <div
      className={styles.root}
      role="group"
      aria-label={t("perfModeLabel")}
      data-testid="perf-mode-toggle"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          className={value === opt ? styles.active : styles.btn}
          onClick={() => select(opt)}
          data-testid={`perf-mode-${opt}`}
        >
          {t(`perfMode.${opt}`)}
        </button>
      ))}
    </div>
  );
}
