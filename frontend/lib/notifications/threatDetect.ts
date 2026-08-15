import {
  isFlightTargetVisible,
  mapPointToViewport,
} from "@/lib/creditFlow";
import type { Rect } from "@/lib/map/ambientAssets";
import type { InAppThreatAlert } from "@/lib/notifications/pushHandler";

export type { InAppThreatAlert };

/** Matches backend `THREAT_ALERT_LOW` / `THREAT_ALERT_HIGH` defaults. */
export const THREAT_THRESHOLDS = [0.7, 0.9];
export const THREAT_COOLDOWN_MS = 10 * 60 * 1000;

export type ThreatCrossing = {
  level: number;
  tensionPercent: number;
};

export type CityThreatSnap = {
  tension: number;
  controller: string | null;
};

const cooldownStore = new Map<string, number>();

export function resetThreatCooldownForTests(): void {
  cooldownStore.clear();
}

export function threatCooldownKey(ilCode: string, level: number): string {
  return `${ilCode}:${level}`;
}

export function tryConsumeThreatCooldown(
  ilCode: string,
  level: number,
  now: number = Date.now(),
  ttlMs: number = THREAT_COOLDOWN_MS,
  store: Map<string, number> = cooldownStore,
): boolean {
  const key = threatCooldownKey(ilCode, level);
  const until = store.get(key) ?? 0;
  if (until > now) {
    return false;
  }
  store.set(key, now + ttlMs);
  return true;
}

export function crossedThreatLevels(
  pre: number,
  post: number,
  thresholds: readonly number[] = THREAT_THRESHOLDS,
): number[] {
  if (post <= pre) {
    return [];
  }
  const levels: number[] = [];
  for (const th of thresholds) {
    if (th <= 0) continue;
    if (pre < th && post >= th) {
      levels.push(Math.round(th * 100));
    }
  }
  return levels;
}

/**
 * Client mirror of backend tension-threshold alerts. Only the controlling
 * tribe's members see a crossing; a flip is not a threat (the city is lost).
 * When both 70 and 90 cross in one spend, keep the higher level.
 */
export function detectRivalThreat(opts: {
  previousTension: number;
  nextTension: number;
  previousControllingTribeId: string | null;
  nextControllingTribeId: string | null;
  userTribeId: string | null;
  thresholds?: readonly number[];
}): ThreatCrossing | null {
  const user = opts.userTribeId;
  const nextController = opts.nextControllingTribeId;
  if (!user || !nextController || user !== nextController) {
    return null;
  }
  const prevController = opts.previousControllingTribeId;
  if (prevController && prevController !== nextController) {
    return null;
  }
  const levels = crossedThreatLevels(
    opts.previousTension,
    opts.nextTension,
    opts.thresholds ?? THREAT_THRESHOLDS,
  );
  if (levels.length === 0) {
    return null;
  }
  const level = Math.max(...levels);
  return {
    level,
    tensionPercent: Math.round(opts.nextTension * 100),
  };
}

export function seedCityThreatSnaps(
  cities: ReadonlyArray<{
    id: string;
    contest_tension?: number;
    controlling_tribe?: { tribe_id: string } | null;
  }>,
): Record<string, CityThreatSnap> {
  const out: Record<string, CityThreatSnap> = {};
  for (const city of cities) {
    out[city.id] = {
      tension: city.contest_tension ?? 0,
      controller: city.controlling_tribe?.tribe_id ?? null,
    };
  }
  return out;
}

/**
 * `mapPoint` is canvas-relative (`map.project` / `projectCity`).
 * `mapRect` is the canvas `getBoundingClientRect()` in viewport space.
 */
export function isProjectedCityVisible(opts: {
  mapPoint: { x: number; y: number } | null;
  mapRect: Rect | null;
}): boolean {
  if (!opts.mapPoint || !opts.mapRect) {
    return false;
  }
  const target = mapPointToViewport(opts.mapPoint, opts.mapRect);
  return isFlightTargetVisible({ target: target, mapRect: opts.mapRect });
}

export function alertFromCityCrossing(
  city: {
    id: string;
    name: string;
    controlling_tribe?: { tribe_id: string } | null;
  },
  crossing: ThreatCrossing,
): InAppThreatAlert {
  return {
    il_code: city.id,
    city_name: city.name,
    tribe_id: city.controlling_tribe?.tribe_id ?? "",
    tension_percent: crossing.tensionPercent,
    level: crossing.level,
  };
}
