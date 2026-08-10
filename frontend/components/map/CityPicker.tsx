"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import type { City } from "@/lib/cities-api";
import { compareTurkish, matchesTurkishSearch } from "@/lib/turkishFold";
import styles from "./CityPicker.module.css";

type CityPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (city: City) => void;
};

export default function CityPicker({ open, onClose, onSelect }: CityPickerProps) {
  const t = useTranslations("map.picker");
  const { cities } = useCityData();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const sorted = useMemo(
    () => [...cities].sort((a, b) => compareTurkish(a.name, b.name)),
    [cities],
  );

  const filtered = useMemo(
    () =>
      sorted.filter((city) =>
        matchesTurkishSearch(query, city.name, city.id),
      ),
    [sorted, query],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    const id = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-picker-title"
        data-testid="city-picker"
      >
        <div className={styles.header}>
          <h2 id="city-picker-title" className={styles.title}>
            {t("title")}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={t("close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className={styles.searchWrap}>
          <input
            ref={searchRef}
            className={styles.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            data-testid="city-picker-search"
          />
        </div>
        {filtered.length === 0 ? (
          <p className={styles.empty}>{t("empty")}</p>
        ) : (
          <ul className={styles.list} role="listbox">
            {filtered.map((city) => (
              <li key={city.id}>
                <button
                  type="button"
                  className={styles.row}
                  role="option"
                  onClick={() => {
                    onSelect(city);
                    onClose();
                  }}
                >
                  <span className={styles.rowName}>{city.name}</span>
                  <span className={styles.rowId}>{city.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
