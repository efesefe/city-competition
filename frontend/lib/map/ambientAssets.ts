export type LngLat = { lng: number; lat: number };

export type SeaRegion = "aegean" | "mediterranean" | "black_sea" | "marmara";

export type CreatureKind = "dolphin" | "seagulls" | "boat";

export type CubicPoints = [LngLat, LngLat, LngLat, LngLat];

export type AmbientPath = {
  id: string;
  region: SeaRegion;
  points: CubicPoints;
};

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ScreenPoint = { x: number; y: number };

export type DayNightKind = "day" | "evening" | "night";

export type DayNightTint = {
  kind: DayNightKind;
  /** CSS background (gradient or transparent). Alpha lives in the stops. */
  cssBackground: string;
  /** Max wash alpha — never high enough to muddy tribe fills or labels. */
  opacity: number;
};

export type AmbientSpawn = {
  kind: CreatureKind;
  region: SeaRegion;
  pathId: string;
  points: CubicPoints;
  durationMs: number;
};

export type PickAmbientSpawnOpts = {
  random?: () => number;
  selectedCentroid?: LngLat | null;
  sheetRect?: Rect | null;
  project?: (p: LngLat) => ScreenPoint;
  attempts?: number;
};

/** Default gap between creatures: 3–8 minutes, jittered. */
export const AMBIENT_DELAY_MIN_MS = 180_000;
export const AMBIENT_DELAY_MAX_MS = 480_000;

/** Short cadence when `localStorage cc_ambient_debug=1` is set. */
export const AMBIENT_DEBUG_DELAY_MIN_MS = 2_000;
export const AMBIENT_DEBUG_DELAY_MAX_MS = 5_000;
export const AMBIENT_DEBUG_STORAGE_KEY = "cc_ambient_debug";

export const CITY_CLEARANCE_DEG = 0.4;
export const CITY_CLEARANCE_PX = 80;
export const PATH_SAMPLE_TS = [0, 0.25, 0.5, 0.75, 1] as const;

export const EVENING_TINT_OPACITY = 0.1;
export const NIGHT_TINT_OPACITY = 0.12;

export const SHEET_WIDE_BREAKPOINT_PX = 640;

export const CREATURE_DURATION_MS: Record<CreatureKind, number> = {
  dolphin: 14_000,
  seagulls: 16_000,
  boat: 20_000,
};

export const CREATURE_KINDS: CreatureKind[] = ["dolphin", "seagulls", "boat"];

/**
 * Water-only cubic beziers. Control points sit seaward of typical coast
 * centroids (İzmir 27.1/38.4, Antalya ~30.7/36.9, İstanbul 28.9/41.0).
 */
export const AMBIENT_PATHS: AmbientPath[] = [
  {
    id: "aegean-north",
    region: "aegean",
    points: [
      { lng: 25.85, lat: 36.55 },
      { lng: 25.55, lat: 37.45 },
      { lng: 25.75, lat: 38.35 },
      { lng: 26.15, lat: 39.15 },
    ],
  },
  {
    id: "aegean-mid",
    region: "aegean",
    points: [
      { lng: 26.25, lat: 36.45 },
      { lng: 25.95, lat: 37.15 },
      { lng: 25.65, lat: 37.95 },
      { lng: 25.95, lat: 38.75 },
    ],
  },
  {
    id: "med-west",
    region: "mediterranean",
    points: [
      { lng: 28.4, lat: 36.05 },
      { lng: 30.1, lat: 35.82 },
      { lng: 32.2, lat: 35.78 },
      { lng: 34.4, lat: 35.98 },
    ],
  },
  {
    id: "med-east",
    region: "mediterranean",
    points: [
      { lng: 36.15, lat: 35.92 },
      { lng: 34.2, lat: 35.76 },
      { lng: 31.6, lat: 35.84 },
      { lng: 29.2, lat: 36.08 },
    ],
  },
  {
    id: "black-west",
    region: "black_sea",
    points: [
      { lng: 29.4, lat: 41.62 },
      { lng: 32.1, lat: 41.92 },
      { lng: 35.2, lat: 42.05 },
      { lng: 38.4, lat: 41.78 },
    ],
  },
  {
    id: "black-east",
    region: "black_sea",
    points: [
      { lng: 41.1, lat: 41.55 },
      { lng: 38.2, lat: 42.02 },
      { lng: 34.4, lat: 42.08 },
      { lng: 30.3, lat: 41.58 },
    ],
  },
  {
    id: "marmara-east",
    region: "marmara",
    points: [
      { lng: 27.72, lat: 40.52 },
      { lng: 28.15, lat: 40.7 },
      { lng: 28.48, lat: 40.68 },
      { lng: 28.78, lat: 40.54 },
    ],
  },
  {
    id: "marmara-west",
    region: "marmara",
    points: [
      { lng: 28.72, lat: 40.72 },
      { lng: 28.35, lat: 40.5 },
      { lng: 27.98, lat: 40.48 },
      { lng: 27.68, lat: 40.62 },
    ],
  },
];

export const CREATURE_SVGS: Record<
  CreatureKind,
  { viewBox: string; width: number; height: number; paths: { d: string; fill: string }[] }
> = {
  dolphin: {
    viewBox: "0 0 40 18",
    width: 36,
    height: 16,
    paths: [
      {
        d: "M2.2 10.2c2.4-1.2 5.8-2.6 9.4-3.1 2.6-.4 4.2.2 5.2 1.1 1.4-2.6 3.6-4.6 6.4-5.8.4 1.8.2 3.4-.6 4.8 2.8-.2 5.4.4 7.8 1.6 1.6.8 3.4 1.2 5.2.8-.8 1.2-2.4 1.8-4 2.1-1.2.2-2.2.8-2.4 1.8-.8-.4-1.4-1.2-1.6-2.1-2.4.8-5 .9-7.6.4 1.2 1.6 1.4 3.4.6 5.2-1.6-1.2-2.8-2.8-3.2-4.6-2.6.2-5.2.6-7.6 1.6-1.4.6-3.2 1-5.2.8 1-.1.8-2.4-.4-3.6z",
        fill: "rgba(210, 230, 235, 0.82)",
      },
    ],
  },
  seagulls: {
    viewBox: "0 0 48 18",
    width: 48,
    height: 18,
    paths: [
      {
        d: "M2 8.5c2.4-3.2 5.2-3.2 7.6 0 .4.5.2.8-.2.5C7.2 7.4 5.4 7.4 3.2 9c-.4.3-.7 0-.1-.5z",
        fill: "rgba(235, 240, 242, 0.8)",
      },
      {
        d: "M18 5c3-3.6 6.4-3.6 9.4 0 .5.6.2 1-.3.6-2.7-2-5-2-7.8 0-.5.4-.8 0-.1-.6z",
        fill: "rgba(235, 240, 242, 0.78)",
      },
      {
        d: "M34 10.2c2.2-2.8 4.8-2.8 7 0 .4.5.2.7-.2.4-1.8-1.5-3.4-1.5-5.4.2-.4.3-.6 0-.1-.6z",
        fill: "rgba(235, 240, 242, 0.76)",
      },
    ],
  },
  boat: {
    viewBox: "0 0 32 22",
    width: 32,
    height: 22,
    paths: [
      {
        d: "M15.2 2.2v11.2h1.2V2.2L26 13.2H16.4z",
        fill: "rgba(232, 220, 196, 0.78)",
      },
      {
        d: "M4.2 15.2h23.4l-2.2 4.2H7.2z",
        fill: "rgba(196, 170, 130, 0.82)",
      },
    ],
  },
};

export function reversePathPoints(points: CubicPoints): CubicPoints {
  return [points[3], points[2], points[1], points[0]];
}

export function sampleCubicLngLat(points: readonly LngLat[], t: number): LngLat {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const u = 1 - clamped;
  const tt = clamped * clamped;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * clamped;
  const [p0, p1, p2, p3] = points;
  return {
    lng:
      uuu * p0.lng +
      3 * uu * clamped * p1.lng +
      3 * u * tt * p2.lng +
      ttt * p3.lng,
    lat:
      uuu * p0.lat +
      3 * uu * clamped * p1.lat +
      3 * u * tt * p2.lat +
      ttt * p3.lat,
  };
}

export function screenTangentRad(a: ScreenPoint, b: ScreenPoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pathClearOfCity(
  points: readonly LngLat[],
  city: LngLat,
  clearanceDeg: number = CITY_CLEARANCE_DEG,
): boolean {
  for (const t of PATH_SAMPLE_TS) {
    const p = sampleCubicLngLat(points, t);
    if (Math.hypot(p.lng - city.lng, p.lat - city.lat) < clearanceDeg) {
      return false;
    }
  }
  return true;
}

export function pathClearOfCityScreen(
  points: readonly LngLat[],
  project: (p: LngLat) => ScreenPoint,
  city: LngLat,
  radiusPx: number = CITY_CLEARANCE_PX,
): boolean {
  const c = project(city);
  for (const t of PATH_SAMPLE_TS) {
    const p = project(sampleCubicLngLat(points, t));
    if (Math.hypot(p.x - c.x, p.y - c.y) < radiusPx) {
      return false;
    }
  }
  return true;
}

export function pointInRect(p: ScreenPoint, rect: Rect): boolean {
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

export function pathClearOfSheet(
  points: readonly LngLat[],
  project: (p: LngLat) => ScreenPoint,
  sheet: Rect,
): boolean {
  for (const t of PATH_SAMPLE_TS) {
    if (pointInRect(project(sampleCubicLngLat(points, t)), sheet)) {
      return false;
    }
  }
  return true;
}

/**
 * Approximate CitySupportSheet panel in viewport coordinates
 * (`position: fixed`), matching CitySupportSheet.module.css.
 */
export function supportSheetViewportRect(
  viewportWidth: number,
  viewportHeight: number,
): Rect {
  if (viewportWidth >= SHEET_WIDE_BREAKPOINT_PX) {
    const sheetW = Math.min(24 * 16, viewportWidth);
    const sheetH = Math.min(0.8 * viewportHeight, 32 * 16);
    const left = (viewportWidth - sheetW) / 2;
    const top = (viewportHeight - sheetH) / 2;
    return { left, top, right: left + sheetW, bottom: top + sheetH };
  }
  const sheetH = Math.min(0.88 * viewportHeight, 34 * 16);
  return {
    left: 0,
    top: viewportHeight - sheetH,
    right: viewportWidth,
    bottom: viewportHeight,
  };
}

export function rectToMapSpace(viewportRect: Rect, containerRect: Rect): Rect {
  return {
    left: viewportRect.left - containerRect.left,
    top: viewportRect.top - containerRect.top,
    right: viewportRect.right - containerRect.left,
    bottom: viewportRect.bottom - containerRect.top,
  };
}

export function pickAmbientSpawn(
  opts: PickAmbientSpawnOpts = {},
): AmbientSpawn | null {
  const random = opts.random ?? Math.random;
  const attempts = opts.attempts ?? 16;
  for (let i = 0; i < attempts; i++) {
    const catalog =
      AMBIENT_PATHS[Math.floor(random() * AMBIENT_PATHS.length)] ??
      AMBIENT_PATHS[0];
    const reverse = random() < 0.5;
    const points = reverse
      ? reversePathPoints(catalog.points)
      : catalog.points;
    const kind =
      CREATURE_KINDS[Math.floor(random() * CREATURE_KINDS.length)] ?? "dolphin";
    if (
      opts.selectedCentroid &&
      !pathClearOfCity(points, opts.selectedCentroid)
    ) {
      continue;
    }
    if (
      opts.selectedCentroid &&
      opts.project &&
      !pathClearOfCityScreen(points, opts.project, opts.selectedCentroid)
    ) {
      continue;
    }
    if (
      opts.sheetRect &&
      opts.project &&
      !pathClearOfSheet(points, opts.project, opts.sheetRect)
    ) {
      continue;
    }
    return {
      kind,
      region: catalog.region,
      pathId: catalog.id,
      points,
      durationMs: CREATURE_DURATION_MS[kind],
    };
  }
  return null;
}

export function isAmbientDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(AMBIENT_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function nextAmbientDelayMs(
  random: () => number = Math.random,
  debug: boolean = false,
): number {
  const min = debug ? AMBIENT_DEBUG_DELAY_MIN_MS : AMBIENT_DELAY_MIN_MS;
  const max = debug ? AMBIENT_DEBUG_DELAY_MAX_MS : AMBIENT_DELAY_MAX_MS;
  return min + random() * (max - min);
}

export function ambientSpritesEnabled(opts: {
  reduceMotion: boolean;
  perfMode: boolean;
}): boolean {
  return !opts.reduceMotion && !opts.perfMode;
}

export function istanbulHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour : 12;
}

export function dayNightTint(hour: number): DayNightTint {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h <= 16) {
    return { kind: "day", cssBackground: "transparent", opacity: 0 };
  }
  if (h >= 17 && h <= 20) {
    return {
      kind: "evening",
      cssBackground: `linear-gradient(180deg, rgba(255, 158, 80, ${EVENING_TINT_OPACITY}), rgba(255, 140, 60, 0.04))`,
      opacity: EVENING_TINT_OPACITY,
    };
  }
  return {
    kind: "night",
    cssBackground: `linear-gradient(180deg, rgba(28, 48, 102, ${NIGHT_TINT_OPACITY}), rgba(16, 28, 64, 0.05))`,
    opacity: NIGHT_TINT_OPACITY,
  };
}

export function fadeOpacity(t: number): number {
  if (t < 0.08) return t / 0.08;
  if (t > 0.92) return (1 - t) / 0.08;
  return 1;
}
