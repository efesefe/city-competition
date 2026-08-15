"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCityData } from "@/context/CityDataContext";
import { useConquest } from "@/context/ConquestContext";
import { useWallet } from "@/context/WalletContext";
import { MAP_CANVAS_TEST_ID } from "@/lib/creditFlow";
import type { Rect } from "@/lib/map/ambientAssets";
import {
  subscribeThreatAlert,
  type InAppThreatAlert,
} from "@/lib/notifications/pushHandler";
import {
  alertFromCityCrossing,
  detectRivalThreat,
  isProjectedCityVisible,
  seedCityThreatSnaps,
  tryConsumeThreatCooldown,
  type CityThreatSnap,
} from "@/lib/notifications/threatDetect";
import { tribeAccentColor } from "@/lib/tribeCrest";
import ThreatAlertBanner from "./ThreatAlertBanner";

const SHOW_MS = 8000;

type Props = {
  onDefend: (ilCode: string) => void;
};

function readMapRect(): Rect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(`[data-testid="${MAP_CANVAS_TEST_ID}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export default function ThreatAlertHost({ onDefend }: Props) {
  const { cities, tribesById } = useCityData();
  const { tribeId } = useWallet();
  const { projectCity } = useConquest();
  const [alert, setAlert] = useState<InAppThreatAlert | null>(null);
  const snapsRef = useRef<Record<string, CityThreatSnap> | null>(null);
  const projectRef = useRef(projectCity);
  projectRef.current = projectCity;

  const cityVisible = useCallback((ilCode: string) => {
    return isProjectedCityVisible({
      mapPoint: projectRef.current(ilCode),
      mapRect: readMapRect(),
    });
  }, []);

  const maybeShow = useCallback(
    (next: InAppThreatAlert) => {
      if (!cityVisible(next.il_code)) return;
      if (!tryConsumeThreatCooldown(next.il_code, next.level)) return;
      setAlert(next);
    },
    [cityVisible],
  );

  useEffect(() => {
    return subscribeThreatAlert((next) => {
      maybeShow(next);
    });
  }, [maybeShow]);

  useEffect(() => {
    if (cities.length === 0) return;
    if (!snapsRef.current) {
      snapsRef.current = seedCityThreatSnaps(cities);
      return;
    }
    const prev = snapsRef.current;
    const nextSnaps: Record<string, CityThreatSnap> = { ...prev };
    let shown: InAppThreatAlert | null = null;
    for (const city of cities) {
      const snap = prev[city.id];
      const tension = city.contest_tension ?? 0;
      const controller = city.controlling_tribe?.tribe_id ?? null;
      if (!snap) {
        nextSnaps[city.id] = { tension, controller };
        continue;
      }
      const crossing = detectRivalThreat({
        previousTension: snap.tension,
        nextTension: tension,
        previousControllingTribeId: snap.controller,
        nextControllingTribeId: controller,
        userTribeId: tribeId,
      });
      nextSnaps[city.id] = { tension, controller };
      if (crossing) {
        shown = alertFromCityCrossing(city, crossing);
      }
    }
    snapsRef.current = nextSnaps;
    if (shown) {
      maybeShow(shown);
    }
  }, [cities, tribeId, maybeShow]);

  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(() => setAlert(null), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [alert]);

  if (!alert) return null;

  const tribe = alert.tribe_id ? tribesById[alert.tribe_id] : null;
  const city = cities.find((c) => c.id === alert.il_code);
  const fallbackColor = city?.controlling_tribe?.primary_color;
  const accent = tribeAccentColor(
    tribe ?? (fallbackColor ? { primary_color: fallbackColor } : null),
  );

  return (
    <ThreatAlertBanner
      alert={alert}
      accentColor={accent}
      onDefend={() => {
        const il = alert.il_code;
        setAlert(null);
        onDefend(il);
      }}
      onDismiss={() => setAlert(null)}
    />
  );
}
