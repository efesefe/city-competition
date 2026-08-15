"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import maplibregl from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import {
  selectMomentumBadges,
  type CityMomentumBadge,
} from "@/lib/map/momentumBadges";
import styles from "./MomentumBadge.module.css";

/** Opposite the derby lightning ([16, -26]) so both can sit near the crest. */
const BADGE_OFFSET: [number, number] = [-16, -26];

type MomentumBadgeProps = {
  map: maplibregl.Map;
  cities: City[];
};

function DoubleArrow() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6.2 3.2 2.4 8l3.8 4.8V10.2h3.2V5.8H6.2V3.2zm3.6 9.6L13.6 8 9.8 3.2v2.6H6.6v4.4h3.2v2.6z"
        fill="#e8a15a"
        stroke="#1a1204"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StreakFlame() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8.2 1.4s-.2 2.4-1.8 4.1C4.6 7.4 3.6 8.8 3.6 11c0 2.4 1.9 4.1 4.4 4.1 2.6 0 4.5-1.8 4.5-4.3 0-2.4-1.4-3.8-2.2-5.2-.5-.9-.6-1.8-.5-2.8-1 .6-1.4 1.6-1.6 2.6 0-1.4-.2-2.7-.8-4z"
        fill="#f0b429"
        stroke="#1a1204"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function badgeLabel(
  badge: CityMomentumBadge,
  t: ReturnType<typeof useTranslations>,
): string {
  if (badge.kind === "momentum") {
    return t("flipsToday", { count: badge.count });
  }
  return t("streakHeld", { days: badge.count });
}

function MomentumBadgeMarker({
  map,
  city,
  badge,
}: {
  map: maplibregl.Map;
  city: City;
  badge: CityMomentumBadge;
}) {
  const t = useTranslations("map.momentum");
  const [open, setOpen] = useState(false);
  const [el] = useState(() => {
    const node = document.createElement("div");
    node.style.pointerEvents = "auto";
    return node;
  });

  const label = badgeLabel(badge, t);

  useEffect(() => {
    const marker = new maplibregl.Marker({
      element: el,
      anchor: "center",
      offset: BADGE_OFFSET,
      pitchAlignment: "viewport",
    })
      .setLngLat([city.centroid.lng, city.centroid.lat])
      .addTo(map);

    return () => {
      try {
        marker.remove();
      } catch {
        /* map already torn down */
      }
    };
  }, [map, el, city.centroid.lng, city.centroid.lat]);

  return createPortal(
    <button
      type="button"
      className={styles.badge}
      data-testid="momentum-badge"
      data-kind={badge.kind}
      data-il-code={city.id}
      data-open={open ? "true" : "false"}
      title={label}
      aria-label={t("badgeAria", { city: city.name, label })}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={() => setOpen(false)}
    >
      {badge.kind === "momentum" ? <DoubleArrow /> : <StreakFlame />}
      {badge.kind === "streak" ? (
        <span className={styles.count}>{badge.count}</span>
      ) : null}
      <span className={styles.tooltip}>{label}</span>
    </button>,
    el,
  );
}

export default function MomentumBadge({ map, cities }: MomentumBadgeProps) {
  const items = useMemo(() => selectMomentumBadges(cities), [cities]);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map(({ city, badge }) => (
        <MomentumBadgeMarker
          key={city.id}
          map={map}
          city={city}
          badge={badge}
        />
      ))}
    </>
  );
}
