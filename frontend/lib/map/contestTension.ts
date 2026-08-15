import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";
import type { City, CompetingTribe } from "@/lib/cities-api";

/** Matches `CITIES_SOURCE_ID` in ownership.ts without importing that module. */
const DEFAULT_CITIES_SOURCE_ID = "cities";

export const CONTEST_TENSION_DISPLAY_FLOOR = 0.3;
export const CONTEST_TENSION_OPACITY_MIN = 0.16;
export const CONTEST_TENSION_OPACITY_MAX = 0.38;
export const CONTEST_TENSION_WIDTH_MIN = 1.15;
export const CONTEST_TENSION_WIDTH_MAX = 1.9;
export const CONTEST_TENSION_COLOR_MUTED = "#c45c3a";
export const CONTEST_TENSION_COLOR_HOT = "#ff5a2a";
/** Derby glow stays louder: dim the tension ring on urgent derby cities. */
export const CONTEST_TENSION_DERBI_OPACITY_FACTOR = 0.35;

/**
 * Second-place committed credits as a fraction of first place, clamped to [0, 1].
 * Matches backend `conquest.ContestTension`. Uncontrolled / no-challenger → 0.
 */
export function contestTension(
  competing: ReadonlyArray<Pick<CompetingTribe, "committed_credits">>,
): number {
  const scores = competing
    .map((row) => row.committed_credits)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  const first = scores[0] ?? 0;
  const second = scores[1] ?? 0;
  if (first <= 0 || second <= 0) {
    return 0;
  }
  const t = second / first;
  return t > 1 ? 1 : t;
}

export function clampContestTension(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function tensionFeature(): ExpressionSpecification {
  return [
    "coalesce",
    ["feature-state", "contest_tension"],
    0,
  ] as unknown as ExpressionSpecification;
}

function belowFloor(thenValue: unknown, elseValue: unknown): ExpressionSpecification {
  return [
    "case",
    ["<", tensionFeature(), CONTEST_TENSION_DISPLAY_FLOOR],
    thenValue,
    elseValue,
  ] as unknown as ExpressionSpecification;
}

export function contestTensionOpacityPaint(): ExpressionSpecification {
  const scaled = [
    "interpolate",
    ["linear"],
    tensionFeature(),
    CONTEST_TENSION_DISPLAY_FLOOR,
    CONTEST_TENSION_OPACITY_MIN,
    1,
    CONTEST_TENSION_OPACITY_MAX,
  ];
  const derbiDim = [
    "case",
    ["boolean", ["feature-state", "derbi_active"], false],
    CONTEST_TENSION_DERBI_OPACITY_FACTOR,
    1,
  ];
  return belowFloor(0, ["*", scaled, derbiDim]);
}

export function contestTensionWidthPaint(): ExpressionSpecification {
  return belowFloor(0, [
    "interpolate",
    ["linear"],
    tensionFeature(),
    CONTEST_TENSION_DISPLAY_FLOOR,
    CONTEST_TENSION_WIDTH_MIN,
    1,
    CONTEST_TENSION_WIDTH_MAX,
  ]);
}

export function contestTensionColorPaint(): ExpressionSpecification {
  return belowFloor("rgba(0, 0, 0, 0)", [
    "interpolate",
    ["linear"],
    tensionFeature(),
    CONTEST_TENSION_DISPLAY_FLOOR,
    CONTEST_TENSION_COLOR_MUTED,
    1,
    CONTEST_TENSION_COLOR_HOT,
  ]);
}

export function applyContestTensionState(
  map: MaplibreMap,
  ilCode: string,
  tension: number | undefined | null,
  sourceId: string = DEFAULT_CITIES_SOURCE_ID,
): void {
  if (!map.getSource(sourceId)) {
    return;
  }
  map.setFeatureState(
    { source: sourceId, id: ilCode },
    { contest_tension: clampContestTension(tension) },
  );
}

/** Sync contest_tension feature-state for every city (live support patches included). */
export function applyContestTensionStates(
  map: MaplibreMap,
  cities: City[],
  sourceId: string = DEFAULT_CITIES_SOURCE_ID,
): void {
  for (const city of cities) {
    applyContestTensionState(map, city.id, city.contest_tension, sourceId);
  }
}
