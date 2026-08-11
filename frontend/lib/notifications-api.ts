import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type NotificationsListResponse = {
  notifications: AppNotification[];
};

export type UnreadCountResponse = {
  unread_count: number;
};

export type MarkReadResponse = {
  updated: number;
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

export function listNotifications() {
  return authJSON<NotificationsListResponse>("GET", "/v1/notifications");
}

export function fetchUnreadCount() {
  return authJSON<UnreadCountResponse>("GET", "/v1/notifications/unread-count");
}

export function markNotificationsRead(input: {
  ids?: string[];
  all?: boolean;
}) {
  return authJSON<MarkReadResponse>("POST", "/v1/notifications/mark-read", {
    ids: input.ids ?? [],
    all: Boolean(input.all),
  });
}
