import { describe, expect, it } from "vitest";
import type { City } from "@/lib/cities-api";
import {
  STRIPE_BAND_CSS_PX,
  STRIPE_NONE_IMAGE_ID,
  STRIPE_PIXEL_RATIO,
  cityStripeState,
  stripeBandColors,
  stripeImagePixelSize,
  stripeLayerOpacityPaint,
  tribeStripeImageId,
  tribeStripeLayerId,
} from "@/lib/map/stripePatterns";

const tribeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function city(partial: Partial<City> & Pick<City, "id">): City {
  return {
    name: partial.name ?? "Test",
    centroid: partial.centroid ?? { lng: 32, lat: 39 },
    controlling_tribe: partial.controlling_tribe ?? null,
    competing_tribes: partial.competing_tribes ?? [],
    ...partial,
  };
}

describe("stripePatterns", () => {
  it("uses 14 CSS px bands rasterized at 2× (two-color period)", () => {
    expect(STRIPE_BAND_CSS_PX).toBe(14);
    const size = stripeImagePixelSize();
    expect(size.bandPx).toBe(14 * STRIPE_PIXEL_RATIO);
    expect(size.width).toBe(size.bandPx * 2);
    expect(size.height).toBe(size.bandPx);
  });

  it("paints Siyah Gelgit as black then white bands", () => {
    expect(stripeBandColors("#111111", "#FFFFFF")).toEqual({
      primary: "#111111",
      secondary: "#FFFFFF",
    });
  });

  it("maps a held city to tribe-stripes-{id}", () => {
    const pattern = cityStripeState(
      city({
        id: "34",
        controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
      }),
      {
        [tribeA]: {
          id: tribeA,
          primary_color: "#111111",
          secondary_color: "#FFFFFF",
        },
      },
    );
    expect(pattern).toEqual({
      stripe_pattern: tribeStripeImageId(tribeA),
      striped: true,
      controlling_tribe_id: tribeA,
    });
    expect(pattern.stripe_pattern).toBe(`tribe-stripes-${tribeA}`);
  });

  it("uses the transparent none tile when unowned or roster-missing", () => {
    expect(cityStripeState(city({ id: "06" }), {})).toEqual({
      stripe_pattern: STRIPE_NONE_IMAGE_ID,
      striped: false,
      controlling_tribe_id: "",
    });
    expect(
      cityStripeState(
        city({
          id: "34",
          controlling_tribe: { tribe_id: tribeA, primary_color: "#111111" },
        }),
        {},
      ),
    ).toEqual({
      stripe_pattern: STRIPE_NONE_IMAGE_ID,
      striped: false,
      controlling_tribe_id: "",
    });
  });

  it("keys a per-tribe stripe layer id", () => {
    expect(tribeStripeLayerId(tribeA)).toBe(`cities-stripes-${tribeA}`);
    expect(JSON.stringify(stripeLayerOpacityPaint(tribeA))).toContain(
      "controlling_tribe_id",
    );
  });
});
