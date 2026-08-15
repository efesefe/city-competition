import { describe, expect, it } from "vitest";
import type { City } from "@/lib/cities-api";
import {
  patchCityRegionFlip,
  patchCitySupport,
  reconcileCityControl,
} from "@/context/cityDataPatch";

const tribeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tribeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function city(partial: Partial<City> & Pick<City, "id">): City {
  return {
    name: partial.name ?? "Test",
    centroid: partial.centroid ?? { lng: 32, lat: 39 },
    controlling_tribe: partial.controlling_tribe ?? null,
    competing_tribes: partial.competing_tribes ?? [],
    ...partial,
  };
}

describe("reconcileCityControl", () => {
  it("derives controlling tribe from competing scores when controlling is null", () => {
    const before = city({
      id: "34",
      controlling_tribe: null,
      competing_tribes: [
        { tribe_id: tribeB, committed_credits: 20 },
        { tribe_id: tribeA, committed_credits: 50 },
      ],
    });
    const after = reconcileCityControl(before, {
      [tribeA]: "#111111",
      [tribeB]: "#336699",
    });
    expect(after.controlling_tribe?.tribe_id).toBe(tribeA);
    expect(after.controlling_tribe?.primary_color).toBe("#111111");
    expect(after.competing_tribes[0].tribe_id).toBe(tribeA);
    expect(after.contest_tension).toBeCloseTo(20 / 50);
  });

  it("clears controlling when competing is empty or all zero", () => {
    expect(
      reconcileCityControl(
        city({
          id: "06",
          controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
          competing_tribes: [],
        }),
        { [tribeA]: "#111111" },
      ).controlling_tribe,
    ).toBeNull();

    expect(
      reconcileCityControl(
        city({
          id: "06",
          controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
          competing_tribes: [{ tribe_id: tribeA, committed_credits: 0 }],
        }),
        { [tribeA]: "#111111" },
      ).controlling_tribe,
    ).toBeNull();
  });

  it("keeps existing primary_color when the same leader remains", () => {
    const after = reconcileCityControl(
      city({
        id: "34",
        controlling_tribe: { tribe_id: tribeA, primary_color: "#abcdef" },
        competing_tribes: [{ tribe_id: tribeA, committed_credits: 10 }],
      }),
      { [tribeA]: "#111111" },
    );
    expect(after.controlling_tribe?.primary_color).toBe("#abcdef");
  });
});

describe("patchCitySupport", () => {
  it("resolves primary_color from tribe roster when leadership flips", () => {
    const before = city({
      id: "34",
      controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      competing_tribes: [
        { tribe_id: tribeA, committed_credits: 10 },
        { tribe_id: tribeB, committed_credits: 5 },
      ],
    });
    const after = patchCitySupport(before, tribeB, 10, {
      [tribeA]: "#111111",
      [tribeB]: "#abcdef",
    });
    expect(after.controlling_tribe?.tribe_id).toBe(tribeB);
    expect(after.controlling_tribe?.primary_color).toBe("#abcdef");
  });

  it("recomputes contest_tension from competing scores on each spend", () => {
    const before = city({
      id: "34",
      controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      competing_tribes: [
        { tribe_id: tribeA, committed_credits: 100 },
        { tribe_id: tribeB, committed_credits: 40 },
      ],
      contest_tension: 0,
    });
    const rising = patchCitySupport(before, tribeB, 50, {
      [tribeA]: "#111111",
      [tribeB]: "#abcdef",
    });
    expect(rising.contest_tension).toBeCloseTo(0.9);
    expect(rising.controlling_tribe?.tribe_id).toBe(tribeA);

    const afterFlip = patchCitySupport(rising, tribeB, 200, {
      [tribeA]: "#111111",
      [tribeB]: "#abcdef",
    });
    expect(afterFlip.controlling_tribe?.tribe_id).toBe(tribeB);
    expect(afterFlip.contest_tension).toBeCloseTo(100 / 290);
    expect(afterFlip.contest_tension).toBeLessThan(rising.contest_tension ?? 1);
  });
});

describe("reconcileCityControl color on flip", () => {
  it("does not keep the previous owner's color when roster is missing", () => {
    const after = reconcileCityControl(
      city({
        id: "34",
        controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
        competing_tribes: [
          { tribe_id: tribeA, committed_credits: 10 },
          { tribe_id: tribeB, committed_credits: 50 },
        ],
      }),
      { [tribeA]: "#111111" },
    );
    expect(after.controlling_tribe?.tribe_id).toBe(tribeB);
    expect(after.controlling_tribe?.primary_color).not.toBe("#111111");
  });
});

describe("patchCityRegionFlip", () => {
  it("switches fill color to the new tribe from the roster", () => {
    const before = city({
      id: "34",
      controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      competing_tribes: [
        { tribe_id: tribeA, committed_credits: 80 },
        { tribe_id: tribeB, committed_credits: 20 },
      ],
    });
    const after = patchCityRegionFlip(
      before,
      { new_tribe_id: tribeB, winning_committed_credits: 120 },
      { [tribeA]: "#111111", [tribeB]: "#abcdef" },
    );
    expect(after.controlling_tribe?.tribe_id).toBe(tribeB);
    expect(after.controlling_tribe?.primary_color).toBe("#abcdef");
    expect(
      after.competing_tribes.find((c) => c.tribe_id === tribeB)?.committed_credits,
    ).toBe(120);
  });

  it("does not inherit the previous owner's hex when roster color is missing", () => {
    const before = city({
      id: "06",
      controlling_tribe: { tribe_id: tribeA, primary_color: "#ff0000" },
      competing_tribes: [{ tribe_id: tribeA, committed_credits: 40 }],
    });
    const after = patchCityRegionFlip(
      before,
      { new_tribe_id: tribeB, winning_committed_credits: 90 },
      { [tribeA]: "#ff0000" },
    );
    expect(after.controlling_tribe?.tribe_id).toBe(tribeB);
    expect(after.controlling_tribe?.primary_color).not.toBe("#ff0000");
  });
});
