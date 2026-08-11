export const SESSION_TOKEN_KEY = "cc_session_token";
export const USER_ID_KEY = "cc_user_id";
export const RESTRICTED_MODE_KEY = "cc_restricted_mode";
export const IMPERSONATION_STACK_KEY = "cc_impersonation_stack";
export const ACTING_AS_KEY = "cc_acting_as_username";

export type StackedSession = {
  userId: string;
  sessionToken: string;
  restrictedMode: boolean;
  username?: string;
};

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

export function getActingAsUsername(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ACTING_AS_KEY);
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

export function pushImpersonationStack(
  current: StackedSession,
  actingAs?: string,
) {
  const raw = window.sessionStorage.getItem(IMPERSONATION_STACK_KEY);
  const stack: StackedSession[] = raw
    ? (JSON.parse(raw) as StackedSession[])
    : [];
  stack.push(current);
  window.sessionStorage.setItem(IMPERSONATION_STACK_KEY, JSON.stringify(stack));
  if (actingAs) {
    window.sessionStorage.setItem(ACTING_AS_KEY, actingAs);
  }
}

export function popImpersonationStack(): StackedSession | null {
  const raw = window.sessionStorage.getItem(IMPERSONATION_STACK_KEY);
  if (!raw) return null;
  const stack = JSON.parse(raw) as StackedSession[];
  const prev = stack.pop() ?? null;
  if (stack.length === 0) {
    window.sessionStorage.removeItem(IMPERSONATION_STACK_KEY);
    window.sessionStorage.removeItem(ACTING_AS_KEY);
  } else {
    window.sessionStorage.setItem(
      IMPERSONATION_STACK_KEY,
      JSON.stringify(stack),
    );
  }
  return prev;
}

export function clearSession(): void {
  window.localStorage.removeItem(USER_ID_KEY);
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(RESTRICTED_MODE_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_STACK_KEY);
  window.sessionStorage.removeItem(ACTING_AS_KEY);
}
