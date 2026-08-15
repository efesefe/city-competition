import {
  pointInRect,
  supportSheetViewportRect,
  type Rect,
  type ScreenPoint,
} from "@/lib/map/ambientAssets";

export type Point = ScreenPoint;

export const CREDIT_BALANCE_TEST_ID = "credit-balance";
export const MAP_CANVAS_TEST_ID = "turkiye-map";
export const CITY_SUPPORT_SHEET_TEST_ID = "city-support-sheet";

export const CREDIT_FLOW_COIN_COUNT = 6;
export const CREDIT_FLOW_MAP_INSET_PX = 8;
export const CREDIT_FLOW_ARC_LIFT_PX = 40;
export const CREDIT_FLOW_DURATION_MS = 550;
export const CREDIT_FLOW_STAGGER_MS = 14;
export const CREDIT_FLOW_JITTER_PX = 28;

export type CoinSpec = {
  id: number;
  delayMs: number;
  /** Arc midpoint, relative to origin (px). */
  mx: number;
  my: number;
  /** Destination, relative to origin (px). */
  dx: number;
  dy: number;
};

export type CreditFlowDecision =
  | { kind: "flight"; origin: Point; target: Point; coins: CoinSpec[] }
  | { kind: "tick" }
  | { kind: "skip" };

export type DecideCreditFlowInput = {
  reduceMotion: boolean;
  origin: Point | null;
  /** Canvas-relative point from `projectCity` / `map.project`. */
  mapPoint: Point | null;
  mapRect: Rect | null;
  sheetRect: Rect;
  random?: () => number;
  coinCount?: number;
  insetPx?: number;
};

export function rectCenter(rect: Rect): Point {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

export function insetRect(rect: Rect, inset: number): Rect {
  return {
    left: rect.left + inset,
    top: rect.top + inset,
    right: rect.right - inset,
    bottom: rect.bottom - inset,
  };
}

/** Convert a MapLibre container-relative point to viewport coordinates. */
export function mapPointToViewport(mapPoint: Point, container: Rect): Point {
  return {
    x: container.left + mapPoint.x,
    y: container.top + mapPoint.y,
  };
}

/**
 * True when the city landing point is on the map canvas (with a small inset)
 * and not covered by the support sheet panel.
 */
export function isFlightTargetVisible(opts: {
  target: Point;
  mapRect: Rect;
  sheetRect: Rect;
  insetPx?: number;
}): boolean {
  const inset = opts.insetPx ?? CREDIT_FLOW_MAP_INSET_PX;
  const visibleMap = insetRect(opts.mapRect, inset);
  if (!pointInRect(opts.target, visibleMap)) {
    return false;
  }
  if (pointInRect(opts.target, opts.sheetRect)) {
    return false;
  }
  return true;
}

export function defaultSheetRect(
  viewportWidth: number,
  viewportHeight: number,
): Rect {
  return supportSheetViewportRect(viewportWidth, viewportHeight);
}

export function buildCoinTransforms(
  origin: Point,
  target: Point,
  count: number = CREDIT_FLOW_COIN_COUNT,
  random: () => number = Math.random,
): CoinSpec[] {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const n = Math.max(1, Math.floor(count));
  const coins: CoinSpec[] = [];
  for (let i = 0; i < n; i += 1) {
    const jitterX = (random() - 0.5) * CREDIT_FLOW_JITTER_PX;
    const jitterLift = (random() - 0.5) * 12;
    coins.push({
      id: i,
      delayMs: i * CREDIT_FLOW_STAGGER_MS,
      mx: dx * 0.45 + jitterX,
      my: -CREDIT_FLOW_ARC_LIFT_PX + jitterLift,
      dx,
      dy,
    });
  }
  return coins;
}

/**
 * Pure gate for the credit-flow overlay. Does not touch wallet or city
 * optimistic-update helpers — callers fire this after a successful spend.
 */
export function decideCreditFlow(input: DecideCreditFlowInput): CreditFlowDecision {
  if (input.reduceMotion) {
    return input.origin ? { kind: "tick" } : { kind: "skip" };
  }
  if (!input.origin || !input.mapPoint || !input.mapRect) {
    return { kind: "skip" };
  }
  const target = mapPointToViewport(input.mapPoint, input.mapRect);
  if (
    !isFlightTargetVisible({
      target,
      mapRect: input.mapRect,
      sheetRect: input.sheetRect,
      insetPx: input.insetPx,
    })
  ) {
    return { kind: "skip" };
  }
  return {
    kind: "flight",
    origin: input.origin,
    target,
    coins: buildCoinTransforms(
      input.origin,
      target,
      input.coinCount ?? CREDIT_FLOW_COIN_COUNT,
      input.random ?? Math.random,
    ),
  };
}
