"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { fetchWalletBalance } from "@/lib/wallet-api";
import { getSessionToken } from "@/lib/session";
import {
  hasTribeMembership,
  listTribes,
  type Tribe,
} from "@/lib/tribes-api";
import {
  displayedBalance,
  initialWalletState,
  walletReducer,
  type WalletState,
} from "@/context/walletReducer";

export type WalletStatus = "loading" | "ready" | "error";

type WalletContextValue = {
  balance: number;
  status: WalletStatus;
  tribe: Tribe | null;
  tribeId: string | null;
  refetch: () => Promise<void>;
  applyOptimisticDelta: (amount: number) => void;
  reconcileBalance: (authoritative: number) => void;
  /** @internal exposed for tests / realtime wiring */
  walletState: WalletState;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(walletReducer, undefined, () =>
    initialWalletState(0),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const [status, setStatus] = useState<WalletStatus>("loading");
  const [tribe, setTribe] = useState<Tribe | null>(null);
  const [tribeId, setTribeId] = useState<string | null>(null);

  const redirectOnboarding = useCallback(
    (kind: "auth" | "tribe") => {
      router.replace(kind === "auth" ? "/register" : "/tribes");
    },
    [router],
  );

  const loadTribe = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      redirectOnboarding("auth");
      return null;
    }
    const res = await listTribes();
    if (!hasTribeMembership(res.membership) || !res.membership.tribe_id) {
      redirectOnboarding("tribe");
      return null;
    }
    const id = res.membership.tribe_id;
    const match = res.tribes.find((t) => t.id === id) ?? null;
    setTribeId(id);
    setTribe(match);
    return match;
  }, [redirectOnboarding]);

  const refetch = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      redirectOnboarding("auth");
      return;
    }
    try {
      const { balance } = await fetchWalletBalance();
      dispatch({ type: "reconcile", balance });
      setStatus("ready");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (code === "error_unauthorized") {
        redirectOnboarding("auth");
        return;
      }
      setStatus("error");
    }
  }, [redirectOnboarding]);

  const applyOptimisticDelta = useCallback((amount: number) => {
    const epoch = stateRef.current.epoch;
    dispatch({ type: "apply_optimistic", delta: amount, epoch });
  }, []);

  const reconcileBalance = useCallback((authoritative: number) => {
    dispatch({ type: "reconcile", balance: authoritative });
    setStatus("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getSessionToken();
        if (!token) {
          redirectOnboarding("auth");
          return;
        }
        const t = await loadTribe();
        if (cancelled || !t) return;
        const { balance } = await fetchWalletBalance();
        if (cancelled) return;
        dispatch({ type: "hydrate", balance });
        setStatus("ready");
      } catch {
        if (!cancelled) {
          redirectOnboarding("auth");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTribe, redirectOnboarding]);

  useEffect(() => {
    const onFocus = () => {
      void refetch();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refetch();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refetch]);

  const value = useMemo<WalletContextValue>(
    () => ({
      balance: displayedBalance(state),
      status,
      tribe,
      tribeId,
      refetch,
      applyOptimisticDelta,
      reconcileBalance,
      walletState: state,
    }),
    [
      state,
      status,
      tribe,
      tribeId,
      refetch,
      applyOptimisticDelta,
      reconcileBalance,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return ctx;
}
