import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import type { Tribe } from "@/lib/tribes-api";
import { NEUTRAL_TRIBE_COLOR } from "@/lib/tribeCrest";

/** One kit stripe in CSS pixels (wide, not a hatch). */
export const STRIPE_BAND_CSS_PX = 14;
export const STRIPE_PIXEL_RATIO = 2;
export const STRIPE_NONE_IMAGE_ID = "tribe-stripes-none";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function tribeStripeImageId(tribeId: string): string {
  return `tribe-stripes-${tribeId}`;
}

export function stripeImagePixelSize(): {
  width: number;
  height: number;
  bandPx: number;
} {
  const bandPx = STRIPE_BAND_CSS_PX * STRIPE_PIXEL_RATIO;
  return { width: bandPx * 2, height: bandPx, bandPx };
}

export function stripeBandColors(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): { primary: string; secondary: string } {
  const a = primary?.trim();
  const b = secondary?.trim();
  return {
    primary: a && HEX.test(a) ? a : NEUTRAL_TRIBE_COLOR,
    secondary: b && HEX.test(b) ? b : "#ffffff",
  };
}

export type CityStripeState = {
  stripe_pattern: string;
  striped: boolean;
  controlling_tribe_id: string;
};

/** Resolve stripe feature-state from the controlling tribe roster. */
export function cityStripeState(
  city: City,
  tribesById: Record<string, Pick<Tribe, "id" | "primary_color" | "secondary_color">>,
): CityStripeState {
  const tribeId = city.controlling_tribe?.tribe_id;
  if (!tribeId || !tribesById[tribeId]) {
    return {
      stripe_pattern: STRIPE_NONE_IMAGE_ID,
      striped: false,
      controlling_tribe_id: "",
    };
  }
  return {
    stripe_pattern: tribeStripeImageId(tribeId),
    striped: true,
    controlling_tribe_id: tribeId,
  };
}

export function tribeStripeLayerId(tribeId: string): string {
  return `cities-stripes-${tribeId}`;
}

/** Fully opaque kit stripes on the matching controller; hidden otherwise. */
export function stripeLayerOpacityPaint(tribeId: string): ExpressionSpecification {
  return [
    "case",
    ["==", ["feature-state", "controlling_tribe_id"], tribeId],
    1,
    0,
  ] as unknown as ExpressionSpecification;
}

function rasterizeStripes(
  primary: string,
  secondary: string,
): ImageData | null {
  const { width, height, bandPx } = stripeImagePixelSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, bandPx, height);
  ctx.fillStyle = secondary;
  ctx.fillRect(bandPx, 0, bandPx, height);
  return ctx.getImageData(0, 0, width, height);
}

function rasterizeTransparentNone(): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, 2, 2);
  return ctx.getImageData(0, 0, 2, 2);
}

/** Fully transparent tile so unowned cities never sample a missing image. */
export function ensureStripeNoneImage(map: MaplibreMap): string {
  if (!map.hasImage(STRIPE_NONE_IMAGE_ID)) {
    const imageData = rasterizeTransparentNone();
    if (imageData) {
      map.addImage(STRIPE_NONE_IMAGE_ID, imageData, {
        pixelRatio: STRIPE_PIXEL_RATIO,
      });
    }
  }
  return STRIPE_NONE_IMAGE_ID;
}

/**
 * Vertical primary|secondary kit stripes, registered once per tribe id.
 */
export function ensureTribeStripeImage(
  map: MaplibreMap,
  tribe: Pick<Tribe, "id" | "primary_color" | "secondary_color">,
): string {
  const imageId = tribeStripeImageId(tribe.id);
  if (map.hasImage(imageId)) {
    return imageId;
  }
  const { primary, secondary } = stripeBandColors(
    tribe.primary_color,
    tribe.secondary_color,
  );
  const imageData = rasterizeStripes(primary, secondary);
  if (imageData) {
    map.addImage(imageId, imageData, { pixelRatio: STRIPE_PIXEL_RATIO });
  }
  return imageId;
}

/**
 * One fill-pattern layer per tribe with a constant image id.
 * Feature-state cannot drive fill-pattern image names in MapLibre 4, so
 * opacity is keyed on controlling_tribe_id instead.
 */
export function ensureTribeStripeLayer(
  map: MaplibreMap,
  tribe: Pick<Tribe, "id" | "primary_color" | "secondary_color">,
  beforeId: string,
): string {
  const layerId = tribeStripeLayerId(tribe.id);
  ensureTribeStripeImage(map, tribe);
  if (map.getLayer(layerId) || !map.getSource("cities")) {
    return layerId;
  }
  const layer = {
    id: layerId,
    type: "fill" as const,
    source: "cities",
    paint: {
      "fill-pattern": tribeStripeImageId(tribe.id),
      "fill-opacity": stripeLayerOpacityPaint(tribe.id),
    },
  };
  if (map.getLayer(beforeId)) {
    map.addLayer(layer, beforeId);
  } else {
    map.addLayer(layer);
  }
  return layerId;
}
