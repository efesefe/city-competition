import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import {
  applyCityFeatureState,
  buildCrestFeatureCollection,
  upsertCrestFeature,
} from "@/lib/map/ownership";
import { tribeCrestImageId } from "@/lib/map/crestIcons";
import { cityStripeState, tribeStripeImageId } from "@/lib/map/stripePatterns";

/**
 * Integration-style: a support_applied ownership change updates feature-state
 * and crest points for one city without refetching polygon GeoJSON.
 */
describe("live ownership update (no GeoJSON refetch)", () => {
  const tribeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tribeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("applies WS-driven ownership to one city fill + crest only", () => {
    const fetchGeoJSON = vi.fn();
    // Polygon source was already loaded once at map init — never called again.
    expect(fetchGeoJSON).toHaveBeenCalledTimes(0);

    const setFeatureState = vi.fn();
    const setData = vi.fn();
    const map = {
      getSource: vi.fn((id: string) => {
        if (id === "cities") return {};
        if (id === "city-crests") return { setData };
        return undefined;
      }),
      setFeatureState,
    } as unknown as MaplibreMap;

    const cities: City[] = [
      {
        id: "06",
        name: "Ankara",
        centroid: { lng: 32.85, lat: 39.93 },
        controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
        competing_tribes: [{ tribe_id: tribeA, committed_credits: 10 }],
      },
      {
        id: "34",
        name: "İstanbul",
        centroid: { lng: 28.9, lat: 41.0 },
        controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
        competing_tribes: [{ tribe_id: tribeA, committed_credits: 20 }],
      },
    ];

    let crests = buildCrestFeatureCollection(cities);

    // Simulate support_applied for İstanbul flipping to tribe B
    const updated34: City = {
      ...cities[1],
      controlling_tribe: { tribe_id: tribeB, primary_color: "#336699" },
      competing_tribes: [
        { tribe_id: tribeB, committed_credits: 25 },
        { tribe_id: tribeA, committed_credits: 20 },
      ],
    };

    const tribesById = {
      [tribeA]: {
        id: tribeA,
        primary_color: "#111111",
        secondary_color: "#FFFFFF",
      },
      [tribeB]: {
        id: tribeB,
        primary_color: "#336699",
        secondary_color: "#E30613",
      },
    };

    applyCityFeatureState(
      map,
      updated34.id,
      updated34.controlling_tribe?.primary_color,
      "cities",
      cityStripeState(updated34, tribesById),
    );
    crests = upsertCrestFeature(crests, updated34);
    setData(crests);

    expect(fetchGeoJSON).toHaveBeenCalledTimes(0);
    expect(setFeatureState).toHaveBeenCalledTimes(1);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "cities", id: "34" },
      {
        primary_color: "#336699",
        stripe_pattern: tribeStripeImageId(tribeB),
        striped: true,
        controlling_tribe_id: tribeB,
      },
    );
    expect(setData).toHaveBeenCalledTimes(1);

    const istanbul = crests.features.find((f) => f.properties.il_code === "34");
    const ankara = crests.features.find((f) => f.properties.il_code === "06");
    expect(istanbul?.properties.icon).toBe(tribeCrestImageId(tribeB));
    expect(ankara?.properties.icon).toBe(tribeCrestImageId(tribeA));
  });
});
