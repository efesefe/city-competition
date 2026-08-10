import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

/** Backend-rendered activity string (includes Turkish locative). Display as-is. */
export type FeedEvent = {
  id: string;
  event_type: string;
  actor_id: string;
  actor_display_name: string;
  place_name: string;
  place_type: string;
  tribe_id?: string | null;
  created_at: string;
  /** Pre-rendered via feed.Render + i18n.Locative — do not rebuild on the client. */
  message: string;
};

export type FeedListResponse = {
  events: FeedEvent[];
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
      code: data.error ?? "request_failed",
    });
  }
  return data;
}

/** Lists recent feed events with backend-rendered `message` fields. */
export function listFeed(limit = 50): Promise<FeedListResponse> {
  const q = limit > 0 ? `?limit=${limit}` : "";
  return authJSON<FeedListResponse>("GET", `/v1/feed${q}`);
}
