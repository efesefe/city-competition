import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export const ACTIVITY_KINDS = [
  "conquest",
  "large_support",
  "derby_support",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One nationwide ticker event from GET /v1/activity-feed. */
export type ActivityFeedItem = {
  id: string;
  kind: ActivityKind;
  il_code: string;
  city_name: string;
  tribe_id: string;
  previous_tribe_id?: string | null;
  credits: number;
  was_derbi_bonus: boolean;
  occurred_at: string;
};

export type ActivityFeedListResponse = {
  events: ActivityFeedItem[];
};

export function isActivityKind(value: unknown): value is ActivityKind {
  return (
    value === "conquest" ||
    value === "large_support" ||
    value === "derby_support"
  );
}

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

/** Lists recent nationwide ticker events (newest first). */
export function listActivityFeed(limit = 50): Promise<ActivityFeedListResponse> {
  const q = limit > 0 ? `?limit=${limit}` : "";
  return authJSON<ActivityFeedListResponse>("GET", `/v1/activity-feed${q}`);
}
