import type { Map as MaplibreMap } from "maplibre-gl";
import type { City } from "@/lib/cities-api";
import { NEUTRAL_TRIBE_COLOR, tribeAccentColor } from "@/lib/tribeCrest";
import { tribeCrestImageId } from "@/lib/map/crestIcons";

export const CITIES_SOURCE_ID = "cities";
export const CITIES_FILL_LAYER_ID = "cities-fill";
export const CITIES_OUTLINE_LAYER_ID = "cities-outline";
export const CITIES_DERBI_GLOW_LAYER_ID = "cities-derbi-glow";
export const CITIES_SELECTED_LAYER_ID = "cities-selected";
export const CITIES_TICKER_HIGHLIGHT_LAYER_ID = "cities-ticker-highlight";
export const CITIES_LABEL_LAYER_ID = "cities-label";
export const LABELS_SOURCE_ID = "city-labels";
export const CRESTS_SOURCE_ID = "city-crests";
export const CRESTS_LAYER_ID = "cities-crest";

export type CityFillState = {
  primary_color: string;
  derbi_active?: boolean;
};

/** Resolve fill color for feature-state from a city's controlling tribe. */
export function cityFillColor(city: City): string {
  const color = city.controlling_tribe?.primary_color;
  return tribeAccentColor(
    color ? { primary_color: color } : null,
  );
}

/** Apply (or clear) feature-state fill for a single city — no GeoJSON reload. */
export function applyCityFeatureState(
  map: MaplibreMap,
  ilCode: string,
  primaryColor: string | null | undefined,
  sourceId: string = CITIES_SOURCE_ID,
): void {
  if (!map.getSource(sourceId)) {
    return;
  }
  const color =
    primaryColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primaryColor.trim())
      ? primaryColor.trim()
      : NEUTRAL_TRIBE_COLOR;
  map.setFeatureState(
    { source: sourceId, id: ilCode },
    { primary_color: color } satisfies CityFillState,
  );
}

/** Sync feature-state for every city from CityDataContext. */
export function applyAllCityFillStates(
  map: MaplibreMap,
  cities: City[],
  sourceId: string = CITIES_SOURCE_ID,
): void {
  for (const city of cities) {
    applyCityFeatureState(
      map,
      city.id,
      city.controlling_tribe?.primary_color,
      sourceId,
    );
  }
}

/** Set or clear the derbi urgency flag for one city. Merges with fill color. */
export function applyDerbiActiveState(
  map: MaplibreMap,
  ilCode: string,
  active: boolean,
  sourceId: string = CITIES_SOURCE_ID,
): void {
  if (!map.getSource(sourceId)) {
    return;
  }
  map.setFeatureState({ source: sourceId, id: ilCode }, { derbi_active: active });
}

/**
 * Sync derbi_active feature-state. Clears cities that dropped out of the
 * urgency set so glow/fill never linger after a derby ends.
 */
export function applyDerbiActiveStates(
  map: MaplibreMap,
  activeIlCodes: Iterable<string>,
  previousIlCodes: Iterable<string> = [],
  sourceId: string = CITIES_SOURCE_ID,
): Set<string> {
  const next = new Set(activeIlCodes);
  const previous = new Set(previousIlCodes);
  for (const ilCode of previous) {
    if (!next.has(ilCode)) {
      applyDerbiActiveState(map, ilCode, false, sourceId);
    }
  }
  for (const ilCode of next) {
    applyDerbiActiveState(map, ilCode, true, sourceId);
  }
  return next;
}

export type LabelPointProperties = {
  il_code: string;
  name: string;
};

export type LabelFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: LabelPointProperties;
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
  }>;
};

/** One label point per city at its API centroid (avoids MultiPolygon duplicates). */
export function buildLabelFeatureCollection(
  cities: City[],
): LabelFeatureCollection {
  const features: LabelFeatureCollection["features"] = [];
  for (const city of cities) {
    features.push({
      type: "Feature",
      id: city.id,
      properties: {
        il_code: city.id,
        name: city.name,
      },
      geometry: {
        type: "Point",
        coordinates: [city.centroid.lng, city.centroid.lat],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export type CrestPointProperties = {
  il_code: string;
  tribe_id: string;
  icon: string;
};

export type CrestFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: CrestPointProperties;
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
  }>;
};

/** Build crest point GeoJSON for cities that have a controlling tribe. */
export function buildCrestFeatureCollection(
  cities: City[],
): CrestFeatureCollection {
  const features: CrestFeatureCollection["features"] = [];
  for (const city of cities) {
    const tribeId = city.controlling_tribe?.tribe_id;
    if (!tribeId) {
      continue;
    }
    features.push({
      type: "Feature",
      id: city.id,
      properties: {
        il_code: city.id,
        tribe_id: tribeId,
        icon: tribeCrestImageId(tribeId),
      },
      geometry: {
        type: "Point",
        coordinates: [city.centroid.lng, city.centroid.lat],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Patch a single crest feature after an ownership change without touching
 * the polygon GeoJSON source.
 */
export function upsertCrestFeature(
  collection: CrestFeatureCollection,
  city: City,
): CrestFeatureCollection {
  const without = collection.features.filter((f) => f.properties.il_code !== city.id);
  const tribeId = city.controlling_tribe?.tribe_id;
  if (!tribeId) {
    return { type: "FeatureCollection", features: without };
  }
  return {
    type: "FeatureCollection",
    features: [
      ...without,
      {
        type: "Feature",
        id: city.id,
        properties: {
          il_code: city.id,
          tribe_id: tribeId,
          icon: tribeCrestImageId(tribeId),
        },
        geometry: {
          type: "Point",
          coordinates: [city.centroid.lng, city.centroid.lat],
        },
      },
    ],
  };
}
