"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchCities,
  type City,
  type CompetingTribe,
} from "@/lib/cities-api";
import { useRealtime } from "@/context/RealtimeContext";
import type { SupportAppliedMessage } from "@/lib/realtimeSocket";

type CityDataStatus = "loading" | "ready" | "error";

type CityDataContextValue = {
  cities: City[];
  citiesById: Record<string, City>;
  status: CityDataStatus;
  getCity: (id: string) => City | undefined;
  applySupportDelta: (ilCode: string, tribeId: string, delta: number) => void;
  refetch: () => Promise<void>;
};

const CityDataContext = createContext<CityDataContextValue | null>(null);

function patchCitySupport(
  city: City,
  tribeId: string,
  delta: number,
): City {
  const competing = [...(city.competing_tribes ?? [])];
  const idx = competing.findIndex((c) => c.tribe_id === tribeId);
  if (idx >= 0) {
    const next: CompetingTribe = {
      ...competing[idx],
      committed_credits: competing[idx].committed_credits + delta,
    };
    competing[idx] = next;
  } else {
    competing.push({ tribe_id: tribeId, committed_credits: delta });
  }
  competing.sort((a, b) => b.committed_credits - a.committed_credits);

  const leader = competing[0];
  let controlling = city.controlling_tribe;
  if (leader && leader.committed_credits > 0) {
    controlling = {
      tribe_id: leader.tribe_id,
      primary_color: controlling?.tribe_id === leader.tribe_id
        ? controlling.primary_color
        : undefined,
    };
  }

  return {
    ...city,
    competing_tribes: competing,
    controlling_tribe: controlling,
  };
}

export function CityDataProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useRealtime();
  const [cities, setCities] = useState<City[]>([]);
  const [status, setStatus] = useState<CityDataStatus>("loading");

  const refetch = useCallback(async () => {
    try {
      const res = await fetchCities();
      setCities(res.cities);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  const applySupportDelta = useCallback(
    (ilCode: string, tribeId: string, delta: number) => {
      setCities((prev) =>
        prev.map((c) =>
          c.id === ilCode ? patchCitySupport(c, tribeId, delta) : c,
        ),
      );
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
      applySupportDelta(msg.il_code, msg.tribe_id, msg.delta);
    });
  }, [subscribe, applySupportDelta]);

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
      status,
      getCity,
      applySupportDelta,
      refetch,
    }),
    [cities, citiesById, status, getCity, applySupportDelta, refetch],
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
