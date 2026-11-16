/**
 * Season 0 play gates — phone verify before spend / Kabile (CC-21).
 * Copy locked in product auth-verification-flow.md (Efe 2026-11-15).
 */

export const PHONE_UNVERIFIED = "phone_unverified" as const;
export const TRIBE_REQUIRED = "tribe_required" as const;

/** Full verify wall (OAuth / post-login). */
export const PHONE_VERIFY_WALL = {
  error: PHONE_UNVERIFIED,
  message: "Verify your phone to play — one account, fair fights.",
  messageTr: "Oynamak için telefonunu doğrula — tek hesap, adil savaş.",
} as const;

/** Inline spend / energy wall (shorter). */
export const PHONE_SPEND_WALL = {
  error: PHONE_UNVERIFIED,
  message: "Verify phone to spend energy",
  messageTr: "Enerji harcamak için telefonunu doğrula",
} as const;

/** Kabile pick blocked until verify. */
export const PHONE_KABILE_WALL = {
  error: PHONE_UNVERIFIED,
  message: "Verify your phone before picking a Kabile.",
  messageTr: "Kabile seçmeden önce telefonunu doğrula.",
} as const;

export type PhoneGatePayload = {
  error: typeof PHONE_UNVERIFIED;
  message: string;
  messageTr: string;
  code: typeof PHONE_UNVERIFIED;
  gate: "phone_verify";
};

export function phoneUnverifiedPayload(
  kind: "play" | "spend" | "kabile" = "play",
): PhoneGatePayload {
  const wall =
    kind === "spend" ? PHONE_SPEND_WALL : kind === "kabile" ? PHONE_KABILE_WALL : PHONE_VERIFY_WALL;
  return {
    error: PHONE_UNVERIFIED,
    message: wall.message,
    messageTr: wall.messageTr,
    code: PHONE_UNVERIFIED,
    gate: "phone_verify",
  };
}

export function isPhoneVerified(user: { phone_verified?: boolean; phoneVerified?: boolean }): boolean {
  return Boolean(user.phone_verified ?? user.phoneVerified);
}
