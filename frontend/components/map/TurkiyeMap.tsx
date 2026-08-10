"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import { useCityData } from "@/context/CityDataContext";
import { useRealtime } from "@/context/RealtimeContext";
import { ensureTribeCrestImage } from "@/lib/map/crestIcons";
import {
  applyAllCityFillStates,
  buildCrestFeatureCollection,
  CITIES_FILL_LAYER_ID,
  CITIES_LABEL_LAYER_ID,
  CITIES_OUTLINE_LAYER_ID,
  CITIES_SELECTED_LAYER_ID,
  CITIES_SOURCE_ID,
  CRESTS_LAYER_ID,
  CRESTS_SOURCE_ID,
  type CrestFeatureCollection,
} from "@/lib/map/ownership";
import { TURKIYE_MAP_STYLE } from "@/lib/map/style";
import {
  TURKIYE_BOUNDS,
  TURKIYE_MAX_BOUNDS,
  TURKIYE_MAX_ZOOM,
  TURKIYE_MIN_ZOOM,
} from "@/lib/map/turkiyeBounds";
import { type MapBBox } from "@/lib/realtimeSocket";
import { fetchProvincesGeoJSON } from "@/lib/support-api";
import { NEUTRAL_TRIBE_COLOR } from "@/lib/tribeCrest";
import styles from "./TurkiyeMap.module.css";

export type SelectedCity = {
  il_code: string;
  name_tr: string;
  name_en: string;
};

function boundsToBBox(map: maplibregl.Map): MapBBox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

type TurkiyeMapProps = {
  initialIlCode?: string | null;
  selectedIlCode?: string | null;
  onCitySelect?: (city: SelectedCity) => void;
};

export default function TurkiyeMap({
  initialIlCode,
  selectedIlCode,
  onCitySelect,
}: TurkiyeMapProps) {
  const t = useTranslations("map");
  const { cities, tribesById, status: cityStatus } = useCityData();
  const { sendViewport, sendViewportNow, setBBoxGetter } = useRealtime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onCitySelect);
  const citiesRef = useRef(cities);
  const tribesRef = useRef(tribesById);
  const sendViewportRef = useRef(sendViewport);
  const sendViewportNowRef = useRef(sendViewportNow);
  const initialIlRef = useRef(initialIlCode);
  const geojsonFeaturesRef = useRef<
    Array<{ properties?: { il_code?: string; name_tr?: string; name_en?: string } }>
  >([]);
  const crestsRef = useRef<CrestFeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  onSelectRef.current = onCitySelect;
  citiesRef.current = cities;
  tribesRef.current = tribesById;
  sendViewportRef.current = sendViewport;
  sendViewportNowRef.current = sendViewportNow;
  initialIlRef.current = initialIlCode;

  // Init map once (stable deps — viewport callbacks via refs)
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TURKIYE_MAP_STYLE,
      bounds: TURKIYE_BOUNDS,
      fitBoundsOptions: { padding: 24, duration: 0 },
      maxBounds: TURKIYE_MAX_BOUNDS,
      minZoom: TURKIYE_MIN_ZOOM,
      maxZoom: TURKIYE_MAX_ZOOM,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    mapRef.current = map;

    setBBoxGetter(() => {
      const m = mapRef.current;
      return m ? boundsToBBox(m) : null;
    });

    let cancelled = false;

    map.on("load", () => {
      map.resize();
      void (async () => {
        try {
          const geojson = await fetchProvincesGeoJSON();
          if (cancelled || !mapRef.current) {
            return;
          }

          const features = geojson.features ?? [];
          if (features.length === 0) {
            setLoadError("empty_city_geojson");
            return;
          }
          geojsonFeaturesRef.current = features;

          map.addSource(CITIES_SOURCE_ID, {
            type: "geojson",
            data: geojson as unknown as maplibregl.GeoJSONSourceSpecification["data"],
            promoteId: "il_code",
          });

          map.addLayer({
            id: CITIES_FILL_LAYER_ID,
            type: "fill",
            source: CITIES_SOURCE_ID,
            paint: {
              "fill-color": [
                "case",
                ["!=", ["feature-state", "primary_color"], null],
                ["feature-state", "primary_color"],
                NEUTRAL_TRIBE_COLOR,
              ] as unknown as ExpressionSpecification,
              "fill-opacity": 0.88,
            },
          });

          map.addLayer({
            id: CITIES_OUTLINE_LAYER_ID,
            type: "line",
            source: CITIES_SOURCE_ID,
            paint: {
              "line-color": "#060e0c",
              "line-width": 1,
              "line-opacity": 0.85,
            },
          });

          map.addLayer({
            id: CITIES_SELECTED_LAYER_ID,
            type: "line",
            source: CITIES_SOURCE_ID,
            filter: ["==", ["get", "il_code"], ""],
            paint: {
              "line-color": "#e8d5a3",
              "line-width": 2.5,
              "line-opacity": 0.95,
            },
          });

          map.addLayer({
            id: CITIES_LABEL_LAYER_ID,
            type: "symbol",
            source: CITIES_SOURCE_ID,
            layout: {
              "text-field": ["get", "name_tr"],
              "text-font": ["Noto Sans Regular"],
              "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                9,
                7,
                11,
                9,
                13,
              ],
              "text-padding": 2,
              "text-max-width": 8,
              "symbol-sort-key": ["to-number", ["get", "il_code"]],
            },
            paint: {
              "text-color": "#f2f7f4",
              "text-halo-color": "rgba(8, 16, 14, 0.85)",
              "text-halo-width": 1.2,
            },
          });

          const crestData = buildCrestFeatureCollection(citiesRef.current);
          crestsRef.current = crestData;
          for (const tribe of Object.values(tribesRef.current)) {
            ensureTribeCrestImage(map, tribe);
          }

          map.addSource(CRESTS_SOURCE_ID, {
            type: "geojson",
            data: crestData,
          });

          map.addLayer({
            id: CRESTS_LAYER_ID,
            type: "symbol",
            source: CRESTS_SOURCE_ID,
            layout: {
              "icon-image": ["get", "icon"],
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                0.35,
                7,
                0.55,
                9,
                0.75,
              ],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "text-allow-overlap": true,
            },
          });

          applyAllCityFillStates(map, citiesRef.current);
          map.resize();

          const focus = initialIlRef.current?.trim() || null;
          if (focus) {
            const match = features.find(
              (f) => String(f.properties?.il_code) === focus,
            );
            if (match?.properties) {
              const props = match.properties;
              onSelectRef.current?.({
                il_code: String(props.il_code),
                name_tr: String(props.name_tr ?? ""),
                name_en: String(props.name_en ?? ""),
              });
              map.setFilter(CITIES_SELECTED_LAYER_ID, [
                "==",
                ["get", "il_code"],
                focus,
              ]);
            }
          }

          map.on("click", CITIES_FILL_LAYER_ID, (e) => {
            const feature = e.features?.[0];
            if (!feature?.properties) {
              return;
            }
            const ilCode = String(feature.properties.il_code);
            const nameTr = String(feature.properties.name_tr ?? "");
            const nameEn = String(feature.properties.name_en ?? "");
            onSelectRef.current?.({
              il_code: ilCode,
              name_tr: nameTr,
              name_en: nameEn,
            });
            if (map.getLayer(CITIES_SELECTED_LAYER_ID)) {
              map.setFilter(CITIES_SELECTED_LAYER_ID, [
                "==",
                ["get", "il_code"],
                ilCode,
              ]);
            }
          });

          map.on("mouseenter", CITIES_FILL_LAYER_ID, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", CITIES_FILL_LAYER_ID, () => {
            map.getCanvas().style.cursor = "";
          });

          const pushViewport = () => {
            const m = mapRef.current;
            if (!m) return;
            sendViewportRef.current(boundsToBBox(m));
          };
          map.on("moveend", pushViewport);
          map.on("zoomend", pushViewport);
          sendViewportNowRef.current(boundsToBBox(map));

          setLoadError(null);
          setMapReady(true);
        } catch (err) {
          if (!cancelled) {
            setLoadError(
              err instanceof Error ? err.message : "failed_to_load_cities",
            );
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      setBBoxGetter(null);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [setBBoxGetter]);

  // Apply ?il= / initial focus without recreating the map
  useEffect(() => {
    const map = mapRef.current;
    const focus = initialIlCode?.trim() || null;
    if (!map || !mapReady || !focus) {
      return;
    }
    const match = geojsonFeaturesRef.current.find(
      (f) => String(f.properties?.il_code) === focus,
    );
    if (!match?.properties) {
      return;
    }
    const props = match.properties;
    onSelectRef.current?.({
      il_code: String(props.il_code),
      name_tr: String(props.name_tr ?? ""),
      name_en: String(props.name_en ?? ""),
    });
    if (map.getLayer(CITIES_SELECTED_LAYER_ID)) {
      map.setFilter(CITIES_SELECTED_LAYER_ID, [
        "==",
        ["get", "il_code"],
        focus,
      ]);
    }
  }, [initialIlCode, mapReady]);

  // Live ownership: feature-state + crest points only (never refetch polygons)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || cityStatus !== "ready") {
      return;
    }
    if (!map.getSource(CITIES_SOURCE_ID)) {
      return;
    }

    for (const tribe of Object.values(tribesById)) {
      ensureTribeCrestImage(map, tribe);
    }

    applyAllCityFillStates(map, cities);

    const nextCrests = buildCrestFeatureCollection(cities);
    crestsRef.current = nextCrests;
    const crestSource = map.getSource(CRESTS_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    crestSource?.setData(nextCrests);
  }, [cities, tribesById, cityStatus, mapReady]);

  // External selection ring (e.g. parent sets selected after ?il=)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(CITIES_SELECTED_LAYER_ID)) {
      return;
    }
    const code = selectedIlCode?.trim() || "";
    map.setFilter(CITIES_SELECTED_LAYER_ID, [
      "==",
      ["get", "il_code"],
      code,
    ]);
  }, [selectedIlCode, mapReady]);

  return (
    <div className={styles.root}>
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label={t("ariaLabel")}
        data-testid="turkiye-map"
        data-map-ready={mapReady ? "true" : "false"}
      />
      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError === "empty_city_geojson"
            ? t("errors.emptyGeojson")
            : loadError}
        </p>
      ) : null}
    </div>
  );
}
