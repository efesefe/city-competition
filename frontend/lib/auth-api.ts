export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type ApiError = { error: string };

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

export function requestOTP(phone: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/request", { phone });
}

export function resendOTP(phone: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/resend", { phone });
}

export function verifyOTP(phone: string, code: string) {
  return postJSON<{ status: string }>("/v1/auth/otp/verify", { phone, code });
}

export function register(phone: string, username: string) {
  return postJSON<{ user_id: string; session_token: string }>("/v1/auth/register", {
    phone,
    username,
  });
}

/** Normalize common TR local formats to E.164 (+90…). */
export function toE164TR(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let national = digits;
  if (national.startsWith("90") && national.length === 12) {
    national = national.slice(2);
  }
  if (national.startsWith("0") && national.length === 11) {
    national = national.slice(1);
  }
  if (national.length !== 10) return null;
  return `+90${national}`;
}
