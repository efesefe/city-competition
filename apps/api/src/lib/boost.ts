import { nanoid } from "nanoid";
import { one, type Queryable } from "./db.js";

/** Economy lock: personal +50% / 1h; match-day team +25%. Multiplicative. */
export const PERSONAL_BOOST_MULT = 1.5;
export const TEAM_BOOST_MULT = 1.25;
export const PERSONAL_BOOST_DURATION_MS = 60 * 60 * 1000;

/** Personal × team boost multipliers at spend time. */
export type BoostSnapshot = {
  personalBoostPct: number;
  teamBoostPct: number;
  personalExpiresAt: string | null;
  teamWindowEndsAt: string | null;
};

export const NEUTRAL_BOOST: BoostSnapshot = {
  personalBoostPct: 1,
  teamBoostPct: 1,
  personalExpiresAt: null,
  teamWindowEndsAt: null,
};

export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Pure: personal window is active only while expiresAt is strictly in the future. */
export function isPersonalBoostActive(
  expiresAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const iso = toIso(expiresAt);
  if (!iso) return false;
  return new Date(iso).getTime() > nowMs;
}

/** Pure: support credited = energy × personal × team (3 dp). */
export function creditedSupport(energySpent: number, boost: BoostSnapshot): number {
  return Math.round(energySpent * boost.personalBoostPct * boost.teamBoostPct * 1000) / 1000;
}

export function personalExpiryFromNow(
  nowMs: number = Date.now(),
  durationMs: number = PERSONAL_BOOST_DURATION_MS,
): string {
  return new Date(nowMs + durationMs).toISOString();
}

/** Live personal × team boost for display + spend snapshot. */
export async function boostSnapshotForUser(
  db: Queryable,
  opts: { userId: string; tribeId?: string | null; nowMs?: number },
): Promise<BoostSnapshot> {
  const user = await one<{ personal_boost_expires_at: string | Date | null; tribe_id: string | null }>(
    db,
    `SELECT personal_boost_expires_at, tribe_id FROM users WHERE id = $1`,
    [opts.userId],
  );
  if (!user) return { ...NEUTRAL_BOOST };

  const now = opts.nowMs ?? Date.now();
  const personalIso = toIso(user.personal_boost_expires_at);
  const personalActive = isPersonalBoostActive(personalIso, now);

  const tribeId = opts.tribeId ?? user.tribe_id;
  let teamBoostPct = 1;
  let teamWindowEndsAt: string | null = null;
  if (tribeId) {
    const win = await one<{ boost_pct: number; ends_at: string | Date }>(
      db,
      `SELECT boost_pct, ends_at FROM team_boost_windows
       WHERE team_id = $1
         AND canceled_at IS NULL
         AND starts_at <= NOW() AND ends_at > NOW()
         AND boost_pct > 1
       ORDER BY boost_pct DESC, ends_at DESC
       LIMIT 1`,
      [tribeId],
    );
    if (win) {
      teamBoostPct = Number(win.boost_pct) || TEAM_BOOST_MULT;
      teamWindowEndsAt = toIso(win.ends_at);
    }
  }

  return {
    personalBoostPct: personalActive ? PERSONAL_BOOST_MULT : 1,
    teamBoostPct,
    personalExpiresAt: personalActive ? personalIso : null,
    teamWindowEndsAt,
  };
}

/** Payments stub: activate personal +50% for 1 hour without charging. Refreshes window. */
export async function activatePersonalBoostStub(
  db: Queryable,
  userId: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true; boost: BoostSnapshot; stub: true } | { ok: false; status: number; error: string }> {
  const user = await one<{ phone_verified: boolean; tribe_id: string | null }>(
    db,
    `SELECT phone_verified, tribe_id FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false, status: 403, error: "phone_unverified" };

  const expires = personalExpiryFromNow(nowMs);
  await db.query(`UPDATE users SET personal_boost_expires_at = $1 WHERE id = $2`, [
    expires,
    userId,
  ]);
  const boost = await boostSnapshotForUser(db, { userId, tribeId: user.tribe_id, nowMs });
  return { ok: true, boost, stub: true };
}

/** Dev/sim: open a +25% team boost window for the caller's tribe (match-day leaf later). */
export async function activateTeamBoostSim(
  db: Queryable,
  userId: string,
  durationMs = 2 * 60 * 60 * 1000,
): Promise<
  | { ok: true; boost: BoostSnapshot; simulated: true; windowId: string }
  | { ok: false; status: number; error: string }
> {
  const user = await one<{ phone_verified: boolean; tribe_id: string | null }>(
    db,
    `SELECT phone_verified, tribe_id FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false, status: 403, error: "phone_unverified" };
  if (!user.tribe_id) return { ok: false, status: 403, error: "tribe_required" };

  const id = nanoid();
  const starts = new Date().toISOString();
  const ends = new Date(Date.now() + durationMs).toISOString();
  await db.query(
    `INSERT INTO team_boost_windows (id, team_id, boost_pct, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, user.tribe_id, TEAM_BOOST_MULT, starts, ends],
  );
  const boost = await boostSnapshotForUser(db, { userId, tribeId: user.tribe_id });
  return { ok: true, boost, simulated: true, windowId: id };
}
