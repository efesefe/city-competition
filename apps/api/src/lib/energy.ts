import { getFreeGrant, getSubDailyBonus, many, one, type Queryable } from "./db.js";
import { TR_TIMEZONE, trDateString } from "./trTime.js";

export { TR_TIMEZONE, trDateString };
export const FREE_DAILY_GRANT_DEFAULT = 100;
export const SUB_DAILY_BONUS_DEFAULT = 50;

export type GrantSkipReason = "user_not_found" | "phone_unverified" | "already_granted";

export type GrantResult =
  | {
      granted: true;
      amount: number;
      date: string;
      expiredPreviousFree: boolean;
      subBonus: SubBonusResult;
    }
  | { granted: false; reason: GrantSkipReason; subBonus: SubBonusResult };

export type SubBonusResult =
  | { granted: true; amount: number; date: string; expiredPreviousSub: boolean }
  | { granted: false; reason: "not_subscriber" | "already_granted" | "user_not_found" };

/**
 * Expire unused free energy and grant today's free bucket.
 * For active subscribers, also expire-then-grant the +50 sub daily bonus
 * on the same Europe/Istanbul clock.
 *
 * - Free bucket is **replaced** (no bank across TR days).
 * - Sub daily bonus bucket is **replaced** when the player is an active sub.
 * - Paid bucket is untouched.
 * - At most one free grant / one sub bonus per TR date.
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
    sub_energy: number;
    sub_active: boolean;
    sub_grant_date: string | null;
  }>(
    db,
    `SELECT free_grant_date, phone_verified, free_energy, sub_energy, sub_active, sub_grant_date
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) {
    return {
      granted: false,
      reason: "user_not_found",
      subBonus: { granted: false, reason: "user_not_found" },
    };
  }
  if (!user.phone_verified) {
    return {
      granted: false,
      reason: "phone_unverified",
      subBonus: { granted: false, reason: "not_subscriber" },
    };
  }

  const today = trDateString(now);
  const subBonus = await applySubDailyBonus(db, {
    id: userId,
    sub_active: Boolean(user.sub_active),
    sub_energy: Number(user.sub_energy),
    sub_grant_date: user.sub_grant_date,
    today,
    force: false,
  });

  if (user.free_grant_date === today) {
    return { granted: false, reason: "already_granted", subBonus };
  }

  const grant = await getFreeGrant(db);
  const expiredPreviousFree = Number(user.free_energy) > 0;
  await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
    grant,
    today,
    userId,
  ]);
  return { granted: true, amount: grant, date: today, expiredPreviousFree, subBonus };
}

/**
 * Dev/sim: force expire-then-grant free (+ sub bonus if entitled) for one user
 * on the current TR date, even if already granted today. Does not wait for midnight.
 */
export async function forceGrantDaily(
  db: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<{
  granted: true;
  amount: number;
  date: string;
  expiredPreviousFree: boolean;
  subBonus: SubBonusResult;
}> {
  const user = await one<{
    free_energy: number;
    sub_energy: number;
    sub_active: boolean;
    sub_grant_date: string | null;
  }>(
    db,
    `SELECT free_energy, sub_energy, sub_active, sub_grant_date FROM users WHERE id = $1`,
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
  const subBonus = await applySubDailyBonus(db, {
    id: userId,
    sub_active: Boolean(user?.sub_active),
    sub_energy: Number(user?.sub_energy ?? 0),
    sub_grant_date: user?.sub_grant_date ?? null,
    today,
    force: true,
  });
  return { granted: true, amount: grant, date: today, expiredPreviousFree, subBonus };
}

export type DailyGrantJobResult = {
  timezone: typeof TR_TIMEZONE;
  date: string;
  freeAmount: number;
  subBonusAmount: number;
  /** @deprecated use freeAmount — kept for CC-30 clients */
  amount: number;
  scanned: number;
  granted: number;
  skippedAlreadyGranted: number;
  subBonusGranted: number;
  subBonusSkipped: number;
  force: boolean;
};

type EligibleRow = {
  id: string;
  free_grant_date: string | null;
  free_energy: number;
  sub_energy: number;
  sub_active: boolean;
  sub_grant_date: string | null;
};

/**
 * TR midnight batch: expire-then-grant free 100 for all phone-verified users,
 * and +50 sub daily bonus for active subscribers on the same clock.
 *
 * Idempotent: users with matching grant dates are skipped unless `force`.
 * Unused free / sub-daily energy is wiped by SET (no bank). Paid untouched.
 */
export async function runDailyFreeEnergyJob(
  db: Queryable,
  opts: { now?: Date; force?: boolean } = {},
): Promise<DailyGrantJobResult> {
  const now = opts.now ?? new Date();
  const force = Boolean(opts.force);
  const today = trDateString(now);
  const freeAmount = await getFreeGrant(db);
  const subBonusAmount = await getSubDailyBonus(db);

  const eligible = await many<EligibleRow>(
    db,
    `SELECT id, free_grant_date, free_energy, sub_energy, sub_active, sub_grant_date
     FROM users WHERE phone_verified = TRUE`,
  );

  let granted = 0;
  let skippedAlreadyGranted = 0;
  let subBonusGranted = 0;
  let subBonusSkipped = 0;

  for (const row of eligible) {
    if (!force && row.free_grant_date === today) {
      skippedAlreadyGranted += 1;
    } else {
      await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
        freeAmount,
        today,
        row.id,
      ]);
      granted += 1;
    }

    const sub = await applySubDailyBonus(db, {
      id: row.id,
      sub_active: Boolean(row.sub_active),
      sub_energy: Number(row.sub_energy),
      sub_grant_date: row.sub_grant_date,
      today,
      force,
      amount: subBonusAmount,
    });
    if (sub.granted) subBonusGranted += 1;
    else subBonusSkipped += 1;
  }

  return {
    timezone: TR_TIMEZONE,
    date: today,
    freeAmount,
    subBonusAmount,
    amount: freeAmount,
    scanned: eligible.length,
    granted,
    skippedAlreadyGranted,
    subBonusGranted,
    subBonusSkipped,
    force,
  };
}

/** Alias — same TR midnight free + sub-bonus batch. */
export const runTrMidnightEnergyJob = runDailyFreeEnergyJob;

/** Ops/dev: set subscription entitlement without payments wiring. */
export async function setSubEntitlement(
  db: Queryable,
  userId: string,
  active: boolean,
): Promise<{ ok: true; userId: string; subActive: boolean } | { ok: false; reason: "user_not_found" }> {
  const user = await one<{ id: string }>(db, `SELECT id FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false, reason: "user_not_found" };
  await db.query(`UPDATE users SET sub_active = $1 WHERE id = $2`, [active, userId]);
  return { ok: true, userId, subActive: active };
}

async function applySubDailyBonus(
  db: Queryable,
  opts: {
    id: string;
    sub_active: boolean;
    sub_energy: number;
    sub_grant_date: string | null;
    today: string;
    force: boolean;
    amount?: number;
  },
): Promise<SubBonusResult> {
  if (!opts.sub_active) return { granted: false, reason: "not_subscriber" };
  if (!opts.force && opts.sub_grant_date === opts.today) {
    return { granted: false, reason: "already_granted" };
  }
  const amount = opts.amount ?? (await getSubDailyBonus(db));
  const expiredPreviousSub = Number(opts.sub_energy) > 0;
  await db.query(`UPDATE users SET sub_energy = $1, sub_grant_date = $2 WHERE id = $3`, [
    amount,
    opts.today,
    opts.id,
  ]);
  return { granted: true, amount, date: opts.today, expiredPreviousSub };
}

/** Whether the grant-job / grant-sim / sub-entitle HTTP triggers are open (dev default). */
export function energyGrantTriggersEnabled(): boolean {
  if (process.env.ALLOW_ENERGY_GRANT_TRIGGERS === "false") return false;
  if (process.env.ALLOW_ENERGY_GRANT_TRIGGERS === "true") return true;
  return process.env.NODE_ENV !== "production";
}
