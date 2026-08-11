"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import DerbiScoreboard from "@/components/leaderboard/DerbiScoreboard";
import LeaderboardList from "@/components/leaderboard/LeaderboardList";
import LeaderboardTabs, {
  type LeaderboardTabId,
} from "@/components/leaderboard/LeaderboardTabs";
import PullToRefresh from "@/components/leaderboard/PullToRefresh";
import { useCityData } from "@/context/CityDataContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useWallet } from "@/context/WalletContext";
import {
  getDerbyStandings,
  listDerbies,
  type Derby,
  type DerbyStandings,
} from "@/lib/derbies-api";
import {
  fetchGlobalBoard,
  fetchTribeBoard,
  type LeaderboardBoard,
} from "@/lib/leaderboard-api";
import {
  createDebouncedRefetch,
  isDerbiTabVisible,
  LEADERBOARD_VIEWPORT_BBOX,
  selectPrimaryDerby,
} from "@/lib/leaderboardVisibility";
import { listTribes, type Tribe } from "@/lib/tribes-api";
import styles from "./leaderboard.module.css";

export default function LeaderboardPage() {
  const t = useTranslations("leaderboard");
  const { tribe, tribeId } = useWallet();
  const { cities, tribesById } = useCityData();
  const { subscribe, sendViewportNow } = useRealtime();

  const [tab, setTab] = useState<LeaderboardTabId>("global");
  const [globalBoard, setGlobalBoard] = useState<LeaderboardBoard | null>(null);
  const [tribeBoard, setTribeBoard] = useState<LeaderboardBoard | null>(null);
  const [tribeMeta, setTribeMeta] = useState<Tribe | null>(null);
  const [allTribes, setAllTribes] = useState<Tribe[]>([]);
  const [derbies, setDerbies] = useState<Derby[]>([]);
  const [standings, setStandings] = useState<DerbyStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const showDerbi = isDerbiTabVisible(derbies);
  const primaryDerby = useMemo(
    () => selectPrimaryDerby(derbies),
    [derbies],
  );

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const tribeIdRef = useRef(tribeId);
  tribeIdRef.current = tribeId;

  const loadGlobal = useCallback(async () => {
    const board = await fetchGlobalBoard();
    setGlobalBoard(board);
  }, []);

  const loadTribe = useCallback(async () => {
    const id = tribeIdRef.current;
    if (!id) {
      setTribeBoard({ entries: [], limit: 50, me: null });
      return;
    }
    const board = await fetchTribeBoard(id);
    setTribeBoard(board);
  }, []);

  const loadDerbiesAndStandings = useCallback(async () => {
    const { derbies: list } = await listDerbies();
    setDerbies(list);
    const selected = selectPrimaryDerby(list);
    if (!selected) {
      setStandings(null);
      return;
    }
    const next = await getDerbyStandings(selected.id);
    setStandings(next);
  }, []);

  const loadTribesMeta = useCallback(async () => {
    const res = await listTribes();
    setAllTribes(res.tribes);
    const id = res.membership.tribe_id ?? tribeId;
    const match =
      (id ? res.tribes.find((row) => row.id === id) : null) ?? tribe ?? null;
    setTribeMeta(match);
  }, [tribe, tribeId]);

  const refreshActive = useCallback(async () => {
    const active = tabRef.current;
    try {
      setError(null);
      if (active === "global") {
        await loadGlobal();
      } else if (active === "tribes") {
        await loadTribe();
      } else {
        await loadDerbiesAndStandings();
      }
    } catch {
      setError(t("loadFailed"));
    }
  }, [loadDerbiesAndStandings, loadGlobal, loadTribe, t]);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadGlobal(),
        loadTribe(),
        loadDerbiesAndStandings(),
        loadTribesMeta(),
      ]);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    loadDerbiesAndStandings,
    loadGlobal,
    loadTribe,
    loadTribesMeta,
    t,
  ]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  useEffect(() => {
    if (!showDerbi && tab === "derbi") {
      setTab("global");
    }
  }, [showDerbi, tab]);

  useEffect(() => {
    sendViewportNow(LEADERBOARD_VIEWPORT_BBOX);
  }, [sendViewportNow]);

  useEffect(() => {
    const { trigger, cancel } = createDebouncedRefetch(() => {
      void refreshActive();
    }, 300);
    const unsub = subscribe((event) => {
      if (event.type !== "support_applied") return;
      trigger();
    });
    return () => {
      cancel();
      unsub();
    };
  }, [refreshActive, subscribe]);

  const onTabChange = useCallback(
    (next: LeaderboardTabId) => {
      setTab(next);
      setError(null);
      void (async () => {
        try {
          if (next === "global") await loadGlobal();
          else if (next === "tribes") await loadTribe();
          else await loadDerbiesAndStandings();
        } catch {
          setError(t("loadFailed"));
        }
      })();
    },
    [loadDerbiesAndStandings, loadGlobal, loadTribe, t],
  );

  const hostTribe = useMemo(() => {
    if (!primaryDerby) return null;
    return (
      tribesById[primaryDerby.host_tribe_id] ??
      allTribes.find((x) => x.id === primaryDerby.host_tribe_id) ??
      null
    );
  }, [allTribes, primaryDerby, tribesById]);

  const guestTribe = useMemo(() => {
    if (!primaryDerby) return null;
    return (
      tribesById[primaryDerby.guest_tribe_id] ??
      allTribes.find((x) => x.id === primaryDerby.guest_tribe_id) ??
      null
    );
  }, [allTribes, primaryDerby, tribesById]);

  const cityName = useMemo(() => {
    if (!primaryDerby) return "";
    const city = cities.find((c) => c.id === primaryDerby.il_code);
    return (
      city?.name ??
      t("provinceFallback", { ilCode: primaryDerby.il_code })
    );
  }, [cities, primaryDerby, t]);

  const listLoading = loading && tab !== "derbi";
  const derbiLoading = loading && tab === "derbi";

  return (
    <main className={styles.page} data-testid="leaderboard-screen">
      <header className={styles.header}>
        <h1 className={styles.title}>{t("title")}</h1>
      </header>
      <LeaderboardTabs
        active={tab}
        showDerbi={showDerbi}
        onChange={onTabChange}
      />
      <PullToRefresh onRefresh={refreshActive} className={styles.panel}>
        {tab === "global" ? (
          <LeaderboardList
            board={globalBoard}
            loading={listLoading}
            error={error}
          />
        ) : null}
        {tab === "tribes" ? (
          <LeaderboardList
            board={tribeBoard}
            loading={listLoading}
            error={error}
            tribe={tribeMeta ?? tribe}
          />
        ) : null}
        {tab === "derbi" && primaryDerby ? (
          <DerbiScoreboard
            derby={primaryDerby}
            standings={standings}
            hostTribe={hostTribe}
            guestTribe={guestTribe}
            cityName={cityName}
            loading={derbiLoading}
            error={error}
          />
        ) : null}
      </PullToRefresh>
    </main>
  );
}
