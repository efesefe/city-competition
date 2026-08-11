import { describe, expect, it } from "vitest";
import type { City } from "@/lib/cities-api";
import {
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
});
