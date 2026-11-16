import { nanoid } from "nanoid";
import type { FastifyRequest } from "fastify";
import { one, type Queryable } from "./db.js";
import { deliverOtpSms, netgsmDeliveryMode, smsHookConfigured } from "./sms-hook.js";
import {
  oauthProviderEnabled,
  supabaseClientConfigured,
  supabaseConfigured,
  upsertUserFromSupabase,
  verifySupabaseAccessToken,
} from "./supabase.js";

export type UserRow = {
  id: string;
  handle: string;
  phone_e164: string | null;
  phone_verified: boolean;
  supabase_user_id: string | null;
  tribe_id: string | null;
  tribe_switched_at: string | null;
  free_energy: number;
  paid_energy: number;
  sub_energy: number;
  free_grant_date: string | null;
  /** Server entitlement for TR midnight +50; set by payments / ops, not client. */
  sub_active?: boolean;
  sub_grant_date?: string | null;
  created_at: string;
  /** ISO timestamptz when personal boost is active; null when inactive. */
  personal_boost_expires_at?: string | Date | null;
};

const MOCK_OTP = process.env.MOCK_OTP_CODE || "123456";

export type AuthMode = {
  /** Live Supabase JWT verify + user map when URL + JWT secret set. */
  mode: "supabase" | "mock";
  supabaseUrl: string | null;
  supabaseAnonKeyConfigured: boolean;
  supabaseJwtConfigured: boolean;
  phoneOtp: "supabase" | "netgsm" | "mock";
  mockOtpCode: string | null;
  googleEnabled: boolean;
  appleEnabled: boolean;
  /** OAuth uses live Supabase providers when configured; else local stub. */
  oauthMode: "supabase" | "stub";
  /** Send SMS Hook — Netgsm live when credentials + SMS_HOOK_DRY_RUN=false. */
  smsHook: {
    path: string;
    secretConfigured: boolean;
    netgsmDelivery: "live" | "dry-run";
  };
};

export function authMode(): AuthMode {
  const live = supabaseConfigured();
  const delivery = netgsmDeliveryMode();
  return {
    mode: live ? "supabase" : "mock",
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKeyConfigured: supabaseClientConfigured(),
    supabaseJwtConfigured: Boolean(process.env.SUPABASE_JWT_SECRET),
    phoneOtp: live ? "supabase" : delivery === "live" ? "netgsm" : "mock",
    mockOtpCode: live || delivery === "live" ? null : MOCK_OTP,
    // Mock mode always offers stub buttons; live mode needs provider env or Supabase project.
    googleEnabled: live ? oauthProviderEnabled("google") : true,
    appleEnabled: live ? oauthProviderEnabled("apple") : true,
    oauthMode: live ? "supabase" : "stub",
    smsHook: {
      path: "/v1/auth/hooks/send-sms",
      secretConfigured: smsHookConfigured(),
      netgsmDelivery: delivery,
    },
  };
}

export function normalizeTrPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+90${digits.slice(1)}`;
  if (digits.length === 10) return `+90${digits}`;
  if (input.startsWith("+90") && digits.length === 12) return `+${digits}`;
  return null;
}

export async function issueOtp(
  db: Queryable,
  phoneE164: string,
): Promise<{ mock: boolean; code?: string; expiresAt: string }> {
  if (supabaseConfigured()) {
    // Live phone OTP is owned by Supabase Auth (client SDK). Local table unused.
    throw Object.assign(new Error("use_supabase_phone_otp"), { statusCode: 400 });
  }

  const liveNetgsm = netgsmDeliveryMode() === "live";
  const code = liveNetgsm ? String(Math.floor(100000 + Math.random() * 900000)) : MOCK_OTP;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO otp_codes (phone_e164, code, expires_at, attempts)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (phone_e164) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [phoneE164, code, expiresAt],
  );

  if (liveNetgsm) {
    // Local mock-auth path can also send via Netgsm when dry-run is off (dev/staging).
    const sms = await deliverOtpSms({ phone: phoneE164, otp: code });
    if (!sms.delivered) {
      console.warn(`[otp] Netgsm send failed for ${phoneE164}: ${sms.error ?? sms.note}`);
    }
  } else {
    console.info(`[otp] MOCK code for ${phoneE164}: ${code}`);
  }

  return liveNetgsm ? { mock: false, expiresAt } : { mock: true, code, expiresAt };
}

export async function verifyOtp(db: Queryable, phoneE164: string, code: string): Promise<boolean> {
  const row = await one<{ code: string; expires_at: string; attempts: number }>(
    db,
    `SELECT code, expires_at, attempts FROM otp_codes WHERE phone_e164 = $1`,
    [phoneE164],
  );
  if (!row) return false;
  if (row.attempts >= 5) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone_e164 = $1`, [phoneE164]);
  if (row.code !== code) return false;
  await db.query(`DELETE FROM otp_codes WHERE phone_e164 = $1`, [phoneE164]);
  return true;
}

export async function upsertPhoneUser(
  db: Queryable,
  phoneE164: string,
): Promise<{ user: UserRow; token: string }> {
  let user = await one<UserRow>(db, `SELECT * FROM users WHERE phone_e164 = $1`, [phoneE164]);
  if (!user) {
    const id = nanoid();
    const handle = `oyuncu_${id.slice(0, 6)}`;
    const createdAt = new Date().toISOString();
    await db.query(
      `INSERT INTO users (id, handle, phone_e164, phone_verified, free_energy, paid_energy, sub_energy, created_at)
       VALUES ($1, $2, $3, TRUE, 0, 0, 0, $4)`,
      [id, handle, phoneE164, createdAt],
    );
    user = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [id]))!;
  } else if (!user.phone_verified) {
    await db.query(`UPDATE users SET phone_verified = TRUE WHERE id = $1`, [user.id]);
    user = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [user.id]))!;
  }

  const token = nanoid(32);
  await db.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)`, [
    token,
    user.id,
    new Date().toISOString(),
  ]);
  return { user, token };
}

/** Local mock OAuth when Supabase is not configured. */
export async function stubOAuthLogin(
  db: Queryable,
  provider: "google" | "apple",
): Promise<{ user: UserRow; token: string; needsPhone: true }> {
  const id = nanoid();
  const handle = `${provider}_${id.slice(0, 6)}`;
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO users (id, handle, phone_e164, phone_verified, free_energy, paid_energy, sub_energy, created_at)
     VALUES ($1, $2, NULL, FALSE, 0, 0, 0, $3)`,
    [id, handle, createdAt],
  );
  const user = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [id]))!;
  const token = nanoid(32);
  await db.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)`, [
    token,
    user.id,
    createdAt,
  ]);
  return { user, token, needsPhone: true };
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export async function userFromRequest(
  db: Queryable,
  req: FastifyRequest,
): Promise<UserRow | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);

  if (looksLikeJwt(token) && (supabaseConfigured() || process.env.SUPABASE_URL)) {
    const claims = await verifySupabaseAccessToken(token);
    if (claims) return upsertUserFromSupabase(db, claims);
  }

  const row = await one<UserRow>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  return row ?? null;
}

/** Exchange a verified Supabase access token for the public game session shape. */
export async function sessionFromSupabaseToken(
  db: Queryable,
  accessToken: string,
): Promise<{ user: UserRow; accessToken: string; needsPhone: boolean } | null> {
  const claims = await verifySupabaseAccessToken(accessToken);
  if (!claims) return null;
  const user = await upsertUserFromSupabase(db, claims);
  return {
    user,
    accessToken,
    needsPhone: !user.phone_verified,
  };
}

export async function getUserById(db: Queryable, id: string): Promise<UserRow | null> {
  return (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [id])) ?? null;
}

export type PublicBoost = {
  personalBoostPct: number;
  teamBoostPct: number;
  personalExpiresAt: string | null;
  teamWindowEndsAt: string | null;
};

export function publicUser(
  user: UserRow,
  teamAlias?: string | null,
  boost?: PublicBoost | null,
) {
  return {
    id: user.id,
    handle: user.handle,
    phoneVerified: Boolean(user.phone_verified),
    phoneE164: user.phone_e164,
    tribeId: user.tribe_id,
    tribeAlias: teamAlias ?? null,
    subActive: Boolean(user.sub_active),
    energy: {
      free: Number(user.free_energy),
      paid: Number(user.paid_energy),
      sub: Number(user.sub_energy),
      total: Number(user.free_energy) + Number(user.paid_energy) + Number(user.sub_energy),
    },
    boost: boost ?? {
      personalBoostPct: 1,
      teamBoostPct: 1,
      personalExpiresAt: null,
      teamWindowEndsAt: null,
    },
  };
}
