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

/** Track C spend path — path supplies il_code. */
export function postRegionSupport(ilCode: string, credits: number) {
  return authJSON<SupportResult>(
    "POST",
    `/v1/region/${encodeURIComponent(ilCode)}/support`,
    { credits },
  );
}
