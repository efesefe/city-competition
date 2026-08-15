import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

/** Poll cadence for the map chip and tribe-chat dots. Not WebSocket-grade. */
export const PRESENCE_POLL_MS = 30_000;

/** Aligns with backend presence.DefaultTTL. Used to age out stale chat dots. */
export const PRESENCE_TTL_MS = 60_000;

export type OnlineCountResponse = {
  approximate_count: number;
};

export type OnlineMembersResponse = {
  user_ids: string[];
  approximate_count: number;
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

function coerceCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) {
    return 0;
  }
  return Math.round(v);
}

function numberLocale(uiLocale: string): string {
  return uiLocale.toLowerCase().startsWith("en") ? "en-US" : "tr-TR";
}

/**
 * Grouped integer for the approximate online chip. Does not include "~";
 * the i18n message supplies the tilde so the label never reads as exact.
 */
export function formatApproximateCount(n: number, locale: string): string {
  return new Intl.NumberFormat(numberLocale(locale), {
    maximumFractionDigits: 0,
  }).format(coerceCount(n));
}

/** Replace (never union) the chat presence set from a poll response. */
export function replaceOnlineIds(userIds: readonly unknown[]): Set<string> {
  const next = new Set<string>();
  for (const id of userIds) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim().toLowerCase();
    if (trimmed) next.add(trimmed);
  }
  return next;
}

/** Drop the presence set when the last successful poll is older than TTL. */
export function expireStaleOnlineIds(
  ids: ReadonlySet<string>,
  lastSuccessAt: number | null,
  now: number,
): Set<string> {
  if (lastSuccessAt == null || now - lastSuccessAt > PRESENCE_TTL_MS) {
    return new Set();
  }
  return new Set(ids);
}

export function isMemberOnline(
  senderId: string,
  onlineIds: ReadonlySet<string>,
): boolean {
  return onlineIds.has(senderId.trim().toLowerCase());
}

export function userAvatarPath(userId: string): string {
  return `/v1/users/${userId}/avatar`;
}

export function getOnlineCount(): Promise<OnlineCountResponse> {
  return authJSON<OnlineCountResponse>("GET", "/v1/presence/online-count").then(
    (data) => ({ approximate_count: coerceCount(data.approximate_count) }),
  );
}

export function getOnlineMembers(tribeId: string): Promise<OnlineMembersResponse> {
  return authJSON<OnlineMembersResponse>(
    "GET",
    `/v1/tribes/${encodeURIComponent(tribeId)}/online-members`,
  ).then((data) => {
    const user_ids = Array.isArray(data.user_ids) ? data.user_ids : [];
    const ids = [...replaceOnlineIds(user_ids)];
    return {
      user_ids: ids,
      approximate_count: coerceCount(data.approximate_count ?? ids.length),
    };
  });
}
