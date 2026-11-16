import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

/** API base — override with EXPO_PUBLIC_API_URL */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  extra.apiUrl ||
  "http://localhost:8787";

/** Live Supabase Auth — leave unset for local mock OTP / OAuth stub. */
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || "";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || "";

export function wsUrl(): string {
  const u = new URL(API_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/v1/ws";
  return u.toString();
}
