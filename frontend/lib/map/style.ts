import type { StyleSpecification } from "maplibre-gl";

/**
 * Self-authored minimal style: sea background only.
 * Türkiye’s silhouette comes from the 81 city polygon fills added at runtime.
 * No road, rail, POI, building, or place layers exist in this style.
 *
 * Glyphs: OpenFreeMap Noto Sans (covers İıĞğŞşÇçÖöÜü).
 * See frontend/docs/maplibre-turkish-glyphs.md.
 */
export const TURKIYE_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "turkiye-minimal",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        // Slightly lighter sea so neutral city fills read clearly
        "background-color": "#152530",
      },
    },
  ],
};
