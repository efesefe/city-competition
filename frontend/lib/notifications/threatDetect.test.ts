import { afterEach, describe, expect, it } from "vitest";
import type { Rect } from "@/lib/map/ambientAssets";
import {
  alertFromCityCrossing,
  crossedThreatLevels,
  detectRivalThreat,
  isProjectedCityVisible,
  resetThreatCooldownForTests,
  seedCityThreatSnaps,
  tryConsumeThreatCooldown,
} from "./threatDetect";

const TRIBE_A = "tribe-a";
const TRIBE_B = "tribe-b";

describe("crossedThreatLevels", () => {
  it("fires 70 only when crossing the low band", () => {
    expect(crossedThreatLevels(0.65, 0.75)).toEqual([70]);
  });

  it("fires 90 after already being above 70", () => {
    expect(crossedThreatLevels(0.71, 0.91)).toEqual([90]);
  });

  it("keeps both when a spend jumps across both thresholds", () => {
    expect(crossedThreatLevels(0.6, 0.95)).toEqual([70, 90]);
  });

  it("does not recross while hovering above a threshold", () => {
    expect(crossedThreatLevels(0.71, 0.8)).toEqual([]);
  });

  it("fires nothing on a downward or unchanged move", () => {
    expect(crossedThreatLevels(0.85, 0.6)).toEqual([]);
    expect(crossedThreatLevels(0.7, 0.7)).toEqual([]);
  });
});

describe("detectRivalThreat", () => {
  it("returns the 70-level crossing for the controlling tribe", () => {
    expect(
      detectRivalThreat({
        previousTension: 0.65,
        nextTension: 0.75,
        previousControllingTribeId: TRIBE_A,
        nextControllingTribeId: TRIBE_A,
        userTribeId: TRIBE_A,
      }),
    ).toEqual({ level: 70, tensionPercent: 75 });
  });

  it("keeps the higher level when both thresholds cross", () => {
    expect(
      detectRivalThreat({
        previousTension: 0.6,
        nextTension: 0.95,
        previousControllingTribeId: TRIBE_A,
        nextControllingTribeId: TRIBE_A,
        userTribeId: TRIBE_A,
      }),
    ).toEqual({ level: 90, tensionPercent: 95 });
  });

  it("skips a flip even if tension numbers look hot", () => {
    expect(
      detectRivalThreat({
        previousTension: 0.65,
        nextTension: 0.95,
        previousControllingTribeId: TRIBE_A,
        nextControllingTribeId: TRIBE_B,
        userTribeId: TRIBE_A,
      }),
    ).toBeNull();
  });

  it("skips when the signed-in user is not the controlling tribe", () => {
    expect(
      detectRivalThreat({
        previousTension: 0.65,
        nextTension: 0.75,
        previousControllingTribeId: TRIBE_A,
        nextControllingTribeId: TRIBE_A,
        userTribeId: TRIBE_B,
      }),
    ).toBeNull();
  });
});

describe("seedCityThreatSnaps", () => {
  it("records current tension so a hydrate does not look like a crossing", () => {
    const snaps = seedCityThreatSnaps([
      {
        id: "34",
        contest_tension: 0.75,
        controlling_tribe: { tribe_id: TRIBE_A },
      },
    ]);
    expect(snaps["34"]).toEqual({ tension: 0.75, controller: TRIBE_A });
    expect(
      detectRivalThreat({
        previousTension: snaps["34"].tension,
        nextTension: 0.75,
        previousControllingTribeId: snaps["34"].controller,
        nextControllingTribeId: TRIBE_A,
        userTribeId: TRIBE_A,
      }),
    ).toBeNull();
  });
});

describe("tryConsumeThreatCooldown", () => {
  afterEach(() => {
    resetThreatCooldownForTests();
  });

  it("allows the first alert then blocks the same city+level inside the window", () => {
    const now = 1_000_000;
    expect(tryConsumeThreatCooldown("34", 70, now)).toBe(true);
    expect(tryConsumeThreatCooldown("34", 70, now + 60_000)).toBe(false);
  });

  it("tracks 70 and 90 independently", () => {
    const now = 1_000_000;
    expect(tryConsumeThreatCooldown("34", 70, now)).toBe(true);
    expect(tryConsumeThreatCooldown("34", 90, now)).toBe(true);
  });

  it("allows a repeat after the ttl", () => {
    const now = 1_000_000;
    const ttl = 10 * 60 * 1000;
    expect(tryConsumeThreatCooldown("34", 70, now, ttl)).toBe(true);
    expect(tryConsumeThreatCooldown("34", 70, now + ttl + 1, ttl)).toBe(true);
  });
});

describe("isProjectedCityVisible", () => {
  const mapRect: Rect = { left: 0, top: 52, right: 390, bottom: 780 };

  it("accepts a centroid on the canvas", () => {
    expect(
      isProjectedCityVisible({
        mapPoint: { x: 200, y: 120 },
        mapRect,
      }),
    ).toBe(true);
  });

  it("rejects a centroid off the canvas", () => {
    expect(
      isProjectedCityVisible({
        mapPoint: { x: -40, y: 120 },
        mapRect,
      }),
    ).toBe(false);
  });

  it("rejects a missing projection", () => {
    expect(
      isProjectedCityVisible({ mapPoint: null, mapRect }),
    ).toBe(false);
  });
});

describe("alertFromCityCrossing", () => {
  it("copies city identity onto the in-app alert", () => {
    expect(
      alertFromCityCrossing(
        {
          id: "34",
          name: "İstanbul",
          controlling_tribe: { tribe_id: TRIBE_A },
        },
        { level: 70, tensionPercent: 72 },
      ),
    ).toEqual({
      il_code: "34",
      city_name: "İstanbul",
      tribe_id: TRIBE_A,
      tension_percent: 72,
      level: 70,
    });
  });
});
