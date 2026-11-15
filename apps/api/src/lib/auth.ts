import { nanoid } from "nanoid";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db.js";

export type UserRow = {
  id: string;
  handle: string;
  phone_e164: string | null;
  phone_verified: number;
  tribe_id: string | null;
  tribe_switched_at: string | null;
  free_energy: number;
  paid_energy: number;
  sub_energy: number;
  free_grant_date: string | null;
  created_at: string;
};

const MOCK_OTP = process.env.MOCK_OTP_CODE || "123456";
const HAS_NETGSM = Boolean(process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD);

export function authMode() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKeyConfigured: Boolean(process.env.SUPABASE_ANON_KEY),
    phoneOtp: HAS_NETGSM ? "netgsm" : "mock",
    mockOtpCode: HAS_NETGSM ? null : MOCK_OTP,
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID),
    appleEnabled: Boolean(process.env.APPLE_CLIENT_ID),
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

export function issueOtp(db: Db, phoneE164: string): { mock: boolean; code?: string; expiresAt: string } {
  const code = HAS_NETGSM ? String(Math.floor(100000 + Math.random() * 900000)) : MOCK_OTP;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (phone_e164, code, expires_at, attempts)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(phone_e164) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0`,
  ).run(phoneE164, code, expiresAt);

  if (HAS_NETGSM) {
    // Placeholder: Netgsm / İleti Merkezi via Supabase Custom Auth Hook in production.
    console.info(`[otp] would send via Netgsm to ${phoneE164}`);
  } else {
    console.info(`[otp] MOCK code for ${phoneE164}: ${code}`);
  }

  return HAS_NETGSM
    ? { mock: false, expiresAt }
    : { mock: true, code, expiresAt };
}

export function verifyOtp(db: Db, phoneE164: string, code: string): boolean {
  const row = db
    .prepare(`SELECT code, expires_at, attempts FROM otp_codes WHERE phone_e164 = ?`)
    .get(phoneE164) as { code: string; expires_at: string; attempts: number } | undefined;
  if (!row) return false;
  if (row.attempts >= 5) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone_e164 = ?`).run(phoneE164);
  if (row.code !== code) return false;
  db.prepare(`DELETE FROM otp_codes WHERE phone_e164 = ?`).run(phoneE164);
  return true;
}

export function upsertPhoneUser(db: Db, phoneE164: string): { user: UserRow; token: string } {
  let user = db.prepare(`SELECT * FROM users WHERE phone_e164 = ?`).get(phoneE164) as UserRow | undefined;
  if (!user) {
    const id = nanoid();
    const handle = `oyuncu_${id.slice(0, 6)}`;
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, handle, phone_e164, phone_verified, free_energy, paid_energy, sub_energy, created_at)
       VALUES (?, ?, ?, 1, 0, 0, 0, ?)`,
    ).run(id, handle, phoneE164, createdAt);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow;
  } else if (!user.phone_verified) {
    db.prepare(`UPDATE users SET phone_verified = 1 WHERE id = ?`).run(user.id);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as UserRow;
  }

  const token = nanoid(32);
  db.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(
    token,
    user.id,
    new Date().toISOString(),
  );
  return { user, token };
}

/** Stub OAuth: creates/returns a session shaped like Supabase Auth would hand off. */
export function stubOAuthLogin(
  db: Db,
  provider: "google" | "apple",
): { user: UserRow; token: string; needsPhone: true } {
  const id = nanoid();
  const handle = `${provider}_${id.slice(0, 6)}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, handle, phone_e164, phone_verified, free_energy, paid_energy, sub_energy, created_at)
     VALUES (?, ?, NULL, 0, 0, 0, 0, ?)`,
  ).run(id, handle, createdAt);
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow;
  const token = nanoid(32);
  db.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(
    token,
    user.id,
    createdAt,
  );
  return { user, token, needsPhone: true };
}

export function userFromRequest(db: Db, req: FastifyRequest): UserRow | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as UserRow | undefined;
  return row ?? null;
}

export function publicUser(user: UserRow, teamAlias?: string | null) {
  return {
    id: user.id,
    handle: user.handle,
    phoneVerified: Boolean(user.phone_verified),
    phoneE164: user.phone_e164,
    tribeId: user.tribe_id,
    tribeAlias: teamAlias ?? null,
    energy: {
      free: user.free_energy,
      paid: user.paid_energy,
      sub: user.sub_energy,
      total: user.free_energy + user.paid_energy + user.sub_energy,
    },
  };
}
