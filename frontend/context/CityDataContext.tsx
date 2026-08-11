"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchCities, type City } from "@/lib/cities-api";
import { patchCitySupport, reconcileCityControl } from "@/context/cityDataPatch";
import { useRealtime } from "@/context/RealtimeContext";
import type { SupportAppliedMessage } from "@/lib/realtimeSocket";
import { listTribes, type Tribe } from "@/lib/tribes-api";

type CityDataStatus = "loading" | "ready" | "error";

type CityDataContextValue = {
  cities: City[];
  citiesById: Record<string, City>;
  tribesById: Record<string, Tribe>;
  status: CityDataStatus;
  getCity: (id: string) => City | undefined;
  applySupportDelta: (ilCode: string, tribeId: string, delta: number) => void;
  /** Register an optimistic spend so the matching WS event is not double-applied. */
  registerPendingSupport: (
    ilCode: string,
    tribeId: string,
    delta: number,
  ) => void;
  /** Consume one matching pending entry; returns true if suppressed. */
  consumePendingSupport: (
    ilCode: string,
    tribeId: string,
    delta: number,
  ) => boolean;
  refetch: () => Promise<void>;
};

function pendingSupportKey(
  ilCode: string,
  tribeId: string,
  delta: number,
): string {
  return `${ilCode}\0${tribeId}\0${delta}`;
}

const CityDataContext = createContext<CityDataContextValue | null>(null);

export { patchCitySupport, reconcileCityControl } from "@/context/cityDataPatch";

export function CityDataProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useRealtime();
  const [cities, setCities] = useState<City[]>([]);
  const [tribesById, setTribesById] = useState<Record<string, Tribe>>({});
  const [status, setStatus] = useState<CityDataStatus>("loading");
  const tribeColorsRef = useRef<Record<string, string>>({});
  /** Counts of optimistic (il, tribe, delta) awaiting a matching support_applied. */
  const pendingSupportRef = useRef<Map<string, number>>(new Map());

  const refetch = useCallback(async () => {
    try {
      const [citiesRes, tribesRes] = await Promise.all([
        fetchCities(),
        listTribes(),
      ]);
      const byId: Record<string, Tribe> = {};
      const colors: Record<string, string> = {};
      for (const tribe of tribesRes.tribes) {
        byId[tribe.id] = tribe;
        colors[tribe.id] = tribe.primary_color;
      }
      tribeColorsRef.current = colors;
      setTribesById(byId);
      setCities(
        citiesRes.cities.map((c) => reconcileCityControl(c, colors)),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  const applySupportDelta = useCallback(
    (ilCode: string, tribeId: string, delta: number) => {
      setCities((prev) =>
        prev.map((c) =>
          c.id === ilCode
            ? patchCitySupport(c, tribeId, delta, tribeColorsRef.current)
            : c,
        ),
      );
    },
    [],
  );

  const registerPendingSupport = useCallback(
    (ilCode: string, tribeId: string, delta: number) => {
      const key = pendingSupportKey(ilCode, tribeId, delta);
      const map = pendingSupportRef.current;
      map.set(key, (map.get(key) ?? 0) + 1);
    },
    [],
  );

  const consumePendingSupport = useCallback(
    (ilCode: string, tribeId: string, delta: number) => {
      const key = pendingSupportKey(ilCode, tribeId, delta);
      const map = pendingSupportRef.current;
      const count = map.get(key) ?? 0;
      if (count <= 0) {
        return false;
      }
      if (count === 1) {
        map.delete(key);
      } else {
        map.set(key, count - 1);
      }
      return true;
    },
    [],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "support_applied") return;
      const msg = event as SupportAppliedMessage;
      if (consumePendingSupport(msg.il_code, msg.tribe_id, msg.delta)) {
        return;
      }
      applySupportDelta(msg.il_code, msg.tribe_id, msg.delta);
    });
  }, [subscribe, applySupportDelta, consumePendingSupport]);

  const citiesById = useMemo(() => {
    const map: Record<string, City> = {};
    for (const c of cities) {
      map[c.id] = c;
    }
    return map;
  }, [cities]);

  const getCity = useCallback(
    (id: string) => citiesById[id],
    [citiesById],
  );

  const value = useMemo<CityDataContextValue>(
    () => ({
      cities,
      citiesById,
      tribesById,
      status,
      getCity,
      applySupportDelta,
      registerPendingSupport,
      consumePendingSupport,
      refetch,
    }),
    [
      cities,
      citiesById,
      tribesById,
      status,
      getCity,
      applySupportDelta,
      registerPendingSupport,
      consumePendingSupport,
      refetch,
    ],
  );

  return (
    <CityDataContext.Provider value={value}>{children}</CityDataContext.Provider>
  );
}

export function useCityData(): CityDataContextValue {
  const ctx = useContext(CityDataContext);
  if (!ctx) {
    throw new Error("useCityData must be used within CityDataProvider");
  }
  return ctx;
}
