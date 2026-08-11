import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type Tribe = {
  id: string;
  slug: string;
  display_name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
  is_active: boolean;
  member_count?: number;
  created_at: string;
  updated_at: string;
};

export type TribeMembership = {
  tribe_id: string | null;
  tribe_switched_at: string | null;
  switch_available_at: string | null;
};

export type TribesListResponse = {
  tribes: Tribe[];
  membership: TribeMembership;
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

export function listTribes() {
  return authJSON<TribesListResponse>("GET", "/v1/tribes");
}

export function getTribe(id: string) {
  return authJSON<Tribe>("GET", `/v1/tribes/${id}`);
}

export function joinTribe(id: string) {
  return authJSON<{ tribe_id: string }>("POST", `/v1/tribes/${id}/join`);
}

export function switchTribe(id: string) {
  return authJSON<{ tribe_id: string }>("POST", `/v1/tribes/${id}/switch`);
}

export type TribeMessage = {
  id: string;
  kind: string;
  sender_id: string;
  tribe_id?: string | null;
  body: string;
  flagged: boolean;
  created_at: string;
};

export type SendTribeMessageResponse = {
  message: TribeMessage;
};

export function sendTribeMessage(tribeId: string, body: string) {
  return authJSON<SendTribeMessageResponse>(
    "POST",
    `/v1/tribes/${tribeId}/messages`,
    { body },
  );
}

export function hasTribeMembership(membership: TribeMembership | null | undefined) {
  return Boolean(membership?.tribe_id);
}
