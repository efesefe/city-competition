"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import maplibregl from "maplibre-gl";
import { useCityData } from "@/context/CityDataContext";
import { useConquest } from "@/context/ConquestContext";
import { useRealtime } from "@/context/RealtimeContext";
import type { City } from "@/lib/cities-api";
import type { Derby } from "@/lib/derbies-api";
import { ensureTribeCrestImage } from "@/lib/map/crestIcons";
import {
  applyDerbiActiveStates,
  applyAllCityFillStates,
  buildCrestFeatureCollection,
  buildLabelFeatureCollection,
  CITIES_DERBI_GLOW_LAYER_ID,
  CITIES_FILL_LAYER_ID,
  CITIES_LABEL_LAYER_ID,
  CITIES_OUTLINE_LAYER_ID,
  CITIES_SELECTED_LAYER_ID,
  CITIES_TENSION_RING_LAYER_ID,
  CITIES_TICKER_HIGHLIGHT_LAYER_ID,
  CITIES_SOURCE_ID,
  CRESTS_LAYER_ID,
  CRESTS_SOURCE_ID,
  LABELS_SOURCE_ID,
  type CrestFeatureCollection,
  type LabelFeatureCollection,
} from "@/lib/map/ownership";
import {
  applyContestTensionStates,
  contestTensionColorPaint,
  contestTensionOpacityPaint,
  contestTensionWidthPaint,
} from "@/lib/map/contestTension";
import {
  DERBI_GLOW_BLUR,
  DERBI_GLOW_COLOR,
  DERBI_GLOW_STATIC_OPACITY,
  DERBI_GLOW_STATIC_WIDTH,
  derbiFillColorPaint,
  derbiFillOpacityPaint,
  derbiGlowOpacityExpression,
  derbiGlowWidthExpression,
  nextUrgencyTransitionMs,
  prefersReducedMotion,
  startDerbiGlowPulse,
  urgencyIlCodes,
} from "@/lib/map/derbiUrgency";
import { TURKIYE_MAP_STYLE } from "@/lib/map/style";
import DerbiCityOverlay from "./DerbiCityOverlay";
import MomentumBadge from "./MomentumBadge";
import {
  TURKIYE_BOUNDS,
  TURKIYE_MAX_BOUNDS,
  TURKIYE_MAX_ZOOM,
  TURKIYE_MIN_ZOOM,
} from "@/lib/map/turkiyeBounds";
import { type MapBBox } from "@/lib/realtimeSocket";
import { fetchProvincesGeoJSON } from "@/lib/support-api";
import type { Tribe } from "@/lib/tribes-api";
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

/** Paint fills/labels/crests from CityData — safe once polygon + overlay sources exist. */
function syncOwnershipOverlay(
  map: maplibregl.Map,
  cities: City[],
  tribesById: Record<string, Tribe>,
  labelsRef: { current: LabelFeatureCollection },
  crestsRef: { current: CrestFeatureCollection },
  derbies: Derby[] = [],
  previousDerbiIl?: { current: Set<string> },
): void {
  if (!map.getSource(CITIES_SOURCE_ID)) {
    return;
  }

  for (const tribe of Object.values(tribesById)) {
    ensureTribeCrestImage(map, tribe);
  }

  applyAllCityFillStates(map, cities);
  applyContestTensionStates(map, cities);
  if (previousDerbiIl) {
    previousDerbiIl.current = applyDerbiActiveStates(
      map,
      urgencyIlCodes(derbies, Date.now()),
      previousDerbiIl.current,
    );
  }

  const nextLabels = buildLabelFeatureCollection(cities);
  labelsRef.current = nextLabels;
  const labelSource = map.getSource(LABELS_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined;
  labelSource?.setData(nextLabels);

  const nextCrests = buildCrestFeatureCollection(cities);
  crestsRef.current = nextCrests;
  const crestSource = map.getSource(CRESTS_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined;
  crestSource?.setData(nextCrests);
}

export type HighlightPulse = {
  ilCode: string;
  nonce: number;
};

type TurkiyeMapProps = {
  initialIlCode?: string | null;
  selectedIlCode?: string | null;
  highlightPulse?: HighlightPulse | null;
  onCitySelect?: (city: SelectedCity) => void;
  derbies?: Derby[];
  perfModeEnabled?: boolean;
};

const TICKER_HIGHLIGHT_MS = 1600;

export default function TurkiyeMap({
  initialIlCode,
  selectedIlCode,
  highlightPulse = null,
  onCitySelect,
  derbies = [],
  perfModeEnabled = false,
}: TurkiyeMapProps) {
  const t = useTranslations("map");
  const { cities, tribesById, status: cityStatus } = useCityData();
  const { registerMapProject } = useConquest();
  const { sendViewport, sendViewportNow, setBBoxGetter } = useRealtime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onCitySelect);
  const citiesRef = useRef(cities);
  const tribesRef = useRef(tribesById);
  const cityStatusRef = useRef(cityStatus);
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
  const labelsRef = useRef<LabelFeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const lastFlownRef = useRef<string | null>(null);
  const lastPulseNonceRef = useRef<number | null>(null);
  const derbiesRef = useRef(derbies);
  const previousDerbiIlRef = useRef<Set<string>>(new Set());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  onSelectRef.current = onCitySelect;
  citiesRef.current = cities;
  tribesRef.current = tribesById;
  cityStatusRef.current = cityStatus;
  sendViewportRef.current = sendViewport;
  sendViewportNowRef.current = sendViewportNow;
  initialIlRef.current = initialIlCode;
  derbiesRef.current = derbies;

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
              "fill-color": derbiFillColorPaint(),
              "fill-opacity": derbiFillOpacityPaint(),
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
            id: CITIES_TENSION_RING_LAYER_ID,
            type: "line",
            source: CITIES_SOURCE_ID,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": contestTensionColorPaint(),
              "line-width": contestTensionWidthPaint(),
              "line-opacity": contestTensionOpacityPaint(),
              "line-blur": 0,
            },
          });

          map.addLayer({
            id: CITIES_DERBI_GLOW_LAYER_ID,
            type: "line",
            source: CITIES_SOURCE_ID,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": DERBI_GLOW_COLOR,
              "line-blur": DERBI_GLOW_BLUR,
              "line-opacity": derbiGlowOpacityExpression(
                DERBI_GLOW_STATIC_OPACITY,
              ),
              "line-width": derbiGlowWidthExpression(DERBI_GLOW_STATIC_WIDTH),
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
            id: CITIES_TICKER_HIGHLIGHT_LAYER_ID,
            type: "line",
            source: CITIES_SOURCE_ID,
            filter: ["==", ["get", "il_code"], ""],
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#f5e6b8",
              "line-width": 4,
              "line-opacity": 0.95,
              "line-blur": 0.4,
            },
          });

          const labelData = buildLabelFeatureCollection(citiesRef.current);
          labelsRef.current = labelData;
          map.addSource(LABELS_SOURCE_ID, {
            type: "geojson",
            data: labelData,
          });

          map.addLayer({
            id: CITIES_LABEL_LAYER_ID,
            type: "symbol",
            source: LABELS_SOURCE_ID,
            layout: {
              "text-field": ["get", "name"],
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
              "text-anchor": "top",
              "text-offset": [0, 0.55],
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
                0.56,
                7,
                0.88,
                9,
                1.2,
              ],
              "icon-anchor": "bottom",
              "icon-offset": [0, -2],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "text-allow-overlap": true,
            },
          });

          // Re-apply once the polygon source finishes indexing so feature-state
          // sticks even if CityData became ready before/during GeoJSON load.
          const onCitiesSourceData = (e: maplibregl.MapSourceDataEvent) => {
            if (e.sourceId !== CITIES_SOURCE_ID || !e.isSourceLoaded) {
              return;
            }
            if (cityStatusRef.current !== "ready") {
              return;
            }
            syncOwnershipOverlay(
              map,
              citiesRef.current,
              tribesRef.current,
              labelsRef,
              crestsRef,
              derbiesRef.current,
              previousDerbiIlRef,
            );
          };
          map.on("sourcedata", onCitiesSourceData);

          if (cityStatusRef.current === "ready") {
            syncOwnershipOverlay(
              map,
              citiesRef.current,
              tribesRef.current,
              labelsRef,
              crestsRef,
              derbiesRef.current,
              previousDerbiIlRef,
            );
          }
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

  // Live ownership: feature-state + crest/label points only (never refetch polygons)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || cityStatus !== "ready") {
      return;
    }
    syncOwnershipOverlay(
      map,
      cities,
      tribesById,
      labelsRef,
      crestsRef,
      derbiesRef.current,
      previousDerbiIlRef,
    );
  }, [cities, tribesById, cityStatus, mapReady]);

  // Derby urgency: feature-state + local clock so styling clears at ends_at
  // without waiting for the 60s HTTP poll.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const intervalId = window.setInterval(tick, 60_000);
    const nextAt = nextUrgencyTransitionMs(derbies, Date.now());
    let timeoutId: number | undefined;
    if (nextAt !== null) {
      timeoutId = window.setTimeout(tick, Math.max(0, nextAt - Date.now() + 25));
    }
    return () => {
      window.clearInterval(intervalId);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [derbies, nowMs]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    previousDerbiIlRef.current = applyDerbiActiveStates(
      map,
      urgencyIlCodes(derbies, nowMs),
      previousDerbiIlRef.current,
    );
  }, [derbies, nowMs, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    const hasUrgency = urgencyIlCodes(derbies, nowMs).size > 0;
    if (!hasUrgency) {
      return;
    }
    const animate = !perfModeEnabled && !prefersReducedMotion();
    return startDerbiGlowPulse(map, animate);
  }, [derbies, nowMs, mapReady, perfModeEnabled]);

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

  // Deep-link / toast tap: fly the camera to the selected city centroid.
  useEffect(() => {
    const map = mapRef.current;
    const code = (selectedIlCode ?? initialIlCode)?.trim() || null;
    if (!map || !mapReady || !code || cityStatus !== "ready") {
      if (!code) lastFlownRef.current = null;
      return;
    }
    const pulseCode = highlightPulse?.ilCode?.trim() || null;
    if (pulseCode && pulseCode === code) {
      return;
    }
    if (lastFlownRef.current === code) {
      return;
    }
    const city = cities.find((c) => c.id === code);
    if (!city) {
      return;
    }
    lastFlownRef.current = code;
    map.flyTo({
      center: [city.centroid.lng, city.centroid.lat],
      zoom: Math.max(map.getZoom(), 7),
      duration: 900,
      essential: true,
    });
  }, [
    selectedIlCode,
    initialIlCode,
    highlightPulse,
    mapReady,
    cityStatus,
    cities,
  ]);

  // Ticker tap: always fly (even if already selected) and flash a brief ring.
  useEffect(() => {
    const map = mapRef.current;
    const nonce = highlightPulse?.nonce;
    const code = highlightPulse?.ilCode?.trim() || "";
    if (!map || !mapReady || !code || nonce == null || cityStatus !== "ready") {
      return;
    }
    if (lastPulseNonceRef.current === nonce) {
      return;
    }
    const city = citiesRef.current.find((c) => c.id === code);
    if (!city) {
      return;
    }
    lastPulseNonceRef.current = nonce;
    lastFlownRef.current = code;
    map.flyTo({
      center: [city.centroid.lng, city.centroid.lat],
      zoom: Math.max(map.getZoom(), 7),
      duration: 900,
      essential: true,
    });
    if (map.getLayer(CITIES_TICKER_HIGHLIGHT_LAYER_ID)) {
      map.setFilter(CITIES_TICKER_HIGHLIGHT_LAYER_ID, [
        "==",
        ["get", "il_code"],
        code,
      ]);
    }
    const timer = window.setTimeout(() => {
      const current = mapRef.current;
      if (current?.getLayer(CITIES_TICKER_HIGHLIGHT_LAYER_ID)) {
        current.setFilter(CITIES_TICKER_HIGHLIGHT_LAYER_ID, [
          "==",
          ["get", "il_code"],
          "",
        ]);
      }
    }, TICKER_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightPulse, mapReady, cityStatus]);

  useEffect(() => {
    registerMapProject((ilCode) => {
      const map = mapRef.current;
      const city = citiesRef.current.find((c) => c.id === ilCode);
      if (!map || !city) return null;
      const point = map.project([city.centroid.lng, city.centroid.lat]);
      return { x: point.x, y: point.y };
    });
    return () => registerMapProject(null);
  }, [registerMapProject]);

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
      {mapReady && mapRef.current ? (
        <>
          <DerbiCityOverlay
            map={mapRef.current}
            cities={cities}
            derbies={derbies}
            nowMs={nowMs}
          />
          <MomentumBadge map={mapRef.current} cities={cities} />
        </>
      ) : null}
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
