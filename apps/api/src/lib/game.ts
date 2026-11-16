import { nanoid } from "nanoid";
import {
  getActionCost,
  getFreeGrant,
  many,
  one,
  trDateString,
  withTransaction,
  type Db,
  type Queryable,
} from "./db.js";
import { publish, type OwnershipDigestCity } from "./bus.js";
import { noteFlip, noteRivalAttack } from "./coalesce.js";
import { TEAM_BY_ID } from "../data/teams.js";

export async function ownershipDigest(db: Queryable): Promise<OwnershipDigestCity[]> {
  return many<OwnershipDigestCity>(
    db,
    `SELECT c.plate, c.owner_team_id AS "ownerTeamId", t.public_alias AS "ownerAlias",
            t.primary_color AS "ownerColor"
     FROM cities c
     LEFT JOIN teams t ON t.internal_id = c.owner_team_id
     ORDER BY c.plate`,
  );
}

export async function citySheet(db: Queryable, plate: string) {
  const city = await one<{
    plate: string;
    nameTr: string;
    ownerTeamId: string | null;
    ownerAlias: string | null;
    ownerColor: string | null;
  }>(
    db,
    `SELECT c.plate, c.name_tr AS "nameTr", c.owner_team_id AS "ownerTeamId",
            t.public_alias AS "ownerAlias", t.primary_color AS "ownerColor"
     FROM cities c
     LEFT JOIN teams t ON t.internal_id = c.owner_team_id
     WHERE c.plate = $1`,
    [plate],
  );
  if (!city) return null;

  const support = await many<{ teamId: string; alias: string; color: string; support: number }>(
    db,
    `SELECT cs.team_id AS "teamId", t.public_alias AS alias, t.primary_color AS color, cs.support
     FROM city_support cs
     JOIN teams t ON t.internal_id = cs.team_id
     WHERE cs.city_plate = $1
     ORDER BY cs.support DESC`,
    [plate],
  );

  const contributors = await many<{ handle: string; support: number }>(
    db,
    `SELECT u.handle, SUM(sl.support_credited) AS support
     FROM support_ledger sl
     JOIN users u ON u.id = sl.user_id
     WHERE sl.city_plate = $1
     GROUP BY u.id, u.handle
     ORDER BY support DESC
     LIMIT 5`,
    [plate],
  );

  const lead = Number(support[0]?.support ?? 0);
  const second = Number(support[1]?.support ?? 0);

  return {
    ...city,
    support: support.map((s) => ({ ...s, support: Number(s.support) })),
    leadMargin: lead - second,
    topContributors: contributors.map((c) => ({
      handle: c.handle,
      support: Number(c.support),
    })),
  };
}

export async function scoreboard(db: Queryable) {
  const rows = await many<{
    teamId: string;
    alias: string;
    color: string;
    citiesOwned: string;
  }>(
    db,
    `SELECT t.internal_id AS "teamId", t.public_alias AS alias, t.primary_color AS color,
            COUNT(c.plate)::text AS "citiesOwned"
     FROM teams t
     LEFT JOIN cities c ON c.owner_team_id = t.internal_id
     GROUP BY t.internal_id
     ORDER BY COUNT(c.plate) DESC, t.public_alias ASC`,
  );
  return rows.map((r) => ({
    teamId: r.teamId,
    alias: r.alias,
    color: r.color,
    citiesOwned: Number(r.citiesOwned),
  }));
}

function totalEnergy(user: {
  free_energy: number;
  paid_energy: number;
  sub_energy: number;
}) {
  return Number(user.free_energy) + Number(user.paid_energy) + Number(user.sub_energy);
}

/** Debit free → sub → paid (free expires daily so spend it first). */
async function debitEnergy(
  db: Queryable,
  userId: string,
  amount: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await one<{
    free_energy: number;
    paid_energy: number;
    sub_energy: number;
  }>(db, `SELECT free_energy, paid_energy, sub_energy FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false, reason: "user_not_found" };
  if (totalEnergy(user) < amount) return { ok: false, reason: "insufficient_energy" };

  let remain = amount;
  let free = Number(user.free_energy);
  let sub = Number(user.sub_energy);
  let paid = Number(user.paid_energy);

  const takeFree = Math.min(free, remain);
  free -= takeFree;
  remain -= takeFree;
  const takeSub = Math.min(sub, remain);
  sub -= takeSub;
  remain -= takeSub;
  paid -= remain;

  await db.query(
    `UPDATE users SET free_energy = $1, sub_energy = $2, paid_energy = $3 WHERE id = $4`,
    [free, sub, paid, userId],
  );
  return { ok: true };
}

export async function maybeGrantDailyEnergy(db: Queryable, userId: string) {
  const user = await one<{ free_grant_date: string | null; phone_verified: boolean }>(
    db,
    `SELECT free_grant_date, phone_verified FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) return { granted: false, reason: "user_not_found" as const };
  if (!user.phone_verified) return { granted: false, reason: "phone_unverified" as const };
  const today = trDateString();
  if (user.free_grant_date === today) return { granted: false, reason: "already_granted" as const };

  const grant = await getFreeGrant(db);
  // Expire previous free bucket, then grant today's.
  await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
    grant,
    today,
    userId,
  ]);
  return { granted: true, amount: grant, date: today };
}

export async function forceGrantDaily(db: Queryable, userId: string) {
  const grant = await getFreeGrant(db);
  const today = trDateString();
  await db.query(`UPDATE users SET free_energy = $1, free_grant_date = $2 WHERE id = $3`, [
    grant,
    today,
    userId,
  ]);
  return { granted: true, amount: grant, date: today };
}

export async function spendEnergy(
  db: Db,
  opts: {
    userId: string;
    plate: string;
    amount?: number;
    idempotencyKey: string;
    confirmed: boolean;
  },
) {
  if (!opts.confirmed) {
    return { ok: false as const, status: 400, error: "confirm_required" };
  }

  const existing = await one<{ id: string }>(
    db,
    `SELECT id FROM support_ledger WHERE idempotency_key = $1`,
    [opts.idempotencyKey],
  );
  if (existing) {
    return {
      ok: true as const,
      idempotentReplay: true,
      sheet: await citySheet(db, opts.plate),
      digest: await ownershipDigest(db),
    };
  }

  const user = await one<{
    phone_verified: boolean;
    tribe_id: string | null;
  }>(db, `SELECT phone_verified, tribe_id FROM users WHERE id = $1`, [opts.userId]);

  if (!user) return { ok: false as const, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false as const, status: 403, error: "phone_unverified" };
  if (!user.tribe_id) return { ok: false as const, status: 403, error: "tribe_required" };

  const cost = opts.amount ?? (await getActionCost(db));
  if (cost < 10 || cost > 20) return { ok: false as const, status: 400, error: "cost_out_of_band" };

  const city = await one<{ plate: string; owner_team_id: string | null }>(
    db,
    `SELECT plate, owner_team_id FROM cities WHERE plate = $1`,
    [opts.plate],
  );
  if (!city) return { ok: false as const, status: 404, error: "city_not_found" };

  const fromOwner = city.owner_team_id;
  const tribeId = user.tribe_id;

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; idempotentReplay: true }
    | { ok: true; flipped: boolean; toTeamId: string; fromOwner: string | null };

  let result: TxResult;
  try {
    result = await withTransaction(db, async (client) => {
      // Re-check idempotency inside the transaction (race-safe).
      const raced = await one<{ id: string }>(
        client,
        `SELECT id FROM support_ledger WHERE idempotency_key = $1`,
        [opts.idempotencyKey],
      );
      if (raced) return { ok: true as const, idempotentReplay: true as const };

      const debit = await debitEnergy(client, opts.userId, cost);
      if (!debit.ok) return { ok: false as const, status: 400, error: debit.reason };

      // Boost snapshot: personal × team = 1.0 for slice (no shop/events yet)
      const supportCredited = cost;

      const supportRow = await one<{ support: number }>(
        client,
        `SELECT support FROM city_support WHERE city_plate = $1 AND team_id = $2`,
        [opts.plate, tribeId],
      );
      if (supportRow) {
        await client.query(
          `UPDATE city_support SET support = support + $1 WHERE city_plate = $2 AND team_id = $3`,
          [supportCredited, opts.plate, tribeId],
        );
      } else {
        await client.query(
          `INSERT INTO city_support (city_plate, team_id, support) VALUES ($1, $2, $3)`,
          [opts.plate, tribeId, supportCredited],
        );
      }

      const leaders = await one<{ team_id: string; support: number }>(
        client,
        `SELECT team_id, support FROM city_support WHERE city_plate = $1 ORDER BY support DESC LIMIT 1`,
        [opts.plate],
      );
      if (!leaders) return { ok: false as const, status: 500, error: "support_missing" };

      let flipped = false;
      if (leaders.team_id !== fromOwner) {
        await client.query(`UPDATE cities SET owner_team_id = $1 WHERE plate = $2`, [
          leaders.team_id,
          opts.plate,
        ]);
        flipped = true;
      }

      const ledgerId = nanoid();
      await client.query(
        `INSERT INTO support_ledger
          (id, user_id, city_plate, team_id, energy_spent, support_credited, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ledgerId,
          opts.userId,
          opts.plate,
          tribeId,
          cost,
          supportCredited,
          opts.idempotencyKey,
          new Date().toISOString(),
        ],
      );

      return { ok: true as const, flipped, toTeamId: leaders.team_id, fromOwner };
    });
  } catch (err: unknown) {
    // Unique violation on idempotency_key → treat as replay.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return {
        ok: true as const,
        idempotentReplay: true,
        sheet: await citySheet(db, opts.plate),
        digest: await ownershipDigest(db),
      };
    }
    throw err;
  }

  if (!result.ok) return result;
  if ("idempotentReplay" in result) {
    return {
      ok: true as const,
      idempotentReplay: true,
      sheet: await citySheet(db, opts.plate),
      digest: await ownershipDigest(db),
    };
  }

  const applied = result;
  const team = TEAM_BY_ID.get(applied.toTeamId);
  const toAlias = team?.publicAlias ?? applied.toTeamId;
  const toColor = team?.primary ?? "#888888";

  // Alert coalesce hooks (5-min window) — push delivery is a later leaf.
  if (applied.fromOwner && applied.fromOwner !== tribeId) {
    await noteRivalAttack({
      plate: opts.plate,
      defendingTribeId: applied.fromOwner,
      spenderTribeId: tribeId,
      spenderAlias: TEAM_BY_ID.get(tribeId)?.publicAlias ?? tribeId,
    });
  }

  if (applied.flipped) {
    await publish({
      type: "flip",
      plate: opts.plate,
      fromTeamId: applied.fromOwner,
      toTeamId: applied.toTeamId,
      toAlias,
      toColor,
    });
    await noteFlip({
      plate: opts.plate,
      fromTeamId: applied.fromOwner,
      toTeamId: applied.toTeamId,
      toAlias,
    });
  }

  const digest = await ownershipDigest(db);
  await publish({ type: "digest", cities: digest });

  const refreshed = await one(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]);

  return {
    ok: true as const,
    flipped: applied.flipped,
    energySpent: cost,
    supportCredited: cost,
    sheet: await citySheet(db, opts.plate),
    digest,
    user: refreshed,
  };
}

export async function pickTribe(db: Queryable, userId: string, tribeId: string) {
  const user = await one<{
    phone_verified: boolean;
    tribe_id: string | null;
    tribe_switched_at: string | null;
  }>(db, `SELECT phone_verified, tribe_id, tribe_switched_at FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false as const, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false as const, status: 403, error: "phone_unverified" };

  const team = await one(db, `SELECT internal_id FROM teams WHERE internal_id = $1`, [tribeId]);
  if (!team) return { ok: false as const, status: 404, error: "tribe_not_found" };

  if (user.tribe_id && user.tribe_id !== tribeId) {
    if (user.tribe_switched_at) {
      const last = new Date(user.tribe_switched_at).getTime();
      if (Date.now() - last < 24 * 60 * 60 * 1000) {
        return { ok: false as const, status: 429, error: "switch_cooldown" };
      }
    }
    await db.query(`UPDATE users SET tribe_id = $1, tribe_switched_at = $2 WHERE id = $3`, [
      tribeId,
      new Date().toISOString(),
      userId,
    ]);
  } else if (!user.tribe_id) {
    await db.query(`UPDATE users SET tribe_id = $1 WHERE id = $2`, [tribeId, userId]);
  }

  return { ok: true as const, tribeId };
}
