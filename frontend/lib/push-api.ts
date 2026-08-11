import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type PushPlatform = "ios" | "android" | "web";

const PUSH_TOKEN_KEY = "cc_web_push_token";
const PUSH_ENABLED_KEY = "cc_web_push_enabled";

async function authEmpty(
  method: string,
  path: string,
  body: unknown,
): Promise<void> {
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
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    throw Object.assign(new Error(data.error ?? "request_failed"), {
      status: res.status,
      code: data.error,
    });
  }
}

export function putPushToken(platform: PushPlatform, deviceToken: string) {
  return authEmpty("PUT", "/v1/me/push-tokens", {
    platform,
    token: deviceToken,
  });
}

export function deletePushToken(deviceToken: string, platform: PushPlatform = "web") {
  return authEmpty("DELETE", "/v1/me/push-tokens", {
    platform,
    token: deviceToken,
  });
}

export function getStoredPushToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PUSH_TOKEN_KEY);
}

export function isPushEnabledLocally(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUSH_ENABLED_KEY) === "1";
}

function ensureDeviceToken(): string {
  const existing = getStoredPushToken();
  if (existing) return existing;
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(PUSH_TOKEN_KEY, token);
  return token;
}

/**
 * Enable web push registration: request Notification permission when available,
 * then register a stable browser token with the backend (VAPID/FCM is Track H).
 */
export async function enableWebPush(): Promise<void> {
  if (typeof window !== "undefined" && "Notification" in window) {
    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      throw Object.assign(new Error("notification_permission_denied"), {
        code: "notification_permission_denied",
      });
    }
  }
  const deviceToken = ensureDeviceToken();
  await putPushToken("web", deviceToken);
  window.localStorage.setItem(PUSH_ENABLED_KEY, "1");
}

/** Disable push: delete backend token and clear local enabled flag. */
export async function disableWebPush(): Promise<void> {
  const deviceToken = getStoredPushToken();
  if (deviceToken) {
    await deletePushToken(deviceToken, "web");
  }
  window.localStorage.setItem(PUSH_ENABLED_KEY, "0");
}
