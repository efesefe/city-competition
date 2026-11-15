import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type PublicUser } from "./api";

type SessionState = {
  token: string | null;
  user: PublicUser | null;
  loading: boolean;
  setSession: (token: string, user: PublicUser) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: PublicUser) => void;
};

const Ctx = createContext<SessionState | null>(null);
const TOKEN_KEY = "cc_slice_token";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = token ?? (await AsyncStorage.getItem(TOKEN_KEY));
    if (!t) {
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user: u } = await api.me(t);
      setToken(t);
      setUser(u);
    } catch {
      await AsyncStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, []);

  const setSession = useCallback(async (t: string, u: PublicUser) => {
    await AsyncStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((u: PublicUser) => setUser(u), []);

  const value = useMemo(
    () => ({ token, user, loading, setSession, refresh, signOut, updateUser }),
    [token, user, loading, setSession, refresh, signOut, updateUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
