import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/** True when Expo public Supabase env is set (live Auth SDK path). */
export function isSupabaseClientConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseClientConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    });
  }
  return client;
}

export function normalizeTrPhoneClient(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+90${digits.slice(1)}`;
  if (digits.length === 10) return `+90${digits}`;
  if (input.startsWith("+90") && digits.length === 12) return `+${digits}`;
  return null;
}
