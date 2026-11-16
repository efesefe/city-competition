/**
 * Supabase Auth Send SMS Hook (CC-20).
 *
 * Dashboard: Authentication → Hooks → Send SMS → HTTP endpoint
 *   POST {API}/v1/auth/hooks/send-sms
 * Secret: SEND_SMS_HOOK_SECRETS (Bearer / x-supabase-hook-secret; Standard Webhooks secret string).
 *
 * Delivery:
 *   - Credentials absent OR SMS_HOOK_DRY_RUN !== "false" → dry-run (log OTP, no vendor call)
 *   - NETGSM_USERCODE + NETGSM_PASSWORD + NETGSM_MSGHEADER + SMS_HOOK_DRY_RUN=false → live Netgsm OTP
 */

import {
  netgsmCredentialsConfigured,
  netgsmReadyForLiveSend,
  sendNetgsmOtp,
} from "./netgsm.js";

export type SendSmsHookBody = {
  user?: { phone?: string; id?: string };
  sms?: { otp?: string; phone?: string };
  phone?: string;
};

export type SmsDeliverResult = {
  delivered: boolean;
  provider: "dry-run" | "netgsm";
  note: string;
  jobId?: string;
  error?: string;
};

export function smsHookConfigured(): boolean {
  return Boolean(process.env.SEND_SMS_HOOK_SECRETS);
}

export function smsHookDryRun(): boolean {
  // Default safe: dry-run unless explicitly disabled.
  return process.env.SMS_HOOK_DRY_RUN !== "false";
}

export function netgsmDeliveryMode(): "live" | "dry-run" {
  return netgsmReadyForLiveSend() && !smsHookDryRun() ? "live" : "dry-run";
}

/**
 * Accept `Authorization: Bearer <secret>` or `x-supabase-hook-secret`.
 * `SEND_SMS_HOOK_SECRETS` is one secret by default (often `v1,whsec_…`).
 * Multiple secrets: separate with `|` (never comma — Standard Webhooks uses commas).
 */
export function verifySmsHookSecret(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = process.env.SEND_SMS_HOOK_SECRETS;
  if (!raw) return false;
  const secrets = raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const auth = headerValue(headers, "authorization");
  const hookHeader = headerValue(headers, "x-supabase-hook-secret");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  return secrets.some((s) => s === bearer || s === hookHeader || s === auth);
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function parseSendSmsHookBody(body: unknown): { phone: string | null; otp: string | null } {
  const b = (body ?? {}) as SendSmsHookBody;
  const phone = b.sms?.phone || b.user?.phone || b.phone || null;
  const otp = b.sms?.otp || null;
  return { phone, otp };
}

/**
 * Deliver OTP via Netgsm when live; otherwise dry-run log.
 * Never echoes the OTP in the HTTP response body.
 */
export async function deliverOtpSms(opts: {
  phone: string | null;
  otp: string | null;
}): Promise<SmsDeliverResult> {
  const dryRun = smsHookDryRun();
  const hasCreds = netgsmCredentialsConfigured();

  if (!opts.phone || !opts.otp) {
    return {
      delivered: false,
      provider: dryRun || !hasCreds ? "dry-run" : "netgsm",
      note: "missing phone or otp in hook body",
      error: "missing_phone_or_otp",
    };
  }

  if (dryRun || !hasCreds) {
    console.info(
      `[sms-hook] dry-run OTP for ${redactPhone(opts.phone)}: ${opts.otp}` +
        (hasCreds ? " (SMS_HOOK_DRY_RUN; set false for live Netgsm)" : " (NETGSM_* unset)"),
    );
    return {
      delivered: false,
      provider: "dry-run",
      note: hasCreds
        ? "SMS not sent — dry-run (set SMS_HOOK_DRY_RUN=false for live Netgsm)"
        : "SMS not sent — set NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_MSGHEADER",
    };
  }

  if (!netgsmReadyForLiveSend()) {
    console.warn(
      `[sms-hook] Netgsm credentials present but NETGSM_MSGHEADER/NETGSM_SENDER missing; phone=${redactPhone(opts.phone)}`,
    );
    return {
      delivered: false,
      provider: "netgsm",
      note: "NETGSM_MSGHEADER (approved başlık) required for live send",
      error: "sender_missing",
    };
  }

  const result = await sendNetgsmOtp({ phone: opts.phone, otp: opts.otp });
  if (result.ok) {
    console.info(
      `[sms-hook] Netgsm OTP accepted jobId=${result.jobId} phone=${redactPhone(opts.phone)}`,
    );
    return {
      delivered: true,
      provider: "netgsm",
      note: "OTP accepted by Netgsm",
      jobId: result.jobId,
    };
  }

  console.error(
    `[sms-hook] Netgsm OTP failed status=${result.status} code=${result.code} phone=${redactPhone(opts.phone)}: ${result.message}`,
  );
  return {
    delivered: false,
    provider: "netgsm",
    note: "Netgsm OTP send failed",
    error: `${result.code}: ${result.message}`,
  };
}

function redactPhone(phone: string | null): string {
  if (!phone) return "(unknown)";
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 4)}…${phone.slice(-2)}`;
}
