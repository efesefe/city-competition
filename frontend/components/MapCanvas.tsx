"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

const TURKIYE_CENTER: [number, number] = [35.0, 39.0];
const DEFAULT_ZOOM = 5.5;

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const styleURL =
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
      "https://tiles.openfreemap.org/styles/liberty";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleURL,
      center: TURKIYE_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="map-canvas" role="application" aria-label="Türkiye map" />;
}
