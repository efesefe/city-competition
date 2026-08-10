import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type WalletBalanceResponse = {
  balance: number;
};

async function authJSON<T>(method: string, path: string): Promise<T> {
  const token = getSessionToken();
  if (!token) {
    throw Object.assign(new Error("error_unauthorized"), {
      status: 401,
      code: "error_unauthorized",
    });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? "request_failed"), {
      status: res.status,
      code: data.error,
    });
  }
  return data;
}

/** Actual backend route (prompt's GET /v1/me/wallet does not exist yet). */
export function fetchWalletBalance() {
  return authJSON<WalletBalanceResponse>("GET", "/v1/credits/balance");
}
