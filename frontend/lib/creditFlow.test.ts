import { describe, expect, it } from "vitest";
import {
  buildCoinTransforms,
  CREDIT_FLOW_ARC_LIFT_PX,
  CREDIT_FLOW_COIN_COUNT,
  decideCreditFlow,
  insetRect,
  isFlightTargetVisible,
  mapPointToViewport,
  rectCenter,
  type Point,
  type DecideCreditFlowInput,
} from "./creditFlow";
import type { Rect } from "./map/ambientAssets";

const MAP: Rect = { left: 0, top: 52, right: 390, bottom: 780 };
const ORIGIN: Point = { x: 195, y: 26 };

function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? 0;
    i += 1;
    return v;
  };
}

function baseInput(
  overrides: Partial<DecideCreditFlowInput> = {},
): DecideCreditFlowInput {
  return {
    reduceMotion: false,
    origin: ORIGIN,
    mapPoint: { x: 200, y: 120 },
    mapRect: MAP,
    random: () => 0.5,
    ...overrides,
  };
}

describe("mapPointToViewport", () => {
  it("adds the map container origin", () => {
    expect(mapPointToViewport({ x: 10, y: 20 }, MAP)).toEqual({
      x: 10,
      y: 72,
    });
  });
});

describe("rectCenter / insetRect", () => {
  it("returns the midpoint of a rect", () => {
    expect(rectCenter({ left: 10, top: 20, right: 30, bottom: 40 })).toEqual({
      x: 20,
      y: 30,
    });
  });

  it("shrinks a rect by the inset on every edge", () => {
    expect(insetRect(MAP, 8)).toEqual({
      left: 8,
      top: 60,
      right: 382,
      bottom: 772,
    });
  });
});

describe("isFlightTargetVisible", () => {
  it("accepts a point on the canvas", () => {
    expect(
      isFlightTargetVisible({
        target: { x: 200, y: 180 },
        mapRect: MAP,
      }),
    ).toBe(true);
  });

  it("rejects a point outside the map canvas", () => {
    expect(
      isFlightTargetVisible({
        target: { x: 200, y: 10 },
        mapRect: MAP,
      }),
    ).toBe(false);
    expect(
      isFlightTargetVisible({
        target: { x: 800, y: 200 },
        mapRect: MAP,
      }),
    ).toBe(false);
  });

  it("accepts a point on-canvas even where the support sheet would sit", () => {
    expect(
      isFlightTargetVisible({
        target: { x: 200, y: 620 },
        mapRect: MAP,
      }),
    ).toBe(true);
  });
});

describe("buildCoinTransforms", () => {
  it("emits an upward arc midpoint and a destination relative to origin", () => {
    const target = { x: 280, y: 220 };
    const coins = buildCoinTransforms(ORIGIN, target, 3, sequence([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    expect(coins).toHaveLength(3);
    expect(coins[0].dx).toBe(target.x - ORIGIN.x);
    expect(coins[0].dy).toBe(target.y - ORIGIN.y);
    expect(coins[0].my).toBeLessThan(0);
    expect(coins[0].my).toBeCloseTo(-CREDIT_FLOW_ARC_LIFT_PX, 5);
    expect(coins[2].delayMs).toBeGreaterThan(coins[0].delayMs);
  });
});

describe("decideCreditFlow", () => {
  it("plays a flight toward an on-screen city", () => {
    const decision = decideCreditFlow(baseInput());
    expect(decision.kind).toBe("flight");
    if (decision.kind !== "flight") return;
    expect(decision.target).toEqual({ x: 200, y: 172 });
    expect(decision.coins).toHaveLength(CREDIT_FLOW_COIN_COUNT);
    expect(decision.coins[0].dx).toBe(decision.target.x - ORIGIN.x);
    expect(decision.coins[0].dy).toBe(decision.target.y - ORIGIN.y);
  });

  it("ticks the balance when reduce-motion is on, even without a target", () => {
    const decision = decideCreditFlow(
      baseInput({
        reduceMotion: true,
        mapPoint: null,
        mapRect: null,
      }),
    );
    expect(decision).toEqual({ kind: "tick" });
  });

  it("skips when reduce-motion is on but the origin is missing", () => {
    expect(
      decideCreditFlow(baseInput({ reduceMotion: true, origin: null })),
    ).toEqual({ kind: "skip" });
  });

  it("skips when the city is off the map canvas", () => {
    const decision = decideCreditFlow(
      baseInput({
        mapPoint: { x: 200, y: -80 },
      }),
    );
    expect(decision).toEqual({ kind: "skip" });
  });

  it("plays when the landing point is on-canvas under the open support sheet", () => {
    const decision = decideCreditFlow(
      baseInput({
        mapPoint: { x: 180, y: 600 },
      }),
    );
    expect(decision.kind).toBe("flight");
    if (decision.kind !== "flight") return;
    expect(decision.target).toEqual({ x: 180, y: 652 });
  });

  it("skips when projectCity / the map container is missing (picker, first paint)", () => {
    expect(decideCreditFlow(baseInput({ mapPoint: null }))).toEqual({
      kind: "skip",
    });
    expect(decideCreditFlow(baseInput({ mapRect: null }))).toEqual({
      kind: "skip",
    });
    expect(decideCreditFlow(baseInput({ origin: null }))).toEqual({
      kind: "skip",
    });
  });

  it("does not invoke wallet helpers — the decision is geometry-only", () => {
    const decision = decideCreditFlow(baseInput());
    expect(decision.kind).toBe("flight");
    expect(decision).not.toHaveProperty("applyOptimisticDelta");
    expect(decision).not.toHaveProperty("reconcileBalance");
  });
});
