"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import type { HeatmapProvince } from "@/lib/analytics-api";
import {
  fetchProvincesGeoJSON,
  type ProvinceFeatureCollection,
} from "@/lib/support-api";
import { NEUTRAL_PROVINCE_COLOR } from "@/components/ProvinceChoropleth";
import styles from "./AnalyticsHeatmap.module.css";

const SOURCE_ID = "analytics-provinces";
const FILL_LAYER_ID = "analytics-provinces-fill";
const LINE_LAYER_ID = "analytics-provinces-line";
const TURKIYE_CENTER: [number, number] = [35.0, 39.0];

const fillColor: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "support_intensity"], 0],
  0,
  "#1a2f2a",
  40,
  "#3d8f74",
  100,
  "#b8e6d4",
];

const fillOpacity: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "support_intensity"], 0],
  0,
  0.12,
  100,
  0.78,
];

function mergeHeatmapIntoGeoJSON(
  geojson: ProvinceFeatureCollection,
  rows: HeatmapProvince[],
): ProvinceFeatureCollection {
  const max = Math.max(0, ...rows.map((r) => r.effective_support_sum));
  const byIl = new Map(rows.map((row) => [row.il_code, row]));
  return {
    ...geojson,
    features: geojson.features.map((feature) => {
      const ilCode = String(feature.properties?.il_code ?? "");
      const row = byIl.get(ilCode);
      const sum = row?.effective_support_sum ?? 0;
      const intensity = max > 0 ? (sum / max) * 100 : 0;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          primary_color: row?.primary_color ?? NEUTRAL_PROVINCE_COLOR,
          control_pct: row?.control_pct ?? 0,
          support_intensity: intensity,
          effective_support_sum: sum,
        },
      };
    }),
  };
}

export default function AnalyticsHeatmap({
  provinces,
}: {
  provinces: HeatmapProvince[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const provincesRef = useRef(provinces);
  provincesRef.current = provinces;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const styleURL =
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
      "https://tiles.openfreemap.org/styles/liberty";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleURL,
      center: TURKIYE_CENTER,
      zoom: 5.2,
    });
    mapRef.current = map;

    let cancelled = false;

    map.on("load", async () => {
      try {
        const geojson = await fetchProvincesGeoJSON();
        if (cancelled || !mapRef.current) {
          return;
        }
        const data = mergeHeatmapIntoGeoJSON(geojson, provincesRef.current);
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: data as unknown as maplibregl.GeoJSONSourceSpecification["data"],
        });
        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            "fill-color": fillColor,
            "fill-opacity": fillOpacity,
          },
        });
        map.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": "#8fb5a8",
            "line-width": 0.6,
            "line-opacity": 0.55,
          },
        });
      } catch {
        // Parent page surfaces auth/load errors.
      }
    });

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) {
      return;
    }
    void fetchProvincesGeoJSON().then((geojson) => {
      const source = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(
        mergeHeatmapIntoGeoJSON(
          geojson,
          provinces,
        ) as unknown as Parameters<maplibregl.GeoJSONSource["setData"]>[0],
      );
    });
  }, [provinces]);

  return (
    <div className={styles.wrap}>
      <div
        ref={containerRef}
        className={styles.map}
        role="img"
        aria-label="İl destek ısı haritası"
      />
      <p className={styles.legend}>
        Yoğunluk: özet tablolardaki il bazlı toplam etkin destek (ledger
        taraması yok).
      </p>
    </div>
  );
}
