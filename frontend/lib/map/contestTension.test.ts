import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import {
  CONTEST_TENSION_COLOR_HOT,
  CONTEST_TENSION_COLOR_MUTED,
  CONTEST_TENSION_DERBI_OPACITY_FACTOR,
  CONTEST_TENSION_DISPLAY_FLOOR,
  CONTEST_TENSION_OPACITY_MAX,
  CONTEST_TENSION_OPACITY_MIN,
  applyContestTensionStates,
  clampContestTension,
  contestTension,
  contestTensionColorPaint,
  contestTensionOpacityPaint,
  contestTensionWidthPaint,
} from "@/lib/map/contestTension";

describe("contestTension", () => {
  it("is second / first, matching backend ContestTension", () => {
    expect(
      contestTension([
        { committed_credits: 100 },
        { committed_credits: 90 },
      ]),
    ).toBeCloseTo(0.9);
    expect(
      contestTension([
        { committed_credits: 50 },
        { committed_credits: 100 },
      ]),
    ).toBeCloseTo(0.5);
  });

  it("returns 0 without two positive scores", () => {
    expect(contestTension([])).toBe(0);
    expect(contestTension([{ committed_credits: 10 }])).toBe(0);
    expect(
      contestTension([
        { committed_credits: 10 },
        { committed_credits: 0 },
      ]),
    ).toBe(0);
  });

  it("clamps above 1", () => {
    expect(clampContestTension(1.4)).toBe(1);
    expect(clampContestTension(-0.2)).toBe(0);
    expect(clampContestTension(undefined)).toBe(0);
  });
});

describe("contest-tension paint", () => {
  it("hides rings below the display floor and dims derby cities", () => {
    const opacity = JSON.stringify(contestTensionOpacityPaint());
    expect(opacity).toContain(String(CONTEST_TENSION_DISPLAY_FLOOR));
    expect(opacity).toContain(String(CONTEST_TENSION_OPACITY_MIN));
    expect(opacity).toContain(String(CONTEST_TENSION_OPACITY_MAX));
    expect(opacity).toContain(String(CONTEST_TENSION_DERBI_OPACITY_FACTOR));
    expect(opacity).toContain("derbi_active");
    expect(opacity).toContain('"<"');

    const width = JSON.stringify(contestTensionWidthPaint());
    expect(width).toContain(String(CONTEST_TENSION_DISPLAY_FLOOR));

    const color = JSON.stringify(contestTensionColorPaint());
    expect(color).toContain(CONTEST_TENSION_COLOR_MUTED);
    expect(color).toContain(CONTEST_TENSION_COLOR_HOT);
  });
});

describe("applyContestTensionStates", () => {
  it("writes contest_tension feature-state for every city", () => {
    const setFeatureState = vi.fn();
    const getSource = vi.fn(() => ({}));
    const map = { setFeatureState, getSource } as unknown as MaplibreMap;

    applyContestTensionStates(map, [
      {
        id: "34",
        name: "İstanbul",
        centroid: { lng: 29, lat: 41 },
        controlling_tribe: null,
        competing_tribes: [],
        contest_tension: 0.91,
      },
      {
        id: "06",
        name: "Ankara",
        centroid: { lng: 32, lat: 39 },
        controlling_tribe: null,
        competing_tribes: [],
        contest_tension: 0.1,
      },
    ]);

    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      { contest_tension: 0.91 },
    );
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "06" },
      { contest_tension: 0.1 },
    );
  });
});
