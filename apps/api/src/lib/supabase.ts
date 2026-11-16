import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { nanoid } from "nanoid";
import type { Queryable } from "./db.js";
import { one } from "./db.js";
import type { UserRow } from "./auth.js";

export type SupabaseClaims = JWTPayload & {
  sub: string;
  phone?: string | null;
  email?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: Record<string, unknown>;
};

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_JWT_SECRET);
}

export function supabaseClientConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export function oauthProviderEnabled(provider: "google" | "apple"): boolean {
  if (provider === "google") {
    return Boolean(process.env.GOOGLE_CLIENT_ID) || supabaseConfigured();
  }
  return Boolean(process.env.APPLE_CLIENT_ID) || supabaseConfigured();
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  const url = process.env.SUPABASE_URL;
  if (!url) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${url.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

/** Verify a Supabase Auth access token (HS256 JWT secret and/or project JWKS). */
export async function verifySupabaseAccessToken(token: string): Promise<SupabaseClaims | null> {
  if (!supabaseConfigured() && !process.env.SUPABASE_URL) return null;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
        audience: "authenticated",
      });
      if (typeof payload.sub !== "string" || !payload.sub) return null;
      return payload as SupabaseClaims;
    } catch {
      // fall through to JWKS (newer asymmetric projects)
    }
  }

  const remote = getJwks();
  if (!remote) return null;
  try {
    const { payload } = await jwtVerify(token, remote, { audience: "authenticated" });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return payload as SupabaseClaims;
  } catch {
    return null;
  }
}

function phoneFromClaims(claims: SupabaseClaims): string | null {
  const raw = claims.phone;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

/**
 * Upsert local game user from verified Supabase JWT claims.
 * Phone presence on the JWT ⇒ phone_verified (Supabase phone confirm).
 */
export async function upsertUserFromSupabase(
  db: Queryable,
  claims: SupabaseClaims,
): Promise<UserRow> {
  const supabaseUserId = claims.sub;
  const phone = phoneFromClaims(claims);
  const phoneVerified = Boolean(phone);

  let user =
    (await one<UserRow>(db, `SELECT * FROM users WHERE supabase_user_id = $1`, [supabaseUserId])) ??
    (phone
      ? await one<UserRow>(db, `SELECT * FROM users WHERE phone_e164 = $1`, [phone])
      : null);

  if (!user) {
    const id = nanoid();
    const handle = `oyuncu_${id.slice(0, 6)}`;
    const createdAt = new Date().toISOString();
    await db.query(
      `INSERT INTO users (
         id, handle, phone_e164, phone_verified, supabase_user_id,
         free_energy, paid_energy, sub_energy, created_at
       ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6)`,
      [id, handle, phone, phoneVerified, supabaseUserId, createdAt],
    );
    user = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [id]))!;
    return user;
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (!user.supabase_user_id) {
    updates.push(`supabase_user_id = $${i++}`);
    params.push(supabaseUserId);
  }
  if (phone && user.phone_e164 !== phone) {
    updates.push(`phone_e164 = $${i++}`);
    params.push(phone);
  }
  if (phoneVerified && !user.phone_verified) {
    updates.push(`phone_verified = TRUE`);
  }

  if (updates.length > 0) {
    params.push(user.id);
    await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${i}`, params);
    user = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [user.id]))!;
  }

  return user;
}
