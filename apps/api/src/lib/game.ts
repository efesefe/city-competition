import { nanoid } from "nanoid";
import type { Db } from "./db.js";
import { getActionCost, getFreeGrant, trDateString } from "./db.js";
import { publish, type OwnershipDigestCity } from "./bus.js";
import { TEAM_BY_ID } from "../data/teams.js";

export function ownershipDigest(db: Db): OwnershipDigestCity[] {
  const rows = db
    .prepare(
      `SELECT c.plate, c.owner_team_id AS ownerTeamId, t.public_alias AS ownerAlias, t.primary_color AS ownerColor
       FROM cities c
       LEFT JOIN teams t ON t.internal_id = c.owner_team_id
       ORDER BY c.plate`,
    )
    .all() as OwnershipDigestCity[];
  return rows;
}

export function citySheet(db: Db, plate: string) {
  const city = db
    .prepare(
      `SELECT c.plate, c.name_tr AS nameTr, c.owner_team_id AS ownerTeamId,
              t.public_alias AS ownerAlias, t.primary_color AS ownerColor
       FROM cities c
       LEFT JOIN teams t ON t.internal_id = c.owner_team_id
       WHERE c.plate = ?`,
    )
    .get(plate) as
    | {
        plate: string;
        nameTr: string;
        ownerTeamId: string | null;
        ownerAlias: string | null;
        ownerColor: string | null;
      }
    | undefined;
  if (!city) return null;

  const support = db
    .prepare(
      `SELECT cs.team_id AS teamId, t.public_alias AS alias, t.primary_color AS color, cs.support
       FROM city_support cs
       JOIN teams t ON t.internal_id = cs.team_id
       WHERE cs.city_plate = ?
       ORDER BY cs.support DESC`,
    )
    .all(plate) as { teamId: string; alias: string; color: string; support: number }[];

  const contributors = db
    .prepare(
      `SELECT u.handle, SUM(sl.support_credited) AS support
       FROM support_ledger sl
       JOIN users u ON u.id = sl.user_id
       WHERE sl.city_plate = ?
       GROUP BY u.id
       ORDER BY support DESC
       LIMIT 5`,
    )
    .all(plate) as { handle: string; support: number }[];

  const lead = support[0]?.support ?? 0;
  const second = support[1]?.support ?? 0;

  return {
    ...city,
    support,
    leadMargin: lead - second,
    topContributors: contributors,
  };
}

export function scoreboard(db: Db) {
  return db
    .prepare(
      `SELECT t.internal_id AS teamId, t.public_alias AS alias, t.primary_color AS color,
              COUNT(c.plate) AS citiesOwned
       FROM teams t
       LEFT JOIN cities c ON c.owner_team_id = t.internal_id
       GROUP BY t.internal_id
       ORDER BY citiesOwned DESC, t.public_alias ASC`,
    )
    .all() as { teamId: string; alias: string; color: string; citiesOwned: number }[];
}

function totalEnergy(user: {
  free_energy: number;
  paid_energy: number;
  sub_energy: number;
}) {
  return user.free_energy + user.paid_energy + user.sub_energy;
}

/** Debit free → sub → paid (free expires daily so spend it first). */
function debitEnergy(
  db: Db,
  userId: string,
  amount: number,
): { ok: true } | { ok: false; reason: string } {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as {
    free_energy: number;
    paid_energy: number;
    sub_energy: number;
  };
  if (totalEnergy(user) < amount) return { ok: false, reason: "insufficient_energy" };

  let remain = amount;
  let free = user.free_energy;
  let sub = user.sub_energy;
  let paid = user.paid_energy;

  const takeFree = Math.min(free, remain);
  free -= takeFree;
  remain -= takeFree;
  const takeSub = Math.min(sub, remain);
  sub -= takeSub;
  remain -= takeSub;
  paid -= remain;

  db.prepare(
    `UPDATE users SET free_energy = ?, sub_energy = ?, paid_energy = ? WHERE id = ?`,
  ).run(free, sub, paid, userId);
  return { ok: true };
}

export function maybeGrantDailyEnergy(db: Db, userId: string) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as {
    free_grant_date: string | null;
    phone_verified: number;
  };
  if (!user.phone_verified) return { granted: false, reason: "phone_unverified" as const };
  const today = trDateString();
  if (user.free_grant_date === today) return { granted: false, reason: "already_granted" as const };

  const grant = getFreeGrant(db);
  // Expire previous free bucket, then grant today's.
  db.prepare(
    `UPDATE users SET free_energy = ?, free_grant_date = ? WHERE id = ?`,
  ).run(grant, today, userId);
  return { granted: true, amount: grant, date: today };
}

export function forceGrantDaily(db: Db, userId: string) {
  const grant = getFreeGrant(db);
  const today = trDateString();
  db.prepare(
    `UPDATE users SET free_energy = ?, free_grant_date = ? WHERE id = ?`,
  ).run(grant, today, userId);
  return { granted: true, amount: grant, date: today };
}

export function spendEnergy(
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

  const existing = db
    .prepare(`SELECT * FROM support_ledger WHERE idempotency_key = ?`)
    .get(opts.idempotencyKey) as { id: string } | undefined;
  if (existing) {
    return {
      ok: true as const,
      idempotentReplay: true,
      sheet: citySheet(db, opts.plate),
      digest: ownershipDigest(db),
    };
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(opts.userId) as {
    phone_verified: number;
    tribe_id: string | null;
    free_energy: number;
    paid_energy: number;
    sub_energy: number;
  };

  if (!user.phone_verified) return { ok: false as const, status: 403, error: "phone_unverified" };
  if (!user.tribe_id) return { ok: false as const, status: 403, error: "tribe_required" };

  const cost = opts.amount ?? getActionCost(db);
  if (cost < 10 || cost > 20) return { ok: false as const, status: 400, error: "cost_out_of_band" };

  const city = db.prepare(`SELECT * FROM cities WHERE plate = ?`).get(opts.plate) as
    | { plate: string; owner_team_id: string | null }
    | undefined;
  if (!city) return { ok: false as const, status: 404, error: "city_not_found" };

  const fromOwner = city.owner_team_id;

  const result = db.transaction(() => {
    const debit = debitEnergy(db, opts.userId, cost);
    if (!debit.ok) return { ok: false as const, status: 400, error: debit.reason };

    // Boost snapshot: personal × team = 1.0 for slice (no shop/events yet)
    const supportCredited = cost;

    const supportRow = db
      .prepare(`SELECT support FROM city_support WHERE city_plate = ? AND team_id = ?`)
      .get(opts.plate, user.tribe_id) as { support: number } | undefined;
    if (supportRow) {
      db.prepare(
        `UPDATE city_support SET support = support + ? WHERE city_plate = ? AND team_id = ?`,
      ).run(supportCredited, opts.plate, user.tribe_id);
    } else {
      db.prepare(
        `INSERT INTO city_support (city_plate, team_id, support) VALUES (?, ?, ?)`,
      ).run(opts.plate, user.tribe_id, supportCredited);
    }

    const leaders = db
      .prepare(
        `SELECT team_id, support FROM city_support WHERE city_plate = ? ORDER BY support DESC LIMIT 1`,
      )
      .get(opts.plate) as { team_id: string; support: number };

    let flipped = false;
    if (leaders.team_id !== fromOwner) {
      db.prepare(`UPDATE cities SET owner_team_id = ? WHERE plate = ?`).run(
        leaders.team_id,
        opts.plate,
      );
      flipped = true;
    }

    const ledgerId = nanoid();
    db.prepare(
      `INSERT INTO support_ledger
        (id, user_id, city_plate, team_id, energy_spent, support_credited, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ledgerId,
      opts.userId,
      opts.plate,
      user.tribe_id,
      cost,
      supportCredited,
      opts.idempotencyKey,
      new Date().toISOString(),
    );

    return { ok: true as const, flipped, toTeamId: leaders.team_id, fromOwner };
  })();

  if (!result.ok) return result;

  if (result.flipped) {
    const team = TEAM_BY_ID.get(result.toTeamId!);
    publish({
      type: "flip",
      plate: opts.plate,
      fromTeamId: result.fromOwner,
      toTeamId: result.toTeamId!,
      toAlias: team?.publicAlias ?? result.toTeamId!,
      toColor: team?.primary ?? "#888888",
    });
  }

  const digest = ownershipDigest(db);
  publish({ type: "digest", cities: digest });

  const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(opts.userId);

  return {
    ok: true as const,
    flipped: result.flipped,
    energySpent: cost,
    supportCredited: cost,
    sheet: citySheet(db, opts.plate),
    digest,
    user: refreshed,
  };
}

export function pickTribe(db: Db, userId: string, tribeId: string) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as {
    phone_verified: number;
    tribe_id: string | null;
    tribe_switched_at: string | null;
  };
  if (!user.phone_verified) return { ok: false as const, status: 403, error: "phone_unverified" };

  const team = db.prepare(`SELECT * FROM teams WHERE internal_id = ?`).get(tribeId);
  if (!team) return { ok: false as const, status: 404, error: "tribe_not_found" };

  if (user.tribe_id && user.tribe_id !== tribeId) {
    if (user.tribe_switched_at) {
      const last = new Date(user.tribe_switched_at).getTime();
      if (Date.now() - last < 24 * 60 * 60 * 1000) {
        return { ok: false as const, status: 429, error: "switch_cooldown" };
      }
    }
    db.prepare(`UPDATE users SET tribe_id = ?, tribe_switched_at = ? WHERE id = ?`).run(
      tribeId,
      new Date().toISOString(),
      userId,
    );
  } else if (!user.tribe_id) {
    db.prepare(`UPDATE users SET tribe_id = ? WHERE id = ?`).run(tribeId, userId);
  }

  return { ok: true as const, tribeId };
}
