import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";
import type { Derby } from "@/lib/derbies-api";
import { BANNER_SCHEDULED_SOON_MS, isBannerEligible } from "@/lib/derbiBanner";
import { formatTime } from "@/lib/dateFormat";
import { formatRemaining } from "@/lib/leaderboardVisibility";
import { CITIES_DERBI_GLOW_LAYER_ID } from "@/lib/map/ownership";
import { STRIPE_NONE_IMAGE_ID } from "@/lib/map/stripePatterns";
import { shouldReduceMotion } from "@/lib/reduceMotion";
import { NEUTRAL_TRIBE_COLOR } from "@/lib/tribeCrest";

export const DERBI_FILL_INTENSITY_MUTED = 0.78;
export const DERBI_FILL_OPACITY_MUTED = 0.78;
export const DERBI_FILL_OPACITY_ACTIVE = 0.94;

export const DERBI_GLOW_COLOR = "#f0b429";
export const DERBI_GLOW_BLUR = 1.6;
export const DERBI_GLOW_PULSE_MS = 1800;
export const DERBI_GLOW_OPACITY_MIN = 0.28;
export const DERBI_GLOW_OPACITY_MAX = 0.62;
export const DERBI_GLOW_WIDTH_MIN = 2.2;
export const DERBI_GLOW_WIDTH_MAX = 3.6;
export const DERBI_GLOW_STATIC_OPACITY = 0.45;
export const DERBI_GLOW_STATIC_WIDTH = 2.8;

export type UrgencyDerby = Pick<
  Derby,
  "id" | "il_code" | "status" | "starts_at" | "ends_at"
>;

/**
 * Eligible for map urgency: banner window, plus scheduled events whose
 * starts_at has passed but the poll has not yet flipped status to active.
 */
export function isUrgencyEligible(
  derby: Pick<Derby, "status" | "starts_at" | "ends_at">,
  nowMs = Date.now(),
): boolean {
  if (isBannerEligible(derby, nowMs)) {
    return true;
  }
  if (derby.status !== "scheduled") {
    return false;
  }
  const starts = Date.parse(derby.starts_at);
  const ends = Date.parse(derby.ends_at);
  if (Number.isNaN(starts) || starts > nowMs) {
    return false;
  }
  return Number.isNaN(ends) || ends > nowMs;
}

function preferUrgencyDerby<T extends UrgencyDerby>(a: T, b: T): T {
  if (a.status === "active" && b.status !== "active") {
    return a;
  }
  if (b.status === "active" && a.status !== "active") {
    return b;
  }
  if (a.status === "active" && b.status === "active") {
    return Date.parse(a.ends_at) >= Date.parse(b.ends_at) ? a : b;
  }
  return Date.parse(a.starts_at) <= Date.parse(b.starts_at) ? a : b;
}

/** One urgency derby per il_code (active wins, else soonest start). */
export function selectUrgencyDerbies<T extends UrgencyDerby>(
  derbies: T[],
  nowMs = Date.now(),
): T[] {
  const byIl = new Map<string, T>();
  for (const derby of derbies) {
    if (!isUrgencyEligible(derby, nowMs)) {
      continue;
    }
    const existing = byIl.get(derby.il_code);
    byIl.set(
      derby.il_code,
      existing ? preferUrgencyDerby(existing, derby) : derby,
    );
  }
  return [...byIl.values()];
}

export function urgencyIlCodes(
  derbies: UrgencyDerby[],
  nowMs = Date.now(),
): Set<string> {
  return new Set(selectUrgencyDerbies(derbies, nowMs).map((d) => d.il_code));
}

export type DerbiChipKind = "remaining" | "remainingMinutes" | "soon";

export type DerbiChipCopy = {
  kind: DerbiChipKind;
  hours?: number;
  minutes?: number;
  time?: string;
};

export function derbiChipCopy(
  derby: Pick<Derby, "status" | "starts_at" | "ends_at">,
  nowMs = Date.now(),
): DerbiChipCopy {
  const starts = Date.parse(derby.starts_at);
  const upcoming =
    derby.status === "scheduled" && !Number.isNaN(starts) && starts > nowMs;
  if (upcoming) {
    return { kind: "soon", time: formatTime(derby.starts_at) };
  }
  const ends = Date.parse(derby.ends_at);
  const remainingMs = Number.isNaN(ends) ? 0 : ends - nowMs;
  const { hours, minutes } = formatRemaining(remainingMs);
  if (hours <= 0) {
    return { kind: "remainingMinutes", minutes };
  }
  return { kind: "remaining", hours, minutes };
}

/** Next Date.now() at which eligibility or chip kind should recompute. */
export function nextUrgencyTransitionMs(
  derbies: Array<Pick<Derby, "status" | "starts_at" | "ends_at">>,
  nowMs = Date.now(),
): number | null {
  let next: number | null = null;
  const consider = (ts: number) => {
    if (!Number.isFinite(ts) || ts <= nowMs) {
      return;
    }
    next = next === null ? ts : Math.min(next, ts);
  };

  for (const derby of derbies) {
    const starts = Date.parse(derby.starts_at);
    const ends = Date.parse(derby.ends_at);
    if (derby.status === "scheduled" && !Number.isNaN(starts)) {
      consider(starts - BANNER_SCHEDULED_SOON_MS);
      consider(starts);
    }
    if (
      (derby.status === "active" || derby.status === "scheduled") &&
      !Number.isNaN(ends)
    ) {
      consider(ends);
    }
  }
  return next;
}

export function derbiFillColorPaint(): ExpressionSpecification {
  return [
    "case",
    ["!=", ["feature-state", "primary_color"], null],
    [
      "interpolate-hcl",
      ["linear"],
      [
        "case",
        ["boolean", ["feature-state", "derbi_active"], false],
        1,
        DERBI_FILL_INTENSITY_MUTED,
      ],
      0,
      NEUTRAL_TRIBE_COLOR,
      1,
      ["feature-state", "primary_color"],
    ],
    NEUTRAL_TRIBE_COLOR,
  ] as unknown as ExpressionSpecification;
}

export function derbiFillOpacityPaint(): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "derbi_active"], false],
    DERBI_FILL_OPACITY_ACTIVE,
    DERBI_FILL_OPACITY_MUTED,
  ] as unknown as ExpressionSpecification;
}

export function stripeFillPatternPaint(): ExpressionSpecification {
  return [
    "coalesce",
    ["feature-state", "stripe_pattern"],
    STRIPE_NONE_IMAGE_ID,
  ] as unknown as ExpressionSpecification;
}

/** Kit stripes overlay: hidden when unowned, derby-muted otherwise. */
export function stripeFillOpacityPaint(): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "striped"], false],
    derbiFillOpacityPaint(),
    0,
  ] as unknown as ExpressionSpecification;
}

export function derbiGlowOpacityExpression(
  opacity: number,
): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "derbi_active"], false],
    opacity,
    0,
  ] as unknown as ExpressionSpecification;
}

export function derbiGlowWidthExpression(
  width: number,
): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "derbi_active"], false],
    width,
    0,
  ] as unknown as ExpressionSpecification;
}

function applyGlowPaint(map: MaplibreMap, opacity: number, width: number): void {
  if (!map.getLayer(CITIES_DERBI_GLOW_LAYER_ID)) {
    return;
  }
  map.setPaintProperty(
    CITIES_DERBI_GLOW_LAYER_ID,
    "line-opacity",
    derbiGlowOpacityExpression(opacity),
  );
  map.setPaintProperty(
    CITIES_DERBI_GLOW_LAYER_ID,
    "line-width",
    derbiGlowWidthExpression(width),
  );
}

/**
 * Opacity/width loop on the duplicate glow layer. No per-frame feature-state.
 * Returns a disposer. Static glow when `animate` is false.
 */
export function startDerbiGlowPulse(
  map: MaplibreMap,
  animate: boolean,
): () => void {
  applyGlowPaint(map, DERBI_GLOW_STATIC_OPACITY, DERBI_GLOW_STATIC_WIDTH);
  if (!animate) {
    return () => {};
  }

  let raf = 0;
  let running = typeof document === "undefined" ? true : !document.hidden;

  const loop = (ts: number) => {
    if (!running) {
      return;
    }
    const wave = (Math.sin((ts / DERBI_GLOW_PULSE_MS) * Math.PI * 2) + 1) / 2;
    const opacity =
      DERBI_GLOW_OPACITY_MIN +
      wave * (DERBI_GLOW_OPACITY_MAX - DERBI_GLOW_OPACITY_MIN);
    const width =
      DERBI_GLOW_WIDTH_MIN + wave * (DERBI_GLOW_WIDTH_MAX - DERBI_GLOW_WIDTH_MIN);
    applyGlowPaint(map, opacity, width);
    raf = requestAnimationFrame(loop);
  };

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      applyGlowPaint(map, DERBI_GLOW_STATIC_OPACITY, DERBI_GLOW_STATIC_WIDTH);
      return;
    }
    running = true;
    raf = requestAnimationFrame(loop);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  raf = requestAnimationFrame(loop);

  return () => {
    running = false;
    if (raf) {
      cancelAnimationFrame(raf);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

/** OS media query or the in-app Settings toggle (`shouldReduceMotion`). */
export function prefersReducedMotion(): boolean {
  return shouldReduceMotion();
}
