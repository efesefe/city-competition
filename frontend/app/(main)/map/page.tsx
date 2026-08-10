"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import CityPicker from "@/components/map/CityPicker";
import CitySupportSheet from "@/components/map/CitySupportSheet";
import LocaleToggle from "@/components/LocaleToggle";
import PerfModeToggle from "@/components/PerfModeToggle";
import { useRealtime } from "@/context/RealtimeContext";
import type { SupportAppliedMessage } from "@/lib/realtimeSocket";
import {
  getPerformanceModePreference,
  type PerformanceModePreference,
} from "@/lib/performanceMode";
import styles from "@/components/ProvinceMap.module.css";
import mapChrome from "@/components/map/MapChrome.module.css";

const TurkiyeMap = dynamic(() => import("@/components/map/TurkiyeMap"), {
  ssr: false,
  loading: () => <div className="map-root" aria-busy="true" />,
});

function MapInner() {
  const searchParams = useSearchParams();
  const focusIl = searchParams.get("il");
  const t = useTranslations("map");
  const { subscribe } = useRealtime();
  const liveMsgRef = useRef(t);
  const [selectedIl, setSelectedIl] = useState<string | null>(focusIl);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [perfPref, setPerfPref] = useState<PerformanceModePreference>(() =>
    typeof window !== "undefined" ? getPerformanceModePreference() : "auto",
  );

  liveMsgRef.current = t;

  useEffect(() => {
    if (focusIl) {
      setSelectedIl(focusIl);
    }
  }, [focusIl]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "support_applied") return;
      const msg = event as SupportAppliedMessage;
      setLiveMessage(
        liveMsgRef.current("liveSupport", {
          delta: msg.delta,
          ilCode: msg.il_code,
          tribeId: msg.tribe_id.slice(0, 8),
        }),
      );
    });
  }, [subscribe]);

  return (
    <main className="map-root" data-testid="map-screen">
      <div className={styles.root}>
        <TurkiyeMap
          initialIlCode={focusIl}
          selectedIlCode={selectedIl ?? focusIl}
          onCitySelect={(city) => {
            setSelectedIl(city.il_code);
            setLiveMessage(null);
          }}
        />
        <div className={mapChrome.floating}>
          <button
            type="button"
            className={mapChrome.searchBtn}
            aria-label={t("picker.openAria")}
            data-testid="city-picker-open"
            onClick={() => setPickerOpen(true)}
          >
            ⌕
          </button>
          <LocaleToggle />
          <PerfModeToggle value={perfPref} onChange={setPerfPref} />
        </div>
        {liveMessage && !selectedIl ? (
          <p className={mapChrome.liveToast} aria-live="polite">
            {liveMessage}
          </p>
        ) : null}
        <CityPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(city) => {
            setSelectedIl(city.id);
            setLiveMessage(null);
          }}
        />
        <CitySupportSheet
          ilCode={selectedIl}
          onClose={() => setSelectedIl(null)}
        />
      </div>
    </main>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<main className="map-root" aria-busy="true" />}>
      <MapInner />
    </Suspense>
  );
}
