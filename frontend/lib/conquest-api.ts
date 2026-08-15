import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type ConquestLogEntry = {
  id: string;
  il_code: string;
  city_name: string;
  previous_tribe_id: string | null;
  new_tribe_id: string;
  winning_committed_credits: number;
  occurred_at: string;
  was_derbi_bonus: boolean;
  caused_flip: boolean;
};

export type ConquestLogListResponse = {
  entries: ConquestLogEntry[];
  next_offset?: number | null;
};

export type ConquestUnreadCountResponse = {
  unread_count: number;
};

export type ConquestMarkReadResponse = {
  updated: number;
};

export type ConquestSupporter = {
  user_id: string;
  display_name: string;
  avatar_url: string;
  contribution: number;
  is_you: boolean;
};

export type ConquestSupportersResponse = {
  log_id: string;
  caused_flip: boolean;
  supporters: ConquestSupporter[];
  total_contributor_count: number;
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

export function listConquestLog(limit = 20, offset = 0, ilCode?: string) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (ilCode) {
    params.set("il_code", ilCode);
  }
  return authJSON<ConquestLogListResponse>(
    "GET",
    `/v1/conquest-log?${params}`,
  );
}

export function fetchConquestUnreadCount() {
  return authJSON<ConquestUnreadCountResponse>(
    "GET",
    "/v1/conquest-log/unread-count",
  );
}

export function markConquestLogRead(input: { all?: boolean; up_to_id?: string }) {
  return authJSON<ConquestMarkReadResponse>(
    "POST",
    "/v1/conquest-log/mark-read",
    {
      all: Boolean(input.all),
      up_to_id: input.up_to_id,
    },
  );
}

export function fetchConquestSupporters(logId: string, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return authJSON<ConquestSupportersResponse>(
    "GET",
    `/v1/conquest-log/${encodeURIComponent(logId)}/supporters?${params}`,
  );
}

/** Walks a few list pages to resolve one log row (no single-id GET exists). */
export async function findConquestLogEntry(
  id: string,
): Promise<ConquestLogEntry | null> {
  let offset = 0;
  const limit = 50;
  for (let i = 0; i < 6; i += 1) {
    const page = await listConquestLog(limit, offset);
    const found = page.entries.find((e) => e.id === id);
    if (found) return found;
    if (page.next_offset == null || page.entries.length < limit) {
      return null;
    }
    offset = page.next_offset;
  }
  return null;
}
