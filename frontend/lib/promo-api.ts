import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type AdminPromo = {
  id: string;
  bonus_percent: number;
  active: boolean;
  created_at: string;
};

export type AdminPromoResponse = {
  promo: AdminPromo | null;
};

async function authJSON<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
    body: body === undefined ? undefined : JSON.stringify(body),
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

export function fetchAdminPromo() {
  return authJSON<AdminPromoResponse>("GET", "/v1/admin/promos");
}

export function activateAdminPromo(bonusPercent: number) {
  return authJSON<AdminPromoResponse>("POST", "/v1/admin/promos", {
    bonus_percent: bonusPercent,
  });
}

export function deactivateAdminPromo() {
  return authJSON<AdminPromoResponse>("POST", "/v1/admin/promos/deactivate");
}
