import { describe, expect, it } from "vitest";
import {
  AMBIENT_DELAY_MAX_MS,
  AMBIENT_DELAY_MIN_MS,
  AMBIENT_DEBUG_DELAY_MAX_MS,
  AMBIENT_DEBUG_DELAY_MIN_MS,
  AMBIENT_PATHS,
  CITY_CLEARANCE_DEG,
  EVENING_TINT_OPACITY,
  NIGHT_TINT_OPACITY,
  ambientSpritesEnabled,
  dayNightTint,
  istanbulHour,
  nextAmbientDelayMs,
  pathClearOfCity,
  pathClearOfSheet,
  pickAmbientSpawn,
  reversePathPoints,
  sampleCubicLngLat,
  supportSheetViewportRect,
  type LngLat,
} from "./ambientAssets";

const ISTANBUL: LngLat = { lng: 28.9, lat: 41.0 };
const IZMIR: LngLat = { lng: 27.1, lat: 38.4 };
const ANKARA: LngLat = { lng: 32.85, lat: 39.92 };

function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? 0;
    i += 1;
    return v;
  };
}

describe("nextAmbientDelayMs", () => {
  it("stays inside the 3–8 minute window", () => {
    expect(nextAmbientDelayMs(() => 0)).toBe(AMBIENT_DELAY_MIN_MS);
    expect(nextAmbientDelayMs(() => 1)).toBe(AMBIENT_DELAY_MAX_MS);
    const mid = nextAmbientDelayMs(() => 0.5);
    expect(mid).toBeGreaterThan(AMBIENT_DELAY_MIN_MS);
    expect(mid).toBeLessThan(AMBIENT_DELAY_MAX_MS);
  });

  it("uses a short window in debug mode", () => {
    expect(nextAmbientDelayMs(() => 0, true)).toBe(AMBIENT_DEBUG_DELAY_MIN_MS);
    expect(nextAmbientDelayMs(() => 1, true)).toBe(AMBIENT_DEBUG_DELAY_MAX_MS);
  });
});

describe("dayNightTint / istanbulHour", () => {
  it("reads Europe/Istanbul hour (midday and midnight)", () => {
    // 09:00 UTC = 12:00 Istanbul (UTC+3, year-round)
    expect(istanbulHour(new Date("2024-06-15T09:00:00.000Z"))).toBe(12);
    // 21:00 UTC = 00:00 Istanbul
    expect(istanbulHour(new Date("2024-06-14T21:00:00.000Z"))).toBe(0);
    // 14:30 UTC = 17:30 Istanbul (evening)
    expect(istanbulHour(new Date("2024-06-15T14:30:00.000Z"))).toBe(17);
  });

  it("applies no wash at midday", () => {
    const tint = dayNightTint(12);
    expect(tint.kind).toBe("day");
    expect(tint.opacity).toBe(0);
  });

  it("uses a capped warm wash in the evening", () => {
    const tint = dayNightTint(18);
    expect(tint.kind).toBe("evening");
    expect(tint.opacity).toBeLessThanOrEqual(EVENING_TINT_OPACITY);
    expect(tint.opacity).toBeGreaterThan(0);
    expect(tint.opacity).toBeLessThanOrEqual(0.1);
  });

  it("uses a capped cool wash at midnight", () => {
    const tint = dayNightTint(0);
    expect(tint.kind).toBe("night");
    expect(tint.opacity).toBeLessThanOrEqual(NIGHT_TINT_OPACITY);
    expect(tint.opacity).toBeGreaterThan(0);
    expect(tint.opacity).toBeLessThanOrEqual(0.12);
  });

  it("treats 06–16 as day, 17–20 as evening, else night", () => {
    expect(dayNightTint(6).kind).toBe("day");
    expect(dayNightTint(16).kind).toBe("day");
    expect(dayNightTint(17).kind).toBe("evening");
    expect(dayNightTint(20).kind).toBe("evening");
    expect(dayNightTint(21).kind).toBe("night");
    expect(dayNightTint(5).kind).toBe("night");
  });
});

describe("cubic paths", () => {
  it("samples endpoints and the midpoint of a linear bezier", () => {
    const points = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 1 },
      { lng: 2, lat: 2 },
      { lng: 3, lat: 3 },
    ] as const;
    expect(sampleCubicLngLat(points, 0)).toEqual({ lng: 0, lat: 0 });
    expect(sampleCubicLngLat(points, 1)).toEqual({ lng: 3, lat: 3 });
    const mid = sampleCubicLngLat(points, 0.5);
    expect(mid.lng).toBeCloseTo(1.5, 5);
    expect(mid.lat).toBeCloseTo(1.5, 5);
  });

  it("reverses control points", () => {
    const path = AMBIENT_PATHS[0];
    const reversed = reversePathPoints(path.points);
    expect(reversed[0]).toEqual(path.points[3]);
    expect(reversed[3]).toEqual(path.points[0]);
  });

  it("covers Aegean, Mediterranean, Black Sea, and Marmara", () => {
    const regions = new Set(AMBIENT_PATHS.map((p) => p.region));
    expect(regions).toEqual(
      new Set(["aegean", "mediterranean", "black_sea", "marmara"]),
    );
  });

  it("keeps authored paths away from inland Ankara", () => {
    for (const path of AMBIENT_PATHS) {
      expect(pathClearOfCity(path.points, ANKARA, CITY_CLEARANCE_DEG)).toBe(
        true,
      );
    }
  });
});

describe("avoidance", () => {
  it("rejects a path that clips the selected city", () => {
    const throughIstanbul = [
      { lng: 28.5, lat: 41.0 },
      { lng: 28.7, lat: 41.0 },
      { lng: 29.1, lat: 41.0 },
      { lng: 29.3, lat: 41.0 },
    ] as const;
    expect(pathClearOfCity(throughIstanbul, ISTANBUL)).toBe(false);
    expect(pathClearOfCity(throughIstanbul, IZMIR)).toBe(true);
  });

  it("rejects projected samples inside an open support sheet", () => {
    const path = AMBIENT_PATHS.find((p) => p.region === "mediterranean")!;
    const project = (p: LngLat) => ({ x: p.lng * 10, y: p.lat * 10 });
    const sheet = { left: 280, top: 350, right: 370, bottom: 370 };
    expect(pathClearOfSheet(path.points, project, sheet)).toBe(false);
  });

  it("does not pick a spawn over the selected coastal city", () => {
    // Always pick the first catalog path (aegean-north) and never reverse.
    const spawn = pickAmbientSpawn({
      random: sequence([0, 0.9, 0, 0, 0.9, 0]),
      selectedCentroid: IZMIR,
      attempts: 4,
    });
    if (spawn) {
      expect(pathClearOfCity(spawn.points, IZMIR)).toBe(true);
    }
  });

  it("returns null when every attempt intersects the sheet", () => {
    const project = () => ({ x: 50, y: 50 });
    const sheet = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(
      pickAmbientSpawn({
        random: () => 0,
        project,
        sheetRect: sheet,
        attempts: 3,
      }),
    ).toBeNull();
  });
});

describe("ambientSpritesEnabled", () => {
  it("suppresses sprites for reduce-motion or performance mode", () => {
    expect(ambientSpritesEnabled({ reduceMotion: true, perfMode: false })).toBe(
      false,
    );
    expect(ambientSpritesEnabled({ reduceMotion: false, perfMode: true })).toBe(
      false,
    );
    expect(ambientSpritesEnabled({ reduceMotion: false, perfMode: false })).toBe(
      true,
    );
  });
});

describe("supportSheetViewportRect", () => {
  it("pins a bottom sheet on narrow viewports", () => {
    const rect = supportSheetViewportRect(390, 800);
    expect(rect.left).toBe(0);
    expect(rect.right).toBe(390);
    expect(rect.bottom).toBe(800);
    expect(rect.top).toBeGreaterThan(0);
  });

  it("centers a card on wide viewports", () => {
    const rect = supportSheetViewportRect(1024, 800);
    expect(rect.right - rect.left).toBe(24 * 16);
    expect(rect.left).toBeGreaterThan(0);
  });
});
