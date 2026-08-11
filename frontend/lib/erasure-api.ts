import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type ErasureRequestResponse = {
  job_id: string;
  status: string;
  request_id?: string;
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

/** POST /v1/account/erasure-request — async KVKK erasure job (202). */
export function requestAccountErasure() {
  return authJSON<ErasureRequestResponse>(
    "POST",
    "/v1/account/erasure-request",
  );
}
