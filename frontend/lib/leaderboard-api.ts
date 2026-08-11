import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  username: string;
  score: number;
};

export type MeRank = {
  rank: number;
  score: number;
};

export type LeaderboardBoard = {
  entries: LeaderboardEntry[];
  limit: number;
  me?: MeRank | null;
};

export type MeRankResponse = {
  me: MeRank | null;
};

export type LeaderboardScope = "global" | "tribe" | "province" | "derby";

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

export function fetchGlobalBoard(limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  return authJSON<LeaderboardBoard>("GET", `/v1/leaderboards/global?${q}`);
}

export function fetchTribeBoard(tribeId: string, limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  return authJSON<LeaderboardBoard>(
    "GET",
    `/v1/leaderboards/tribes/${encodeURIComponent(tribeId)}?${q}`,
  );
}

export function fetchMyRank(
  scope: LeaderboardScope,
  id?: string,
): Promise<MeRankResponse> {
  const q = new URLSearchParams({ scope });
  if (id) {
    if (scope === "province") {
      q.set("il_code", id);
    } else {
      q.set("id", id);
    }
  }
  return authJSON<MeRankResponse>("GET", `/v1/leaderboards/me?${q}`);
}
