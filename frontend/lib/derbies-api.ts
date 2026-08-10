import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type Derby = {
  id: string;
  host_tribe_id: string;
  guest_tribe_id: string;
  il_code: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active" | "resolved" | string;
  host_effective_total: number;
  guest_effective_total: number;
  created_by_admin_id: string;
  created_at: string;
};

export type DerbiesListResponse = {
  derbies: Derby[];
};

export type CreateDerbyInput = {
  host_tribe_id: string;
  guest_tribe_id: string;
  il_code: string;
  starts_at: string;
  ends_at: string;
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

export function listDerbies() {
  return authJSON<DerbiesListResponse>("GET", "/v1/derbies");
}

export function getDerby(id: string) {
  return authJSON<Derby>("GET", `/v1/derbies/${id}`);
}

export function createDerby(input: CreateDerbyInput) {
  return authJSON<Derby>("POST", "/v1/admin/derbies", input);
}

export function forceResolveDerby(id: string) {
  return authJSON<Derby>("POST", `/v1/admin/derbies/${id}/force-resolve`);
}
