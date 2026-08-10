import type { ExpressionSpecification } from "maplibre-gl";
import type {
  ProvinceControlRow,
  ProvinceFeatureCollection,
} from "@/lib/support-api";

export const NEUTRAL_PROVINCE_COLOR = "#6b7280";

/** Data-driven fill color from feature primary_color (leading tribe). */
export const choroplethFillColor: ExpressionSpecification = [
  "coalesce",
  ["get", "primary_color"],
  NEUTRAL_PROVINCE_COLOR,
];

/** Opacity scales with control_pct (0–100). */
export const choroplethFillOpacity: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "control_pct"], 0],
  0,
  0.08,
  100,
  0.72,
];

/**
 * Merges leading-tribe control into GeoJSON feature properties for MapLibre paint.
 */
export function mergeControlIntoGeoJSON(
  geojson: ProvinceFeatureCollection,
  controlRows: ProvinceControlRow[],
): ProvinceFeatureCollection {
  const byIl = new Map(controlRows.map((row) => [row.il_code, row]));
  return {
    ...geojson,
    features: geojson.features.map((feature) => {
      const ilCode = String(feature.properties?.il_code ?? "");
      const row = byIl.get(ilCode);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          primary_color: row?.primary_color ?? NEUTRAL_PROVINCE_COLOR,
          control_pct: row?.control_pct ?? 0,
        },
      };
    }),
  };
}
