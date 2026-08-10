import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type FunnelDay = {
  day: string;
  installs: number;
  consented: number;
  joined_tribe: number;
  first_support: number;
  retained_d7: number;
  computed_at: string;
};

export type CohortDay = {
  cohort_day: string;
  cohort_size: number;
  retained_d1: number;
  retained_d7: number;
  retained_d30: number;
  computed_at: string;
};

export type HeatmapProvince = {
  il_code: string;
  effective_support_sum: number;
  control_pct: number;
  leading_tribe_id: string | null;
  primary_color: string | null;
  refreshed_at: string | null;
};

export type FunnelResponse = { days: FunnelDay[] };
export type CohortsResponse = { cohorts: CohortDay[] };
export type HeatmapResponse = { provinces: HeatmapProvince[] };

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

export function fetchFunnel(params?: { from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return authJSON<FunnelResponse>(
    "GET",
    `/v1/admin/analytics/funnel${qs ? `?${qs}` : ""}`,
  );
}

export function fetchCohorts(params?: { from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return authJSON<CohortsResponse>(
    "GET",
    `/v1/admin/analytics/cohorts${qs ? `?${qs}` : ""}`,
  );
}

export function fetchHeatmap() {
  return authJSON<HeatmapResponse>("GET", "/v1/admin/analytics/heatmap");
}
