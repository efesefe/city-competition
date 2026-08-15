import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import { patchCitySupport } from "@/context/cityDataPatch";
import { tribeCrestImageId } from "@/lib/map/crestIcons";
import {
  applyAllCityFillStates,
  applyCityFeatureState,
  applyDerbiActiveStates,
  buildCrestFeatureCollection,
  buildLabelFeatureCollection,
  CITIES_TENSION_RING_LAYER_ID,
  cityFillColor,
  upsertCrestFeature,
} from "@/lib/map/ownership";
import { STRIPE_NONE_IMAGE_ID, tribeStripeImageId } from "@/lib/map/stripePatterns";
import { applyContestTensionStates } from "@/lib/map/contestTension";
import {
  TURKIYE_BOUNDS,
  TURKIYE_MAX_BOUNDS,
  TURKIYE_MAX_ZOOM,
  TURKIYE_MIN_ZOOM,
} from "@/lib/map/turkiyeBounds";
import { NEUTRAL_TRIBE_COLOR } from "@/lib/tribeCrest";

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

describe("turkiyeBounds", () => {
  it("uses the Track B country envelope and zoom ceiling", () => {
    expect(TURKIYE_BOUNDS[0]).toEqual([25.5, 35.8]);
    expect(TURKIYE_BOUNDS[1]).toEqual([45.0, 42.2]);
    expect(TURKIYE_MAX_BOUNDS[0][0]).toBeLessThan(TURKIYE_BOUNDS[0][0]);
    expect(TURKIYE_MAX_BOUNDS[1][0]).toBeGreaterThan(TURKIYE_BOUNDS[1][0]);
    expect(TURKIYE_MIN_ZOOM).toBe(5);
    expect(TURKIYE_MAX_ZOOM).toBe(9);
  });
});

describe("crestIcons", () => {
  it("caches icons under a stable tribe-scoped image id", () => {
    expect(tribeCrestImageId(tribeA)).toBe(`tribe-crest-${tribeA}`);
  });
});

describe("ownership helpers", () => {
  it("uses neutral gray when a city has no controlling tribe", () => {
    expect(cityFillColor(city({ id: "06" }))).toBe(NEUTRAL_TRIBE_COLOR);
  });

  it("builds crest points only for controlled cities", () => {
    const fc = buildCrestFeatureCollection([
      city({
        id: "06",
        controlling_tribe: { tribe_id: tribeA, primary_color: "#112233" },
      }),
      city({ id: "34" }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.il_code).toBe("06");
    expect(fc.features[0].properties.icon).toBe(tribeCrestImageId(tribeA));
    expect(fc.features[0].geometry.coordinates).toEqual([32, 39]);
  });

  it("builds exactly one label point per city at its centroid", () => {
    const cities = [
      city({ id: "34", name: "İstanbul", centroid: { lng: 28.9, lat: 41.0 } }),
      city({ id: "33", name: "Mersin", centroid: { lng: 34.6, lat: 36.8 } }),
      city({ id: "35", name: "İzmir", centroid: { lng: 27.1, lat: 38.4 } }),
      city({ id: "48", name: "Muğla", centroid: { lng: 28.4, lat: 37.2 } }),
      city({ id: "17", name: "Çanakkale", centroid: { lng: 26.4, lat: 40.1 } }),
    ];
    const fc = buildLabelFeatureCollection(cities);
    expect(fc.features).toHaveLength(5);
    const names = fc.features.map((f) => f.properties.name);
    expect(new Set(names).size).toBe(5);
    for (const feature of fc.features) {
      const match = cities.find((c) => c.id === feature.properties.il_code);
      expect(feature.geometry.coordinates).toEqual([
        match!.centroid.lng,
        match!.centroid.lat,
      ]);
      expect(feature.properties.name).toBe(match!.name);
    }
  });

  it("upserts a single crest without rebuilding unrelated cities", () => {
    let fc = buildCrestFeatureCollection([
      city({
        id: "06",
        controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      }),
    ]);
    fc = upsertCrestFeature(
      fc,
      city({
        id: "34",
        centroid: { lng: 29, lat: 41 },
        controlling_tribe: { tribe_id: tribeB, primary_color: "#222222" },
      }),
    );
    expect(fc.features).toHaveLength(2);
    fc = upsertCrestFeature(
      fc,
      city({
        id: "06",
        controlling_tribe: { tribe_id: tribeB, primary_color: "#222222" },
      }),
    );
    const six = fc.features.find((f) => f.properties.il_code === "06");
    expect(six?.properties.tribe_id).toBe(tribeB);
    expect(six?.properties.icon).toBe(tribeCrestImageId(tribeB));
  });

  it("setFeatureState updates one city without touching GeoJSON source data", () => {
    const setFeatureState = vi.fn();
    const getSource = vi.fn(() => ({}));
    const map = { setFeatureState, getSource } as unknown as MaplibreMap;

    applyCityFeatureState(map, "34", "#336699");

    expect(getSource).toHaveBeenCalledWith("cities");
    expect(setFeatureState).toHaveBeenCalledTimes(1);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      { primary_color: "#336699" },
    );
  });

  it("sets kit stripe feature-state from the tribe roster", () => {
    const setFeatureState = vi.fn();
    const getSource = vi.fn(() => ({}));
    const map = { setFeatureState, getSource } as unknown as MaplibreMap;

    applyAllCityFillStates(
      map,
      [
        city({
          id: "34",
          controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
        }),
        city({ id: "06" }),
      ],
      {
        [tribeA]: {
          id: tribeA,
          primary_color: "#111111",
          secondary_color: "#FFFFFF",
        },
      },
    );

    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      {
        primary_color: "#111111",
        stripe_pattern: tribeStripeImageId(tribeA),
        striped: true,
        controlling_tribe_id: tribeA,
      },
    );
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "06" },
      {
        primary_color: NEUTRAL_TRIBE_COLOR,
        stripe_pattern: STRIPE_NONE_IMAGE_ID,
        striped: false,
        controlling_tribe_id: "",
      },
    );
  });

  it("sets derbi_active and clears cities that dropped out of the urgency set", () => {
    const setFeatureState = vi.fn();
    const getSource = vi.fn(() => ({}));
    const map = { setFeatureState, getSource } as unknown as MaplibreMap;

    const first = applyDerbiActiveStates(map, ["34", "06"], []);
    expect([...first].sort()).toEqual(["06", "34"]);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      { derbi_active: true },
    );
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "06" },
      { derbi_active: true },
    );

    setFeatureState.mockClear();
    const next = applyDerbiActiveStates(map, ["34"], first);
    expect([...next]).toEqual(["34"]);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "06" },
      { derbi_active: false },
    );
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      { derbi_active: true },
    );
  });

  it("applies contest_tension feature-state without touching GeoJSON", () => {
    expect(CITIES_TENSION_RING_LAYER_ID).toBe("cities-tension-ring");
    const setFeatureState = vi.fn();
    const getSource = vi.fn(() => ({}));
    const map = { setFeatureState, getSource } as unknown as MaplibreMap;

    applyContestTensionStates(map, [
      city({ id: "34", contest_tension: 0.8 }),
    ]);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      { contest_tension: 0.8 },
    );
  });
});

describe("patchCitySupport color resolution", () => {
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

  it("keeps existing color when the same tribe remains leader", () => {
    const before = city({
      id: "34",
      controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      competing_tribes: [{ tribe_id: tribeA, committed_credits: 10 }],
    });
    const after = patchCitySupport(before, tribeA, 5, {
      [tribeA]: "#999999",
    });
    expect(after.controlling_tribe?.primary_color).toBe("#111111");
  });
});
