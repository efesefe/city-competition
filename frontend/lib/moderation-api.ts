import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  context_type?: string;
  context_id?: string;
  status: "pending" | "reviewed" | "dismissed" | string;
  created_at: string;
};

export type Flag = {
  id: string;
  user_id: string;
  reason: string;
  context_type?: string;
  context_id?: string;
  status: "pending" | "reviewed" | "dismissed" | string;
  created_at: string;
};

export type ReportsListResponse = {
  reports: Report[];
};

export type FlagsListResponse = {
  flags: Flag[];
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

export function listReports(params?: {
  status?: string;
  context_type?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.context_type) q.set("context_type", params.context_type);
  const qs = q.toString();
  return authJSON<ReportsListResponse>(
    "GET",
    `/v1/admin/moderation/reports${qs ? `?${qs}` : ""}`,
  );
}

export function listFlags(params?: { status?: string; reason?: string }) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.reason) q.set("reason", params.reason);
  const qs = q.toString();
  return authJSON<FlagsListResponse>(
    "GET",
    `/v1/admin/moderation/flags${qs ? `?${qs}` : ""}`,
  );
}

export function reviewReport(id: string) {
  return authJSON<Report>(
    "POST",
    `/v1/admin/moderation/reports/${id}/review`,
  );
}

export function dismissReport(id: string) {
  return authJSON<Report>(
    "POST",
    `/v1/admin/moderation/reports/${id}/dismiss`,
  );
}

export function reviewFlag(id: string) {
  return authJSON<Flag>("POST", `/v1/admin/moderation/flags/${id}/review`);
}

export function dismissFlag(id: string) {
  return authJSON<Flag>("POST", `/v1/admin/moderation/flags/${id}/dismiss`);
}
