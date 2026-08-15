"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import maplibregl from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import type { Derby } from "@/lib/derbies-api";
import {
  derbiChipCopy,
  selectUrgencyDerbies,
} from "@/lib/map/derbiUrgency";
import styles from "./DerbiCityOverlay.module.css";

type OverlayItem = {
  derby: Pick<Derby, "id" | "il_code" | "status" | "starts_at" | "ends_at">;
  city: City;
};

type DerbiCityOverlayProps = {
  map: maplibregl.Map;
  cities: City[];
  derbies: Derby[];
  nowMs: number;
};

function LightningBolt() {
  return (
    <svg
      className={styles.bolt}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.4 1.2 3.2 8.7h4.1L6.1 14.8l6.6-8.1H8.5L9.4 1.2z"
        fill="#f0b429"
        stroke="#1a1204"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function chipLabel(
  derby: OverlayItem["derby"],
  nowMs: number,
  t: ReturnType<typeof useTranslations>,
): string {
  const copy = derbiChipCopy(derby, nowMs);
  if (copy.kind === "soon") {
    return t("soon", { time: copy.time ?? "" });
  }
  if (copy.kind === "remainingMinutes") {
    return t("remainingMinutes", { minutes: copy.minutes ?? 0 });
  }
  return t("remaining", {
    hours: copy.hours ?? 0,
    minutes: copy.minutes ?? 0,
  });
}

function DerbiCityMarkers({
  map,
  derby,
  city,
  nowMs,
}: {
  map: maplibregl.Map;
  derby: OverlayItem["derby"];
  city: City;
  nowMs: number;
}) {
  const t = useTranslations("map.derbiUrgency");
  const [badgeEl] = useState(() => {
    const el = document.createElement("div");
    el.style.pointerEvents = "none";
    return el;
  });
  const [chipEl] = useState(() => {
    const el = document.createElement("div");
    el.style.pointerEvents = "none";
    return el;
  });

  const label = chipLabel(derby, nowMs, t);

  useEffect(() => {
    const lngLat: [number, number] = [city.centroid.lng, city.centroid.lat];
    const badge = new maplibregl.Marker({
      element: badgeEl,
      anchor: "center",
      offset: [16, -26],
      pitchAlignment: "viewport",
    })
      .setLngLat(lngLat)
      .addTo(map);
    const chip = new maplibregl.Marker({
      element: chipEl,
      anchor: "top",
      offset: [0, 18],
      pitchAlignment: "viewport",
    })
      .setLngLat(lngLat)
      .addTo(map);

    return () => {
      try {
        badge.remove();
      } catch {
        /* map already torn down */
      }
      try {
        chip.remove();
      } catch {
        /* map already torn down */
      }
    };
  }, [map, badgeEl, chipEl, city.centroid.lng, city.centroid.lat]);

  return (
    <>
      {createPortal(
        <div
          className={styles.badge}
          data-testid="derbi-city-badge"
          aria-hidden="true"
        >
          <LightningBolt />
        </div>,
        badgeEl,
      )}
      {createPortal(
        <div
          className={styles.chip}
          data-testid="derbi-city-chip"
          data-il-code={city.id}
          aria-label={t("chipAria", { city: city.name, label })}
        >
          {label}
        </div>,
        chipEl,
      )}
    </>
  );
}

export default function DerbiCityOverlay({
  map,
  cities,
  derbies,
  nowMs,
}: DerbiCityOverlayProps) {
  const items = useMemo<OverlayItem[]>(() => {
    const byId = new Map(cities.map((c) => [c.id, c]));
    const urgency = selectUrgencyDerbies(derbies, nowMs);
    const next: OverlayItem[] = [];
    for (const derby of urgency) {
      const city = byId.get(derby.il_code);
      if (city) {
        next.push({ derby, city });
      }
    }
    return next;
  }, [cities, derbies, nowMs]);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map(({ derby, city }) => (
        <DerbiCityMarkers
          key={derby.il_code}
          map={map}
          derby={derby}
          city={city}
          nowMs={nowMs}
        />
      ))}
    </>
  );
}
