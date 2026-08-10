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
import {
  connectRealtimeSocket,
  type MapBBox,
  type RealtimeSocketEvent,
  type RealtimeSocketHandle,
  type RealtimeSocketStatus,
} from "@/lib/realtimeSocket";
import { useWallet } from "@/context/WalletContext";

type EventListener = (event: RealtimeSocketEvent) => void;

type RealtimeContextValue = {
  status: RealtimeSocketStatus;
  subscribe: (listener: EventListener) => () => void;
  sendViewport: (bbox?: MapBBox | null) => void;
  sendViewportNow: (bbox?: MapBBox | null) => void;
  setBBoxGetter: (getter: (() => MapBBox | null) | null) => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { reconcileBalance } = useWallet();
  const listenersRef = useRef(new Set<EventListener>());
  const bboxGetterRef = useRef<(() => MapBBox | null) | null>(null);
  const handleRef = useRef<RealtimeSocketHandle | null>(null);
  const [status, setStatus] = useState<RealtimeSocketStatus>("connecting");

  const emit = useCallback(
    (event: RealtimeSocketEvent) => {
      if (event.type === "wallet-balance-changed") {
        reconcileBalance(event.balance);
      }
      for (const listener of listenersRef.current) {
        listener(event);
      }
    },
    [reconcileBalance],
  );

  useEffect(() => {
    const handle = connectRealtimeSocket({
      getBBox: () => bboxGetterRef.current?.() ?? null,
      onEvent: emit,
      onStatus: setStatus,
    });
    handleRef.current = handle;
    return () => {
      handle.close();
      handleRef.current = null;
    };
  }, [emit]);

  const subscribe = useCallback((listener: EventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const setBBoxGetter = useCallback(
    (getter: (() => MapBBox | null) | null) => {
      bboxGetterRef.current = getter;
    },
    [],
  );

  const sendViewport = useCallback((bbox?: MapBBox | null) => {
    handleRef.current?.sendViewport(bbox);
  }, []);

  const sendViewportNow = useCallback((bbox?: MapBBox | null) => {
    handleRef.current?.sendViewportNow(bbox);
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribe,
      sendViewport,
      sendViewportNow,
      setBBoxGetter,
    }),
    [status, subscribe, sendViewport, sendViewportNow, setBBoxGetter],
  );

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return ctx;
}
