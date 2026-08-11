import { nationalToE164TR } from "@/lib/phoneFormat";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export {
  extractTRNationalDigits,
  formatTRNationalPhone,
  nationalToE164TR,
} from "@/lib/phoneFormat";

export type ApiError = { error: string; merge_token?: string; phone_hint?: string };

export class AuthApiError extends Error {
  status: number;
  code: string;
  mergeToken?: string;
  phoneHint?: string;

  constructor(
    message: string,
    opts: { status: number; code: string; mergeToken?: string; phoneHint?: string },
  ) {
    super(message);
    this.status = opts.status;
    this.code = opts.code;
    this.mergeToken = opts.mergeToken;
    this.phoneHint = opts.phoneHint;
  }
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw new AuthApiError(data.error ?? "request_failed", {
      status: res.status,
      code: data.error ?? "request_failed",
      mergeToken: data.merge_token,
      phoneHint: data.phone_hint,
    });
  }
  return data;
}

export function requestOTP(phone: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/request", { phone });
}

export function resendOTP(phone: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/resend", { phone });
}

export function verifyOTP(phone: string, code: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/verify", { phone, code });
}

export function register(phone: string, username: string, birthDate: string) {
  return postJSON<{
    user_id: string;
    session_token: string;
    restricted_mode: boolean;
  }>("/v1/auth/register", {
    phone,
    username,
    birth_date: birthDate,
  });
}

export type SocialProvider = "google" | "apple";

export function socialLogin(input: {
  provider: SocialProvider;
  idToken: string;
  username?: string;
  birthDate?: string;
}) {
  return postJSON<{
    user_id: string;
    session_token: string;
    restricted_mode: boolean;
  }>("/v1/auth/social/login", {
    provider: input.provider,
    id_token: input.idToken,
    username: input.username,
    birth_date: input.birthDate,
  });
}

export function socialMerge(mergeToken: string, phone: string) {
  return postJSON<{
    user_id: string;
    session_token: string;
    restricted_mode: boolean;
  }>("/v1/auth/social/merge", {
    merge_token: mergeToken,
    phone,
  });
}

/** Normalize common TR local formats to E.164 (+90…). */
export function toE164TR(input: string): string | null {
  return nationalToE164TR(input);
}

/** True when birth date is under 18 (local calendar). */
export function isUnder18(birthDateISO: string, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateISO);
  if (!m) return false;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let age = now.getFullYear() - birth.getFullYear();
  const md = now.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age--;
  return age < 18;
}

const MERGE_KEY = "cc_social_merge";

export type PendingMerge = {
  mergeToken: string;
  phoneHint?: string;
  provider: SocialProvider;
};

export function storePendingMerge(pending: PendingMerge) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(MERGE_KEY, JSON.stringify(pending));
}

export function loadPendingMerge(): PendingMerge | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(MERGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingMerge;
  } catch {
    return null;
  }
}

export function clearPendingMerge() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(MERGE_KEY);
}

/**
 * Obtain a provider ID token. In e2e/dev, NEXT_PUBLIC_SOCIAL_STUB_TOKEN is used.
 * Production should replace this with Google Identity Services / Apple JS SDK.
 */
export async function obtainSocialIdToken(
  provider: SocialProvider,
): Promise<string> {
  const stub = process.env.NEXT_PUBLIC_SOCIAL_STUB_TOKEN;
  if (stub) return stub;

  if (typeof window !== "undefined") {
    const w = window as unknown as {
      __ccSocialIdToken?: string | ((p: SocialProvider) => string);
    };
    if (typeof w.__ccSocialIdToken === "function") {
      return w.__ccSocialIdToken(provider);
    }
    if (typeof w.__ccSocialIdToken === "string" && w.__ccSocialIdToken) {
      return w.__ccSocialIdToken;
    }
  }

  throw new Error(
    provider === "google"
      ? "Google giriş yapılandırılmadı."
      : "Apple giriş yapılandırılmadı.",
  );
}
