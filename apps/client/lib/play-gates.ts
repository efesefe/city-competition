/**
 * Season 0 play gates — phone verify before spend / Kabile (CC-21).
 * Mirrors apps/api/src/lib/play-gates.ts + product auth-verification-flow.md.
 */

export const PHONE_VERIFY_WALL = {
  en: "Verify your phone to play — one account, fair fights.",
  tr: "Oynamak için telefonunu doğrula — tek hesap, adil savaş.",
} as const;

export const PHONE_SPEND_WALL = {
  en: "Verify phone to spend energy",
  tr: "Enerji harcamak için telefonunu doğrula",
} as const;

export const PHONE_KABILE_WALL = {
  en: "Verify your phone before picking a Kabile.",
  tr: "Kabile seçmeden önce telefonunu doğrula.",
} as const;

export type GateErrorBody = {
  error?: string;
  message?: string;
  messageTr?: string;
  gate?: string;
  code?: string;
};

export function isPhoneUnverifiedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const data = (err as Error & { data?: GateErrorBody }).data;
  if (data?.error === "phone_unverified" || data?.code === "phone_unverified") return true;
  return err.message === "phone_unverified";
}

/** Prefer TR product copy; fall back to EN then raw error. */
export function phoneGateMessage(err: unknown, kind: "play" | "spend" | "kabile" = "play"): string {
  const data = err instanceof Error ? (err as Error & { data?: GateErrorBody }).data : undefined;
  if (data?.messageTr) return data.messageTr;
  if (data?.message) return data.message;
  if (kind === "spend") return PHONE_SPEND_WALL.tr;
  if (kind === "kabile") return PHONE_KABILE_WALL.tr;
  return PHONE_VERIFY_WALL.tr;
}

export function needsPhoneVerify(user: { phoneVerified?: boolean } | null | undefined): boolean {
  return Boolean(user) && !user!.phoneVerified;
}

/** Guest browse-only (CC-23). Locked copy for city-sheet CTA. */
export const GUEST_SUPPORT_CTA = {
  en: "Log in to support",
  tr: "Desteklemek için giriş yap",
} as const;

export const GUEST_LOGIN_WALL = {
  en: "Log in to continue — guests can only browse the map.",
  tr: "Devam etmek için giriş yap — misafirler yalnızca haritayı gezebilir.",
} as const;

/** Paths guests may open without a session. */
export function isGuestBrowseRoute(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  return p === "/" || p === "/scoreboard" || p === "/index";
}

export function isGuest(user: unknown, token: string | null | undefined): boolean {
  return !token || !user;
}
