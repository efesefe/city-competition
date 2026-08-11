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
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { reconcileBalance } = useWallet();
  const listenersRef = useRef(new Set<EventListener>());
  const bboxGetterRef = useRef<(() => MapBBox | null) | null>(null);
  const handleRef = useRef<RealtimeSocketHandle | null>(null);
  /** Rooms requested by consumers; socket handle also tracks for reconnect. */
  const roomsRef = useRef(new Set<string>());
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
    // Re-apply any rooms joined before the socket finished connecting.
    for (const room of roomsRef.current) {
      handle.joinRoom(room);
    }
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

  const joinRoom = useCallback((room: string) => {
    const trimmed = room.trim();
    if (!trimmed) return;
    roomsRef.current.add(trimmed);
    handleRef.current?.joinRoom(trimmed);
  }, []);

  const leaveRoom = useCallback((room: string) => {
    const trimmed = room.trim();
    if (!trimmed) return;
    roomsRef.current.delete(trimmed);
    handleRef.current?.leaveRoom(trimmed);
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribe,
      sendViewport,
      sendViewportNow,
      setBBoxGetter,
      joinRoom,
      leaveRoom,
    }),
    [
      status,
      subscribe,
      sendViewport,
      sendViewportNow,
      setBBoxGetter,
      joinRoom,
      leaveRoom,
    ],
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
