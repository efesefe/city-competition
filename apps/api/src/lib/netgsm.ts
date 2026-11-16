/**
 * Netgsm SMS API v3 — OTP send for Supabase Send SMS Hook (CC-20).
 *
 * Docs: https://api-docs.netgsm.com.tr/
 *   POST /auth/v3/token          → Bearer access_token
 *   POST /sms/v3/send/otp        → jobId (202)
 *
 * Env:
 *   NETGSM_USERCODE / NETGSM_PASSWORD  — account credentials
 *   NETGSM_MSGHEADER | NETGSM_SENDER   — approved OTP başlık (required for live send)
 *   NETGSM_SANDBOX=true                — use ext-sandbox.netgsm.com.tr
 *   NETGSM_APP_NAME                    — optional appName field
 */

const LIVE_AUTH = "https://ext-api.netgsm.com.tr/auth/v3";
const LIVE_SMS = "https://ext-api.netgsm.com.tr/sms/v3";
const SANDBOX_AUTH = "https://ext-sandbox.netgsm.com.tr/auth/v3";
const SANDBOX_SMS = "https://ext-sandbox.netgsm.com.tr/sms/v3";

/** Default Latin-only OTP body (Netgsm OTP product rejects Turkish chars). */
const DEFAULT_OTP_TEMPLATE = "City Competition code: {{otp}}";

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

export type NetgsmSendResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; code: string; message: string };

export function netgsmCredentialsConfigured(): boolean {
  return Boolean(process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD);
}

export function netgsmSenderConfigured(): boolean {
  return Boolean(process.env.NETGSM_MSGHEADER || process.env.NETGSM_SENDER);
}

export function netgsmReadyForLiveSend(): boolean {
  return netgsmCredentialsConfigured() && netgsmSenderConfigured();
}

function bases(): { auth: string; sms: string } {
  const sandbox = process.env.NETGSM_SANDBOX === "true";
  return sandbox
    ? { auth: SANDBOX_AUTH, sms: SANDBOX_SMS }
    : { auth: LIVE_AUTH, sms: LIVE_SMS };
}

function senderHeader(): string {
  return (process.env.NETGSM_MSGHEADER || process.env.NETGSM_SENDER || "").trim();
}

/** Netgsm accepts 5XXXXXXXXX / 05XXXXXXXXX / 905XXXXXXXXX / +905… */
export function toNetgsmRecipient(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  return null;
}

/** Strip non-Latin chars that Netgsm OTP product rejects; keep ASCII-safe body. */
export function buildOtpText(otp: string): string {
  const template = process.env.NETGSM_OTP_TEMPLATE || DEFAULT_OTP_TEMPLATE;
  const raw = template.replace(/\{\{\s*otp\s*\}\}/gi, otp).trim();
  // Map common Turkish letters → ASCII (OTP product Latin-only constraint).
  const map: Record<string, string> = {
    ç: "c",
    Ç: "C",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ö: "o",
    Ö: "O",
    ş: "s",
    Ş: "S",
    ü: "u",
    Ü: "U",
  };
  return raw
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^\x20-\x7E]/g, "?")
    .slice(0, 155);
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body };
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const usercode = process.env.NETGSM_USERCODE;
  const password = process.env.NETGSM_PASSWORD;
  if (!usercode || !password) {
    throw new Error("netgsm_credentials_missing");
  }

  const now = Date.now();
  if (!forceRefresh && tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.accessToken;
  }

  const { auth } = bases();
  const { status, body } = await fetchJson(`${auth}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: usercode,
      password,
      scope: "sms:send",
    }),
  });

  const parsed = body as {
    access_token?: string;
    expires_in?: number;
    code?: string;
    detail?: string;
    message?: string;
  };

  if (status !== 200 || !parsed.access_token) {
    const msg = parsed.detail || parsed.message || parsed.code || `HTTP ${status}`;
    throw Object.assign(new Error(`netgsm_token_failed: ${msg}`), {
      statusCode: status,
      netgsmCode: parsed.code,
    });
  }

  const expiresInSec = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  tokenCache = {
    accessToken: parsed.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };
  return tokenCache.accessToken;
}

/**
 * Send a single OTP SMS via Netgsm v3. Retries once on 401 (expired token).
 */
export async function sendNetgsmOtp(opts: {
  phone: string;
  otp: string;
}): Promise<NetgsmSendResult> {
  const sender = senderHeader();
  if (!sender) {
    return {
      ok: false,
      status: 400,
      code: "SENDER_MISSING",
      message: "Set NETGSM_MSGHEADER (or NETGSM_SENDER) to an approved OTP başlık",
    };
  }

  const recipient = toNetgsmRecipient(opts.phone);
  if (!recipient) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_RECIPIENT",
      message: "phone must be a TR mobile number",
    };
  }

  const text = buildOtpText(opts.otp);
  const { sms } = bases();
  const appName = process.env.NETGSM_APP_NAME || "city-competition";

  const attempt = async (token: string) =>
    fetchJson(`${sms}/send/otp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        text,
        recipient,
        appName,
      }),
    });

  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    const err = e as Error & { statusCode?: number; netgsmCode?: string };
    return {
      ok: false,
      status: err.statusCode ?? 502,
      code: err.netgsmCode || "TOKEN_FAILED",
      message: err.message,
    };
  }

  let { status, body } = await attempt(token);

  if (status === 401) {
    try {
      token = await getAccessToken(true);
      ({ status, body } = await attempt(token));
    } catch (e) {
      const err = e as Error & { statusCode?: number; netgsmCode?: string };
      return {
        ok: false,
        status: err.statusCode ?? 502,
        code: err.netgsmCode || "TOKEN_FAILED",
        message: err.message,
      };
    }
  }

  const parsed = body as {
    jobId?: string;
    code?: string;
    message?: string;
  };

  if (status === 202 && parsed.jobId) {
    return { ok: true, jobId: parsed.jobId };
  }

  return {
    ok: false,
    status,
    code: parsed.code || `HTTP_${status}`,
    message: parsed.message || "netgsm_otp_send_failed",
  };
}

/** Test helper — clear cached Bearer token. */
export function clearNetgsmTokenCache(): void {
  tokenCache = null;
}
