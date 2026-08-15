"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import DerbiBanner from "@/components/derbi/DerbiBanner";
import DerbiScoreboardSheet from "@/components/derbi/DerbiScoreboardSheet";
import ActivityTicker from "@/components/map/ActivityTicker";
import CityPicker from "@/components/map/CityPicker";
import CitySupportSheet from "@/components/map/CitySupportSheet";
import PushPermissionPrompt from "@/components/notifications/PushPermissionPrompt";
import LocaleToggle from "@/components/LocaleToggle";
import PerfModeToggle from "@/components/PerfModeToggle";
import { useCityData } from "@/context/CityDataContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useWallet } from "@/context/WalletContext";
import {
  getDerbyStandings,
  listDerbies,
  type Derby,
  type DerbyStandings,
} from "@/lib/derbies-api";
import { selectBannerDerby } from "@/lib/derbiBanner";
import { markMapSeen, wasMapSeenBefore } from "@/lib/mapSeen";
import type { SupportAppliedMessage } from "@/lib/realtimeSocket";
import {
  getPerformanceModePreference,
  isPerformanceModeEnabled,
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
  const router = useRouter();
  const focusIl = searchParams.get("il");
  const focusDerbi = searchParams.get("derbi");
  const t = useTranslations("map");
  const tBanner = useTranslations("derbiBanner");
  const { subscribe } = useRealtime();
  const { tribeId } = useWallet();
  const { getCity, tribesById } = useCityData();
  const liveMsgRef = useRef(t);
  const [selectedIl, setSelectedIl] = useState<string | null>(focusIl);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [perfPref, setPerfPref] = useState<PerformanceModePreference>(() =>
    typeof window !== "undefined" ? getPerformanceModePreference() : "auto",
  );
  const [derbies, setDerbies] = useState<Derby[]>([]);
  const [scoreboardOpen, setScoreboardOpen] = useState(Boolean(focusDerbi));
  const [scoreboardDerby, setScoreboardDerby] = useState<Derby | null>(null);
  const [standings, setStandings] = useState<DerbyStandings | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [highlightPulse, setHighlightPulse] = useState<{
    ilCode: string;
    nonce: number;
  } | null>(null);

  liveMsgRef.current = t;

  useEffect(() => {
    const seenBefore = wasMapSeenBefore();
    markMapSeen();
    if (seenBefore) {
      setShowPushPrompt(true);
    }
  }, []);

  useEffect(() => {
    if (focusIl) {
      setSelectedIl(focusIl);
    }
  }, [focusIl]);

  const refreshDerbies = useCallback(async () => {
    try {
      const res = await listDerbies();
      setDerbies(res.derbies);
    } catch {
      setDerbies([]);
    }
  }, []);

  useEffect(() => {
    void refreshDerbies();
    const id = window.setInterval(() => void refreshDerbies(), 60_000);
    return () => window.clearInterval(id);
  }, [refreshDerbies]);

  const bannerDerby = useMemo(
    () => selectBannerDerby(derbies, tribeId),
    [derbies, tribeId],
  );

  useEffect(() => {
    if (!focusDerbi) return;
    const match = derbies.find((d) => d.id === focusDerbi) ?? null;
    if (match) {
      setScoreboardDerby(match);
      setScoreboardOpen(true);
    }
  }, [focusDerbi, derbies]);

  useEffect(() => {
    if (!scoreboardOpen || !scoreboardDerby) {
      setStandings(null);
      setStandingsError(null);
      return;
    }
    let cancelled = false;
    setStandingsLoading(true);
    setStandingsError(null);
    void getDerbyStandings(scoreboardDerby.id)
      .then((next) => {
        if (!cancelled) setStandings(next);
      })
      .catch(() => {
        if (!cancelled) setStandingsError(tBanner("standingsFailed"));
      })
      .finally(() => {
        if (!cancelled) setStandingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scoreboardOpen, scoreboardDerby, tBanner]);

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

  const openBannerDerby = useCallback(() => {
    if (!bannerDerby) return;
    setSelectedIl(bannerDerby.il_code);
    setScoreboardDerby(bannerDerby);
    setScoreboardOpen(true);
    setLiveMessage(null);
    router.replace(
      `/map?il=${encodeURIComponent(bannerDerby.il_code)}&derbi=${encodeURIComponent(bannerDerby.id)}`,
      { scroll: false },
    );
  }, [bannerDerby, router]);

  const closeScoreboard = useCallback(() => {
    setScoreboardOpen(false);
    setScoreboardDerby(null);
    const il = selectedIl ?? focusIl;
    if (il) {
      router.replace(`/map?il=${encodeURIComponent(il)}`, { scroll: false });
    } else {
      router.replace("/map", { scroll: false });
    }
  }, [focusIl, router, selectedIl]);

  const jumpToTickerCity = useCallback((ilCode: string) => {
    setSelectedIl(ilCode);
    setLiveMessage(null);
    setHighlightPulse({ ilCode, nonce: Date.now() });
  }, []);

  const cityNameFor = useCallback(
    (ilCode: string) => {
      const city = getCity(ilCode);
      return city?.name ?? tBanner("provinceFallback", { ilCode });
    },
    [getCity, tBanner],
  );

  return (
    <main className="map-root" data-testid="map-screen">
      {bannerDerby ? (
        <DerbiBanner
          derby={bannerDerby}
          hostTribe={tribesById[bannerDerby.host_tribe_id] ?? null}
          guestTribe={tribesById[bannerDerby.guest_tribe_id] ?? null}
          cityName={cityNameFor(bannerDerby.il_code)}
          onOpen={openBannerDerby}
        />
      ) : null}
      <ActivityTicker onSelectCity={jumpToTickerCity} />
      <div className={styles.root}>
        <TurkiyeMap
          initialIlCode={focusIl}
          selectedIlCode={selectedIl ?? focusIl}
          highlightPulse={highlightPulse}
          derbies={derbies}
          perfModeEnabled={isPerformanceModeEnabled(perfPref)}
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
        {!scoreboardOpen ? (
          <CitySupportSheet
            ilCode={selectedIl}
            onClose={() => setSelectedIl(null)}
          />
        ) : null}
        <DerbiScoreboardSheet
          open={scoreboardOpen}
          derby={scoreboardDerby}
          standings={standings}
          hostTribe={
            scoreboardDerby
              ? (tribesById[scoreboardDerby.host_tribe_id] ?? null)
              : null
          }
          guestTribe={
            scoreboardDerby
              ? (tribesById[scoreboardDerby.guest_tribe_id] ?? null)
              : null
          }
          cityName={
            scoreboardDerby ? cityNameFor(scoreboardDerby.il_code) : ""
          }
          loading={standingsLoading}
          error={standingsError}
          onClose={closeScoreboard}
        />
        {showPushPrompt ? (
          <PushPermissionPrompt onDismissed={() => setShowPushPrompt(false)} />
        ) : null}
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
