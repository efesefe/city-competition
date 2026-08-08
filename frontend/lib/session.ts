export const SESSION_TOKEN_KEY = "cc_session_token";
export const USER_ID_KEY = "cc_user_id";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSession(userId: string, sessionToken: string): void {
  window.localStorage.setItem(USER_ID_KEY, userId);
  window.localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
}

export function clearSession(): void {
  window.localStorage.removeItem(USER_ID_KEY);
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}
