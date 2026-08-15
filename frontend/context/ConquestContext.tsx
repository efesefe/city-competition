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
import { useCityData } from "@/context/CityDataContext";
import { useRealtime } from "@/context/RealtimeContext";
import type { SupportResult } from "@/lib/api/support";
import {
  celebrationFromOwnSupport,
  rememberCelebratedId,
  type CelebrationEvent,
} from "@/lib/conquest/celebrationGate";
import {
  dismissActiveToast as advanceToast,
  emptyToastQueue,
  enqueueToast,
  type CaptureToastItem,
  type ToastQueueState,
} from "@/lib/conquest/toastQueue";
import {
  applyLiveFlip,
  applyMarkAllRead,
  applyServerUnread,
} from "@/lib/conquest/unread";
import {
  fetchConquestUnreadCount,
  markConquestLogRead,
} from "@/lib/conquest-api";
import type { RegionSupportedMessage } from "@/lib/realtimeSocket";

export type { CaptureToastItem, CelebrationEvent };

export type MapProjectFn = (ilCode: string) => { x: number; y: number } | null;

type ConquestContextValue = {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  setUnreadCount: (n: number) => void;
  markLogRead: () => Promise<void>;
  activeToast: CaptureToastItem | null;
  dismissActiveToast: () => void;
  celebration: CelebrationEvent | null;
  clearCelebration: () => void;
  reportOwnSupport: (
    result: SupportResult,
    extras?: { cityName?: string },
  ) => void;
  registerMapProject: (fn: MapProjectFn | null) => void;
  projectCity: (ilCode: string) => { x: number; y: number } | null;
};

const ConquestContext = createContext<ConquestContextValue | null>(null);

function toastFromEvent(event: RegionSupportedMessage): CaptureToastItem {
  return {
    id: event.id,
    il_code: event.il_code,
    city_name: event.city_name,
    previous_tribe_id: event.previous_tribe_id,
    new_tribe_id: event.new_tribe_id,
    occurred_at: event.occurred_at,
    was_derbi_bonus: event.was_derbi_bonus,
  };
}

export function ConquestProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useRealtime();
  const { getCity } = useCityData();
  const [unread, setUnread] = useState({ unread_count: 0 });
  const [queue, setQueue] = useState<ToastQueueState>(emptyToastQueue);
  const [celebration, setCelebration] = useState<CelebrationEvent | null>(null);
  const celebratedRef = useRef<Set<string>>(new Set());
  const recentFlipsRef = useRef<Map<string, CaptureToastItem>>(new Map());
  const projectRef = useRef<MapProjectFn | null>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetchConquestUnreadCount();
      setUnread((prev) => applyServerUnread(prev, res.unread_count));
    } catch {
      // Keep last known count on transient errors.
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const onFocus = () => void refreshUnread();
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshUnread();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshUnread]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "region_supported") return;
      const item = toastFromEvent(event);
      recentFlipsRef.current.set(item.id, item);
      recentFlipsRef.current.set(`il:${item.il_code}`, item);
      setQueue((prev) => enqueueToast(prev, item));
      setUnread((prev) => applyLiveFlip(prev));
    });
  }, [subscribe]);

  const dismissActiveToast = useCallback(() => {
    setQueue((prev) => advanceToast(prev));
  }, []);

  const clearCelebration = useCallback(() => {
    setCelebration(null);
  }, []);

  const startCelebration = useCallback((next: CelebrationEvent) => {
    if (celebratedRef.current.has(next.id)) return;
    celebratedRef.current = rememberCelebratedId(celebratedRef.current, next.id);
    setCelebration(next);
  }, []);

  const reportOwnSupport = useCallback(
    (result: SupportResult, extras?: { cityName?: string }) => {
      const recent = recentFlipsRef.current.get(`il:${result.il_code}`);
      const city = getCity(result.il_code);
      const event = celebrationFromOwnSupport(result, {
        city_name: extras?.cityName ?? recent?.city_name ?? city?.name ?? result.il_code,
        new_tribe_id: recent?.new_tribe_id ?? result.tribe_id,
        previous_tribe_id:
          recent?.previous_tribe_id ?? city?.controlling_tribe?.tribe_id ?? null,
      });
      if (!event) return;
      startCelebration(event);
    },
    [getCity, startCelebration],
  );

  const markLogRead = useCallback(async () => {
    try {
      await markConquestLogRead({ all: true });
      setUnread(applyMarkAllRead());
    } catch {
      await refreshUnread();
    }
  }, [refreshUnread]);

  const setUnreadCount = useCallback((n: number) => {
    setUnread({ unread_count: Math.max(0, Math.floor(n)) });
  }, []);

  const registerMapProject = useCallback((fn: MapProjectFn | null) => {
    projectRef.current = fn;
  }, []);

  const projectCity = useCallback((ilCode: string) => {
    return projectRef.current?.(ilCode) ?? null;
  }, []);

  const value = useMemo<ConquestContextValue>(
    () => ({
      unreadCount: unread.unread_count,
      refreshUnread,
      setUnreadCount,
      markLogRead,
      activeToast: queue.active,
      dismissActiveToast,
      celebration,
      clearCelebration,
      reportOwnSupport,
      registerMapProject,
      projectCity,
    }),
    [
      unread.unread_count,
      refreshUnread,
      setUnreadCount,
      markLogRead,
      queue.active,
      dismissActiveToast,
      celebration,
      clearCelebration,
      reportOwnSupport,
      registerMapProject,
      projectCity,
    ],
  );

  return (
    <ConquestContext.Provider value={value}>{children}</ConquestContext.Provider>
  );
}

export function useConquest(): ConquestContextValue {
  const ctx = useContext(ConquestContext);
  if (!ctx) {
    throw new Error("useConquest must be used within ConquestProvider");
  }
  return ctx;
}
