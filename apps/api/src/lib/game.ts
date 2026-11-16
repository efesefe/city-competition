import { nanoid } from "nanoid";
import {
  getActionCost,
  many,
  one,
  withTransaction,
  type Db,
  type Queryable,
} from "./db.js";
import { publish, type OwnershipDigestCity } from "./bus.js";
import { noteFlip, noteRivalAttack } from "./coalesce.js";
import { singleFlight } from "./idempotency.js";
import { getRedis, KEYS } from "./redis.js";
import { TEAM_BY_ID } from "../data/teams.js";

/** Re-export energy grant helpers so existing imports keep working. */
export {
  forceGrantDaily,
  maybeGrantDailyEnergy,
  runDailyFreeEnergyJob,
} from "./energy.js";

export type LedgerIdempotencyRow = {
  id: string;
  energy_spent: number;
  support_credited: number;
  personal_boost_pct: number;
  team_boost_pct: number;
  city_plate: string;
};

/** Cheap committed-key lookup (HTTP uses this to skip rate limit on retries). */
export async function findLedgerByIdempotencyKey(
  db: Queryable,
  idempotencyKey: string,
): Promise<LedgerIdempotencyRow | undefined> {
  return one<LedgerIdempotencyRow>(
    db,
    `SELECT id, energy_spent, support_credited, personal_boost_pct, team_boost_pct, city_plate
     FROM support_ledger WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
}

async function idempotentReplayResult(db: Queryable, plate: string, row: LedgerIdempotencyRow) {
  return {
    ok: true as const,
    idempotentReplay: true as const,
    energySpent: Number(row.energy_spent),
    supportCredited: Number(row.support_credited),
    boost: {
      personalBoostPct: Number(row.personal_boost_pct),
      teamBoostPct: Number(row.team_boost_pct),
    },
    sheet: await citySheet(db, plate),
    digest: await ownershipDigest(db),
  };
}

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

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Live personal × team boost for display + spend snapshot. */
export async function boostSnapshotForUser(
  db: Queryable,
  opts: { userId: string; tribeId?: string | null },
): Promise<BoostSnapshot> {
  const user = await one<{ personal_boost_expires_at: string | Date | null; tribe_id: string | null }>(
    db,
    `SELECT personal_boost_expires_at, tribe_id FROM users WHERE id = $1`,
    [opts.userId],
  );
  if (!user) return { ...NEUTRAL_BOOST };

  const now = Date.now();
  const personalIso = toIso(user.personal_boost_expires_at);
  const personalActive = personalIso ? new Date(personalIso).getTime() > now : false;

  const tribeId = opts.tribeId ?? user.tribe_id;
  let teamBoostPct = 1;
  let teamWindowEndsAt: string | null = null;
  if (tribeId) {
    const win = await one<{ boost_pct: number; ends_at: string | Date }>(
      db,
      `SELECT boost_pct, ends_at FROM team_boost_windows
       WHERE team_id = $1 AND starts_at <= NOW() AND ends_at > NOW()
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

/** Payments stub: activate personal +50% for 1 hour without charging. */
export async function activatePersonalBoostStub(
  db: Queryable,
  userId: string,
): Promise<{ ok: true; boost: BoostSnapshot; stub: true } | { ok: false; status: number; error: string }> {
  const user = await one<{ phone_verified: boolean; tribe_id: string | null }>(
    db,
    `SELECT phone_verified, tribe_id FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false, status: 403, error: "phone_unverified" };

  const expires = new Date(Date.now() + PERSONAL_BOOST_DURATION_MS).toISOString();
  await db.query(`UPDATE users SET personal_boost_expires_at = $1 WHERE id = $2`, [
    expires,
    userId,
  ]);
  const boost = await boostSnapshotForUser(db, { userId, tribeId: user.tribe_id });
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

export function creditedSupport(energySpent: number, boost: BoostSnapshot): number {
  // Round to 3 dp so ledger stays stable across languages.
  return Math.round(energySpent * boost.personalBoostPct * boost.teamBoostPct * 1000) / 1000;
}

async function cacheDigest(cities: OwnershipDigestCity[]): Promise<void> {
  try {
    const r = await getRedis();
    await r.set(KEYS.digestCache, JSON.stringify(cities), { EX: 60 });
  } catch (err) {
    console.warn("[digest] redis cache warm failed", err);
  }
}

/** Read warm Redis digest cache (null on miss / error). */
export async function readCachedDigest(): Promise<OwnershipDigestCity[] | null> {
  try {
    const r = await getRedis();
    const raw = await r.get(KEYS.digestCache);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OwnershipDigestCity[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch (err) {
    console.warn("[digest] redis cache read failed", err);
    return null;
  }
}

/**
 * Compact 81-city ownership + support digest (lead/rival tallies for contested heat).
 * Prefer `loadOwnershipDigest` on WS reconnect so Redis cache can serve the snapshot.
 */
export async function ownershipDigest(db: Queryable): Promise<OwnershipDigestCity[]> {
  const rows = await many<{
    plate: string;
    ownerTeamId: string | null;
    ownerAlias: string | null;
    ownerColor: string | null;
    leadSupport: string | number | null;
    rivalSupport: string | number | null;
  }>(
    db,
    `SELECT c.plate,
            c.owner_team_id AS "ownerTeamId",
            t.public_alias AS "ownerAlias",
            t.primary_color AS "ownerColor",
            lead.support AS "leadSupport",
            rival.support AS "rivalSupport"
     FROM cities c
     LEFT JOIN teams t ON t.internal_id = c.owner_team_id
     LEFT JOIN LATERAL (
       SELECT support FROM city_support
       WHERE city_plate = c.plate
       ORDER BY support DESC, team_id ASC
       LIMIT 1
     ) lead ON TRUE
     LEFT JOIN LATERAL (
       SELECT support FROM city_support
       WHERE city_plate = c.plate
       ORDER BY support DESC, team_id ASC
       OFFSET 1 LIMIT 1
     ) rival ON TRUE
     ORDER BY c.plate`,
  );
  return rows.map((r) => {
    const leadSupport = Number(r.leadSupport ?? 0);
    const rivalSupport = Number(r.rivalSupport ?? 0);
    return {
      plate: r.plate,
      ownerTeamId: r.ownerTeamId,
      ownerAlias: r.ownerAlias,
      ownerColor: r.ownerColor,
      leadSupport,
      rivalSupport,
      leadMargin: leadSupport - rivalSupport,
    };
  });
}

/** Cache-first digest for WS subscribe / reconnect; always refreshes TTL on hit or miss. */
export async function loadOwnershipDigest(db: Queryable): Promise<OwnershipDigestCity[]> {
  const cached = await readCachedDigest();
  if (cached) {
    // Refresh TTL so active WS sessions keep the warm path.
    void cacheDigest(cached);
    return cached;
  }
  const cities = await ownershipDigest(db);
  await cacheDigest(cities);
  return cities;
}

/** Warm Redis digest at boot so the first guest subscribe is cache-fast. */
export async function warmDigestCache(db: Queryable): Promise<number> {
  const cities = await ownershipDigest(db);
  await cacheDigest(cities);
  return cities.length;
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

  // Real handles (locked UX) + current Kabile alias for the combat panel.
  const contributors = await many<{
    handle: string;
    alias: string | null;
    support: number;
  }>(
    db,
    `SELECT u.handle, t.public_alias AS alias, SUM(sl.support_credited) AS support
     FROM support_ledger sl
     JOIN users u ON u.id = sl.user_id
     LEFT JOIN teams t ON t.internal_id = u.tribe_id
     WHERE sl.city_plate = $1
     GROUP BY u.id, u.handle, t.public_alias
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
      alias: c.alias,
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

/** Debit free → sub → paid (free expires daily so spend it first). Locks the user row. */
async function debitEnergy(
  db: Queryable,
  userId: string,
  amount: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const user = await one<{
    free_energy: number;
    paid_energy: number;
    sub_energy: number;
  }>(
    db,
    `SELECT free_energy, paid_energy, sub_energy FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
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

export async function spendEnergy(
  db: Db,
  opts: {
    userId: string;
    plate: string;
    amount?: number;
    idempotencyKey: string;
    confirmed: boolean;
    /**
     * Test-only: skip process-local single-flight so UNIQUE/23505 races are exercised.
     * Production callers must omit this — multi-instance safety still comes from the ledger UNIQUE.
     */
    bypassSingleFlight?: boolean;
  },
) {
  if (!opts.confirmed) {
    return { ok: false as const, status: 400, error: "confirm_required" };
  }

  const run = () => spendEnergyOnce(db, opts);
  if (opts.bypassSingleFlight) return run();

  // Coalesce concurrent retries of the same key in this process; DB UNIQUE covers multi-instance.
  return singleFlight(`spend:${opts.idempotencyKey}`, run);
}

async function spendEnergyOnce(
  db: Db,
  opts: {
    userId: string;
    plate: string;
    amount?: number;
    idempotencyKey: string;
    confirmed: boolean;
  },
) {
  const existing = await findLedgerByIdempotencyKey(db, opts.idempotencyKey);
  if (existing) {
    return idempotentReplayResult(db, opts.plate, existing);
  }

  const user = await one<{
    phone_verified: boolean;
    tribe_id: string | null;
  }>(db, `SELECT phone_verified, tribe_id FROM users WHERE id = $1`, [opts.userId]);

  if (!user) return { ok: false as const, status: 404, error: "user_not_found" };
  if (!user.phone_verified) {
    return { ok: false as const, status: 403, error: "phone_unverified", gate: "spend" as const };
  }
  if (!user.tribe_id) return { ok: false as const, status: 403, error: "tribe_required" };

  const cost = opts.amount ?? (await getActionCost(db));
  if (cost < 10 || cost > 20) return { ok: false as const, status: 400, error: "cost_out_of_band" };

  // Cheap existence check outside the tx; owner is re-read under FOR UPDATE inside.
  const cityExists = await one<{ plate: string }>(
    db,
    `SELECT plate FROM cities WHERE plate = $1`,
    [opts.plate],
  );
  if (!cityExists) return { ok: false as const, status: 404, error: "city_not_found" };

  const tribeId = user.tribe_id;
  const boost = await boostSnapshotForUser(db, { userId: opts.userId, tribeId });
  const supportCredited = creditedSupport(cost, boost);

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; idempotentReplay: true }
    | {
        ok: true;
        flipped: boolean;
        toTeamId: string;
        fromOwner: string | null;
        supportCredited: number;
      };

  let result: TxResult;
  try {
    result = await withTransaction(db, async (client) => {
      // Serialize per-city apply under derby load.
      const lockedCity = await one<{ plate: string; owner_team_id: string | null }>(
        client,
        `SELECT plate, owner_team_id FROM cities WHERE plate = $1 FOR UPDATE`,
        [opts.plate],
      );
      if (!lockedCity) return { ok: false as const, status: 404, error: "city_not_found" };
      const fromOwner = lockedCity.owner_team_id;

      // Lock all support rows for this city (incumbent + rivals) before tally update.
      await many<{ team_id: string }>(
        client,
        `SELECT team_id FROM city_support WHERE city_plate = $1 FOR UPDATE`,
        [opts.plate],
      );

      // Re-check idempotency inside the transaction (race-safe with UNIQUE + 23505).
      const raced = await findLedgerByIdempotencyKey(client, opts.idempotencyKey);
      if (raced) return { ok: true as const, idempotentReplay: true as const };

      const debit = await debitEnergy(client, opts.userId, cost);
      if (!debit.ok) return { ok: false as const, status: 400, error: debit.reason };

      await client.query(
        `INSERT INTO city_support (city_plate, team_id, support)
         VALUES ($1, $2, $3)
         ON CONFLICT (city_plate, team_id)
         DO UPDATE SET support = city_support.support + EXCLUDED.support`,
        [opts.plate, tribeId, supportCredited],
      );

      const rankings = await many<{ team_id: string; support: number }>(
        client,
        `SELECT team_id, support FROM city_support
         WHERE city_plate = $1
         ORDER BY support DESC, team_id ASC`,
        [opts.plate],
      );
      if (!rankings.length) return { ok: false as const, status: 500, error: "support_missing" };

      const lead = rankings[0]!;
      const leadSupport = Number(lead.support);
      const incumbentSupport = fromOwner
        ? Number(rankings.find((r) => r.team_id === fromOwner)?.support ?? 0)
        : 0;

      // Flip only on strict lead. Ties keep the incumbent owner.
      let flipped = false;
      let toTeamId = fromOwner ?? lead.team_id;
      if (!fromOwner) {
        toTeamId = lead.team_id;
        await client.query(`UPDATE cities SET owner_team_id = $1 WHERE plate = $2`, [
          lead.team_id,
          opts.plate,
        ]);
        flipped = true;
      } else if (lead.team_id !== fromOwner && leadSupport > incumbentSupport) {
        toTeamId = lead.team_id;
        await client.query(`UPDATE cities SET owner_team_id = $1 WHERE plate = $2`, [
          lead.team_id,
          opts.plate,
        ]);
        flipped = true;
      }

      const ledgerId = nanoid();
      await client.query(
        `INSERT INTO support_ledger
          (id, user_id, city_plate, team_id, energy_spent, support_credited,
           personal_boost_pct, team_boost_pct, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ledgerId,
          opts.userId,
          opts.plate,
          tribeId,
          cost,
          supportCredited,
          boost.personalBoostPct,
          boost.teamBoostPct,
          opts.idempotencyKey,
          new Date().toISOString(),
        ],
      );

      return {
        ok: true as const,
        flipped,
        toTeamId,
        fromOwner,
        supportCredited,
      };
    });
  } catch (err: unknown) {
    // Unique violation on idempotency_key → treat as replay.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      const row = await findLedgerByIdempotencyKey(db, opts.idempotencyKey);
      if (row) return idempotentReplayResult(db, opts.plate, row);
      return {
        ok: true as const,
        idempotentReplay: true as const,
        sheet: await citySheet(db, opts.plate),
        digest: await ownershipDigest(db),
      };
    }
    throw err;
  }

  if (!result.ok) return result;
  if ("idempotentReplay" in result) {
    const row = await findLedgerByIdempotencyKey(db, opts.idempotencyKey);
    if (row) return idempotentReplayResult(db, opts.plate, row);
    return {
      ok: true as const,
      idempotentReplay: true as const,
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
  const citySnap = digest.find((c) => c.plate === opts.plate);
  await publish({
    type: "support",
    plate: opts.plate,
    ownerTeamId: citySnap?.ownerTeamId ?? applied.toTeamId,
    ownerAlias: citySnap?.ownerAlias ?? toAlias,
    ownerColor: citySnap?.ownerColor ?? toColor,
    leadSupport: citySnap?.leadSupport ?? applied.supportCredited,
    rivalSupport: citySnap?.rivalSupport ?? 0,
    leadMargin: citySnap?.leadMargin ?? 0,
    spentTeamId: tribeId,
    supportCredited: applied.supportCredited,
  });
  await publish({ type: "digest", cities: digest });
  await cacheDigest(digest);

  const refreshed = await one(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]);

  return {
    ok: true as const,
    flipped: applied.flipped,
    energySpent: cost,
    supportCredited: applied.supportCredited,
    boost,
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
  if (!user.phone_verified) {
    return { ok: false as const, status: 403, error: "phone_unverified", gate: "kabile" as const };
  }

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
