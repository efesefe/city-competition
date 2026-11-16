import { getFreeGrant, many, one, type Queryable } from "./db.js";
import { TR_TIMEZONE, trDateString } from "./trTime.js";

export { TR_TIMEZONE, trDateString };
export const FREE_DAILY_GRANT_DEFAULT = 100;

export type GrantSkipReason = "user_not_found" | "phone_unverified" | "already_granted";

export type GrantResult =
  | { granted: true; amount: number; date: string; expiredPreviousFree: boolean }
  | { granted: false; reason: GrantSkipReason };

/**
 * Expire unused free energy and grant today's free bucket.
 *
 * - Free bucket is **replaced** (no bank across TR days).
 * - Paid / sub buckets are untouched.
 * - At most one grant per `YYYY-MM-DD` Europe/Istanbul (`free_grant_date`).
 * - Phone must be verified (lazy claim / auto paths).
 */
export async function maybeGrantDailyEnergy(
  db: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<GrantResult> {
  const user = await one<{
    free_grant_date: string | null;
    phone_verified: boolean;
    free_energy: number;
  }>(db, `SELECT free_grant_date, phone_verified, free_energy FROM users WHERE id = $1`, [
    userId,
  ]);
  if (!user) return { granted: false, reason: "user_not_found" };
  if (!user.phone_verified) return { granted: false, reason: "phone_unverified" };

  const today = trDateString(now);
  if (user.free_grant_date === today) return { granted: false, reason: "already_granted" };

  const grant = await getFreeGrant(db);
  const expiredPreviousFree = Number(user.free_energy) > 0;
  await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
    grant,
    today,
    userId,
  ]);
  return { granted: true, amount: grant, date: today, expiredPreviousFree };
}

/**
 * Dev/sim: force expire-then-grant for one user on the current TR date,
 * even if already granted today. Does not wait for midnight.
 */
export async function forceGrantDaily(
  db: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<{ granted: true; amount: number; date: string; expiredPreviousFree: boolean }> {
  const user = await one<{ free_energy: number }>(
    db,
    `SELECT free_energy FROM users WHERE id = $1`,
    [userId],
  );
  const grant = await getFreeGrant(db);
  const today = trDateString(now);
  const expiredPreviousFree = Number(user?.free_energy ?? 0) > 0;
  await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
    grant,
    today,
    userId,
  ]);
  return { granted: true, amount: grant, date: today, expiredPreviousFree };
}

export type DailyGrantJobResult = {
  timezone: typeof TR_TIMEZONE;
  date: string;
  amount: number;
  scanned: number;
  granted: number;
  skippedAlreadyGranted: number;
  force: boolean;
};

/**
 * Batch expire-then-grant for all phone-verified users on the given TR date.
 *
 * Idempotent: users with `free_grant_date = today` are skipped unless `force`.
 * Unused free energy is wiped by the SET (no bank). Sub daily +50 is a later leaf.
 */
export async function runDailyFreeEnergyJob(
  db: Queryable,
  opts: { now?: Date; force?: boolean } = {},
): Promise<DailyGrantJobResult> {
  const now = opts.now ?? new Date();
  const force = Boolean(opts.force);
  const today = trDateString(now);
  const amount = await getFreeGrant(db);

  const eligible = await many<{ id: string; free_grant_date: string | null }>(
    db,
    `SELECT id, free_grant_date FROM users WHERE phone_verified = TRUE`,
  );

  let granted = 0;
  let skippedAlreadyGranted = 0;

  for (const row of eligible) {
    if (!force && row.free_grant_date === today) {
      skippedAlreadyGranted += 1;
      continue;
    }
    await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
      amount,
      today,
      row.id,
    ]);
    granted += 1;
  }

  return {
    timezone: TR_TIMEZONE,
    date: today,
    amount,
    scanned: eligible.length,
    granted,
    skippedAlreadyGranted,
    force,
  };
}

/** Whether the grant-job / grant-sim HTTP triggers are open (dev default). */
export function energyGrantTriggersEnabled(): boolean {
  if (process.env.ALLOW_ENERGY_GRANT_TRIGGERS === "false") return false;
  if (process.env.ALLOW_ENERGY_GRANT_TRIGGERS === "true") return true;
  return process.env.NODE_ENV !== "production";
}
