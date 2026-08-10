"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import maplibregl from "maplibre-gl";
import LocaleToggle from "@/components/LocaleToggle";
import PerfModeToggle from "@/components/PerfModeToggle";
import { useRealtime } from "@/context/RealtimeContext";
import { useWallet } from "@/context/WalletContext";
import {
  fetchProvincesControl,
  fetchProvincesGeoJSON,
  postSupport,
  ProvinceProperties,
} from "@/lib/support-api";
import { type MapBBox, type SupportAppliedMessage } from "@/lib/realtimeSocket";
import { fetchWalletBalance } from "@/lib/wallet-api";
import {
  getChoroplethPerfConfig,
  getPerformanceModePreference,
  isPerformanceModeEnabled,
  type PerformanceModePreference,
} from "@/lib/performanceMode";
import {
  choroplethFillColor,
  choroplethFillOpacity,
  choroplethFillOpacityPerf,
  mergeControlIntoGeoJSON,
} from "./ProvinceChoropleth";
import styles from "./ProvinceMap.module.css";

const TURKIYE_CENTER: [number, number] = [35.0, 39.0];
const DEFAULT_ZOOM = 5.5;
const SOURCE_ID = "provinces";
const FILL_LAYER_ID = "provinces-fill";
const LINE_LAYER_ID = "provinces-line";
const SELECTED_LAYER_ID = "provinces-selected";

/**
 * Turkish glyph coverage (09.4): default OpenFreeMap Liberty style uses
 * Noto Sans Regular/Italic/Bold via
 * https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf — covers
 * İıĞğŞşÇçÖöÜü. See frontend/docs/maplibre-turkish-glyphs.md.
 */

type SelectedProvince = ProvinceProperties;

function boundsToBBox(map: maplibregl.Map): MapBBox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

export default function ProvinceMap({
  initialIlCode,
}: {
  initialIlCode?: string | null;
}) {
  const t = useTranslations("map");
  const tCommon = useTranslations("common");
  const { applyOptimisticDelta, reconcileBalance } = useWallet();
  const { subscribe, sendViewport, sendViewportNow, setBBoxGetter } =
    useRealtime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const liveMsgRef = useRef(t);
  const [perfPref, setPerfPref] = useState<PerformanceModePreference>(() =>
    typeof window !== "undefined" ? getPerformanceModePreference() : "auto",
  );
  const [selected, setSelected] = useState<SelectedProvince | null>(null);
  const [credits, setCredits] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const focusIl = initialIlCode?.trim() || null;

  liveMsgRef.current = t;

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "support_applied") return;
      const msg = event as SupportAppliedMessage;
      setMessage(
        liveMsgRef.current("liveSupport", {
          delta: msg.delta,
          ilCode: msg.il_code,
          tribeId: msg.tribe_id.slice(0, 8),
        }),
      );
    });
  }, [subscribe]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    setMapReady(false);

    const styleURL =
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
      "https://tiles.openfreemap.org/styles/liberty";

    const perfEnabled = isPerformanceModeEnabled(perfPref);
    const perf = getChoroplethPerfConfig(perfEnabled);
    const fillOpacity = perf.useSteppedOpacity
      ? choroplethFillOpacityPerf
      : choroplethFillOpacity;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleURL,
      center: TURKIYE_CENTER,
      zoom: DEFAULT_ZOOM,
      fadeDuration: perf.fadeDuration,
      antialias: perf.antialias,
      maxTileCacheSize: perf.maxTileCacheSize,
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
      void (async () => {
        try {
          const [geojson, control] = await Promise.all([
            fetchProvincesGeoJSON(),
            fetchProvincesControl(),
          ]);
          if (cancelled || !mapRef.current) {
            return;
          }
          const colored = mergeControlIntoGeoJSON(geojson, control.provinces);
          map.addSource(SOURCE_ID, {
            type: "geojson",
            data: colored as unknown as maplibregl.GeoJSONSourceSpecification["data"],
            tolerance: perf.geojsonTolerance,
          });
          map.addLayer({
            id: FILL_LAYER_ID,
            type: "fill",
            source: SOURCE_ID,
            paint: {
              "fill-color": choroplethFillColor,
              "fill-opacity": fillOpacity,
            },
          });
          map.addLayer({
            id: LINE_LAYER_ID,
            type: "line",
            source: SOURCE_ID,
            paint: {
              "line-color": "#1a3d34",
              "line-width": perf.lineWidth,
            },
          });
          map.addLayer({
            id: SELECTED_LAYER_ID,
            type: "fill",
            source: SOURCE_ID,
            filter: ["==", ["get", "il_code"], ""],
            paint: {
              "fill-color": "#c4a35a",
              "fill-opacity": 0.45,
            },
          });

          if (focusIl) {
            const match = colored.features.find(
              (f) => String(f.properties?.il_code) === focusIl,
            );
            if (match?.properties) {
              const props = match.properties;
              setSelected({
                il_code: String(props.il_code),
                name_tr: String(props.name_tr ?? ""),
                name_en: String(props.name_en ?? ""),
              });
              map.setFilter(SELECTED_LAYER_ID, [
                "==",
                ["get", "il_code"],
                focusIl,
              ]);
            }
          }

          map.on("click", FILL_LAYER_ID, (e) => {
            const feature = e.features?.[0];
            if (!feature?.properties) {
              return;
            }
            const props = feature.properties as ProvinceProperties;
            setSelected({
              il_code: String(props.il_code),
              name_tr: String(props.name_tr ?? ""),
              name_en: String(props.name_en ?? ""),
            });
            setMessage(null);
            setError(null);
            if (map.getLayer(SELECTED_LAYER_ID)) {
              map.setFilter(SELECTED_LAYER_ID, [
                "==",
                ["get", "il_code"],
                String(props.il_code),
              ]);
            }
          });

          map.on("mouseenter", FILL_LAYER_ID, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", FILL_LAYER_ID, () => {
            map.getCanvas().style.cursor = "";
          });

          const pushViewport = () => {
            const m = mapRef.current;
            if (!m) return;
            sendViewport(boundsToBBox(m));
          };
          map.on("moveend", pushViewport);
          map.on("zoomend", pushViewport);
          sendViewportNow(boundsToBBox(map));

          setMapReady(true);
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : "failed_to_load_provinces",
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
    };
  }, [focusIl, perfPref, sendViewport, sendViewportNow, setBBoxGetter]);

  async function onSupport(e: FormEvent) {
    e.preventDefault();
    if (!selected) {
      return;
    }
    const amount = Number.parseInt(credits, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("invalid_credits");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    applyOptimisticDelta(-amount);
    try {
      const result = await postSupport(selected.il_code, amount);
      reconcileBalance(result.balance_after);
      setMessage(
        t("supported", {
          province: selected.name_tr,
          credits: result.credits_spent,
          balance: result.balance_after,
        }),
      );
    } catch (err) {
      try {
        const { balance } = await fetchWalletBalance();
        reconcileBalance(balance);
      } catch {
        applyOptimisticDelta(amount);
      }
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : err instanceof Error
            ? err.message
            : "request_failed";
      setError(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label={t("ariaLabel")}
        data-testid="province-map"
        data-map-ready={mapReady ? "true" : "false"}
        data-perf-mode={isPerformanceModeEnabled(perfPref) ? "on" : "off"}
      />
      <aside className={styles.panel} aria-live="polite">
        <LocaleToggle />
        <PerfModeToggle value={perfPref} onChange={setPerfPref} />
        <p className={styles.brand}>{tCommon("brand")}</p>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.lead}>{t("lead")}</p>
        {selected ? (
          <form className={styles.form} onSubmit={onSupport}>
            <p className={styles.province}>
              <span className={styles.ilCode}>{selected.il_code}</span>
              {selected.name_tr}
            </p>
            <label className={styles.label} htmlFor="support-credits">
              {t("credits")}
            </label>
            <input
              id="support-credits"
              className={styles.input}
              type="number"
              min={1}
              step={1}
              value={credits}
              onChange={(ev) => setCredits(ev.target.value)}
              disabled={busy}
            />
            <button className={styles.button} type="submit" disabled={busy}>
              {busy ? t("supporting") : t("support")}
            </button>
          </form>
        ) : (
          <p className={styles.hint}>{t("hint")}</p>
        )}
        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </aside>
    </div>
  );
}
