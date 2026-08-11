export const SESSION_TOKEN_KEY = "cc_session_token";
export const USER_ID_KEY = "cc_user_id";
export const RESTRICTED_MODE_KEY = "cc_restricted_mode";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(USER_ID_KEY);
}

export function isRestrictedMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(RESTRICTED_MODE_KEY) === "1";
}

export function setSession(
  userId: string,
  sessionToken: string,
  restrictedMode = false,
): void {
  window.localStorage.setItem(USER_ID_KEY, userId);
  window.localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
  window.localStorage.setItem(RESTRICTED_MODE_KEY, restrictedMode ? "1" : "0");
}

export function clearSession(): void {
  window.localStorage.removeItem(USER_ID_KEY);
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(RESTRICTED_MODE_KEY);
}
