import { nanoid } from "nanoid";
import type { FastifyRequest } from "fastify";
import type { UserRow } from "./auth.js";
import { normalizeTrPhone } from "./auth.js";
import { one, withTransaction, type Db, type Queryable } from "./db.js";

export type SupportLookup = {
  id: string;
  handle: string;
  phoneE164: string | null;
  phoneLast4: string | null;
  phoneVerified: boolean;
  tribeId: string | null;
  supabaseUserId: string | null;
  energy: { free: number; paid: number; sub: number; total: number };
  createdAt: string;
};

export type RebindResult = {
  ok: true;
  userId: string;
  handle: string;
  oldPhoneE164: string | null;
  newPhoneE164: string;
  phoneVerified: true;
  progressPreserved: true;
  supabaseUpdated: boolean;
  auditId: string;
  energy: SupportLookup["energy"];
  tribeId: string | null;
};

export type RebindError = {
  ok: false;
  status: number;
  error: string;
  note?: string;
};

function supportOpsKey(): string | null {
  const key = process.env.SUPPORT_OPS_KEY?.trim();
  return key && key.length >= 16 ? key : null;
}

/** Season 0 ops: Bearer SUPPORT_OPS_KEY (not player sessions). */
export function supportOpsConfigured(): boolean {
  return Boolean(supportOpsKey());
}

export function requireSupportOps(req: FastifyRequest): boolean {
  const expected = supportOpsKey();
  if (!expected) return false;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (token.length !== expected.length) return false;
  // Constant-time-ish compare for short ops keys.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function toLookup(user: UserRow): SupportLookup {
  const free = Number(user.free_energy);
  const paid = Number(user.paid_energy);
  const sub = Number(user.sub_energy);
  const phone = user.phone_e164;
  return {
    id: user.id,
    handle: user.handle,
    phoneE164: phone,
    phoneLast4: phone && phone.length >= 4 ? phone.slice(-4) : null,
    phoneVerified: Boolean(user.phone_verified),
    tribeId: user.tribe_id,
    supabaseUserId: user.supabase_user_id,
    energy: { free, paid, sub, total: free + paid + sub },
    createdAt: user.created_at,
  };
}

export async function lookupSupportUser(
  db: Queryable,
  opts: { userId?: string; phone?: string; handle?: string },
): Promise<SupportLookup | null> {
  let user: UserRow | undefined;
  if (opts.userId) {
    user = await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]);
  } else if (opts.phone) {
    const e164 = normalizeTrPhone(opts.phone);
    if (!e164) return null;
    user = await one<UserRow>(db, `SELECT * FROM users WHERE phone_e164 = $1`, [e164]);
  } else if (opts.handle) {
    user = await one<UserRow>(db, `SELECT * FROM users WHERE handle = $1`, [opts.handle]);
  }
  return user ? toLookup(user) : null;
}

async function updateSupabasePhone(
  supabaseUserId: string,
  newPhoneE164: string,
): Promise<{ updated: boolean; error?: string }> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return { updated: false, error: "supabase_service_role_not_configured" };
  }

  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${supabaseUserId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: newPhoneE164,
        phone_confirm: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        updated: false,
        error: `supabase_admin_update_failed:${res.status}:${body.slice(0, 200)}`,
      };
    }
    return { updated: true };
  } catch (err) {
    return {
      updated: false,
      error: err instanceof Error ? err.message : "supabase_admin_update_error",
    };
  }
}

/**
 * Support-assisted lost-SIM rebind: swap phone on the same user row.
 * Never deletes the account — tribe, energy buckets, and support_ledger stay intact.
 */
export async function rebindPhone(
  db: Db,
  opts: {
    userId: string;
    newPhone: string;
    reason: string;
    actor: string;
    ticketId?: string;
    /** When true (default), attempt Supabase Admin phone update if linked. */
    syncSupabase?: boolean;
  },
): Promise<RebindResult | RebindError> {
  const newPhoneE164 = normalizeTrPhone(opts.newPhone);
  if (!newPhoneE164) {
    return { ok: false, status: 400, error: "invalid_tr_phone" };
  }
  const reason = opts.reason.trim();
  if (!reason) {
    return { ok: false, status: 400, error: "reason_required" };
  }
  const actor = opts.actor.trim();
  if (!actor) {
    return { ok: false, status: 400, error: "actor_required" };
  }

  const existing = await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]);
  if (!existing) {
    return { ok: false, status: 404, error: "user_not_found" };
  }

  if (existing.phone_e164 === newPhoneE164) {
    return {
      ok: false,
      status: 400,
      error: "phone_unchanged",
      note: "New phone matches the number already on this account",
    };
  }

  const taken = await one<{ id: string; handle: string }>(
    db,
    `SELECT id, handle FROM users WHERE phone_e164 = $1 AND id != $2`,
    [newPhoneE164, opts.userId],
  );
  if (taken) {
    return {
      ok: false,
      status: 409,
      error: "phone_taken",
      note: `New phone already bound to another account (${taken.handle}). Merge tooling is not Season 0 — refuse rebind.`,
    };
  }

  let supabaseUpdated = false;
  let supabaseNote: string | undefined;
  const shouldSync = opts.syncSupabase !== false;

  if (shouldSync && existing.supabase_user_id) {
    const sync = await updateSupabasePhone(existing.supabase_user_id, newPhoneE164);
    supabaseUpdated = sync.updated;
    supabaseNote = sync.error;
    // Soft-fail: local rebind still proceeds so ops can finish access restore;
    // document follow-up if Supabase Admin update failed.
    if (!sync.updated) {
      console.warn(
        `[support-rebind] Supabase phone update skipped/failed for ${existing.id}: ${sync.error}`,
      );
    }
  }

  const auditId = nanoid();
  const oldPhone = existing.phone_e164;

  await withTransaction(db, async (client) => {
    await client.query(
      `UPDATE users
         SET phone_e164 = $1,
             phone_verified = TRUE
       WHERE id = $2`,
      [newPhoneE164, opts.userId],
    );
    // Clear any stale OTP rows for both numbers so the freed old SIM cannot reuse a code.
    await client.query(`DELETE FROM otp_codes WHERE phone_e164 = ANY($1::text[])`, [
      [oldPhone, newPhoneE164].filter(Boolean),
    ]);
    await client.query(
      `INSERT INTO support_audit_log (
         id, action, actor, user_id, old_phone_e164, new_phone_e164,
         reason, ticket_id, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        auditId,
        "phone_rebind",
        actor,
        opts.userId,
        oldPhone,
        newPhoneE164,
        reason,
        opts.ticketId ?? null,
        JSON.stringify({
          progressPreserved: true,
          supabaseUserId: existing.supabase_user_id,
          supabaseUpdated,
          supabaseNote: supabaseNote ?? null,
          energySnapshot: {
            free: Number(existing.free_energy),
            paid: Number(existing.paid_energy),
            sub: Number(existing.sub_energy),
          },
          tribeId: existing.tribe_id,
          handle: existing.handle,
        }),
      ],
    );
  });

  const refreshed = (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]))!;
  const lookup = toLookup(refreshed);

  return {
    ok: true,
    userId: refreshed.id,
    handle: refreshed.handle,
    oldPhoneE164: oldPhone,
    newPhoneE164,
    phoneVerified: true,
    progressPreserved: true,
    supabaseUpdated,
    auditId,
    energy: lookup.energy,
    tribeId: refreshed.tribe_id,
  };
}
