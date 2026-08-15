import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type SupportResult = {
  support_id: string;
  il_code: string;
  credits_spent: number;
  multiplier: number;
  effective_support: number;
  tribe_id: string;
  balance_after: number;
  caused_flip?: boolean;
  conquest_log_id?: string | null;
};

export type ProvinceProperties = {
  il_code: string;
  name_tr: string;
  name_en: string;
  primary_color?: string | null;
  control_pct?: number;
};

export type ProvinceFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    properties: ProvinceProperties;
    geometry: unknown;
  }>;
};

export type ProvinceControlRow = {
  il_code: string;
  leading_tribe_id: string | null;
  control_pct: number;
  effective_support_sum: number;
  primary_color: string | null;
  refreshed_at: string;
};

export type ProvincesControlResponse = {
  provinces: ProvinceControlRow[];
};

export type SupportHistoryItem = {
  id: string;
  il_code: string;
  tribe_id: string;
  credits_spent: number;
  multiplier: number;
  effective_support: number;
  created_at: string;
};

export type SupportHistoryResponse = {
  supports: SupportHistoryItem[];
  next_offset: number | null;
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

export function fetchProvincesGeoJSON() {
  return authJSON<ProvinceFeatureCollection>("GET", "/v1/provinces/geojson");
}

export function fetchProvincesControl() {
  return authJSON<ProvincesControlResponse>("GET", "/v1/provinces/control");
}

export function fetchMySupports(limit = 20, offset = 0) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return authJSON<SupportHistoryResponse>("GET", `/v1/me/supports?${params}`);
}

export function postSupport(ilCode: string, credits: number) {
  return authJSON<SupportResult>("POST", "/v1/support", {
    il_code: ilCode,
    credits,
  });
}
