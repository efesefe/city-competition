/**
 * Supabase Auth Send SMS Hook seam (CC-19).
 * Netgsm / İleti Merkezi delivery is CC-20 — do not call vendor APIs here yet.
 *
 * Dashboard: Authentication → Hooks → Send SMS → HTTP endpoint
 *   POST {API}/v1/auth/hooks/send-sms
 * Secret: SEND_SMS_HOOK_SECRETS (Supabase hook secret / Standard Webhooks).
 */

export type SendSmsHookBody = {
  user?: { phone?: string; id?: string };
  sms?: { otp?: string; phone?: string };
  phone?: string;
};

export type SmsDeliverResult = {
  delivered: boolean;
  provider: "dry-run" | "pending-netgsm";
  note: string;
};

export function smsHookConfigured(): boolean {
  return Boolean(process.env.SEND_SMS_HOOK_SECRETS);
}

/**
 * Minimal secret check. Full Standard Webhooks signature verify lands with CC-20
 * alongside Netgsm; until then accept `Authorization: Bearer <secret>` or
 * `x-supabase-hook-secret` matching SEND_SMS_HOOK_SECRETS (comma-separated ok).
 */
export function verifySmsHookSecret(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = process.env.SEND_SMS_HOOK_SECRETS;
  if (!raw) return false;
  const secrets = raw.split(",").map((s) => s.trim()).filter(Boolean);
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
 * Delivery seam for CC-20. Logs OTP in dry-run so a real Supabase project + tunnel
 * can complete phone verify without Netgsm. Never returns the OTP to the client.
 */
export async function deliverOtpSms(opts: {
  phone: string | null;
  otp: string | null;
}): Promise<SmsDeliverResult> {
  const hasNetgsm = Boolean(process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD);
  const dryRun = process.env.SMS_HOOK_DRY_RUN !== "false";

  if (hasNetgsm && !dryRun) {
    // CC-20: call Netgsm / İleti Merkezi here. Keep return shape stable.
    console.info(
      `[sms-hook] Netgsm credentials present but delivery not implemented (CC-20); phone=${redactPhone(opts.phone)}`,
    );
    return {
      delivered: false,
      provider: "pending-netgsm",
      note: "CC-20 Netgsm hook not wired — set SMS_HOOK_DRY_RUN=true to log OTP locally",
    };
  }

  console.info(
    `[sms-hook] dry-run OTP for ${redactPhone(opts.phone)}: ${opts.otp ?? "(none)"} (CC-20: replace with Netgsm)`,
  );
  return {
    delivered: false,
    provider: "dry-run",
    note: "SMS not sent — dry-run seam; wire Netgsm in CC-20",
  };
}

function redactPhone(phone: string | null): string {
  if (!phone) return "(unknown)";
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 4)}…${phone.slice(-2)}`;
}
