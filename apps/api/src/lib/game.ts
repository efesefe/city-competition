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
import {
  TEAM_BOOST_MULT,
  boostSnapshotForUser,
  creditedSupport,
  toIso,
  type BoostSnapshot,
} from "./boost.js";
import { recordOwnershipFlip } from "./admin-ops.js";
import { dispatchAttackAlerts } from "./alerts.js";
import { noteFlip } from "./coalesce.js";
import { singleFlight } from "./idempotency.js";
import { getRedis, KEYS } from "./redis.js";
import { TEAM_BY_ID } from "../data/teams.js";
import { currentSeason, seasonWindow, type SeasonInfo } from "./season.js";

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

/** Re-export live boost helpers (CC-32). */
export {
  PERSONAL_BOOST_MULT,
  TEAM_BOOST_MULT,
  PERSONAL_BOOST_DURATION_MS,
  NEUTRAL_BOOST,
  boostSnapshotForUser,
  creditedSupport,
  activatePersonalBoostStub,
  activateTeamBoostSim,
  type BoostSnapshot,
} from "./boost.js";

/** Public chrome payload for an active match-day window. */
export type MatchDayEvent = {
  id: string;
  teamId: string;
  teamAlias: string;
  teamColor: string | null;
  boostPct: number;
  spotlightPlate: string | null;
  cityNameTr: string | null;
  label: string | null;
  startsAt: string;
  endsAt: string;
};

const DEFAULT_SPOTLIGHT_PLATE = "34"; // İstanbul — classic derby war city

/** Active windows (boost and/or spotlight) for map chrome. Guests may poll. */
export async function listActiveMatchDayEvents(db: Queryable): Promise<MatchDayEvent[]> {
  const rows = await many<{
    id: string;
    team_id: string;
    boost_pct: number;
    spotlight_plate: string | null;
    label: string | null;
    starts_at: string | Date;
    ends_at: string | Date;
    team_alias: string | null;
    team_color: string | null;
    city_name: string | null;
  }>(
    db,
    `SELECT w.id, w.team_id, w.boost_pct, w.spotlight_plate, w.label,
            w.starts_at, w.ends_at,
            t.public_alias AS team_alias, t.primary_color AS team_color,
            c.name_tr AS city_name
     FROM team_boost_windows w
     JOIN teams t ON t.internal_id = w.team_id
     LEFT JOIN cities c ON c.plate = w.spotlight_plate
     WHERE w.canceled_at IS NULL
       AND w.starts_at <= NOW() AND w.ends_at > NOW()
     ORDER BY w.ends_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    teamId: r.team_id,
    teamAlias: r.team_alias || r.team_id,
    teamColor: r.team_color,
    boostPct: Number(r.boost_pct) || TEAM_BOOST_MULT,
    spotlightPlate: r.spotlight_plate,
    cityNameTr: r.city_name,
    label: r.label,
    startsAt: toIso(r.starts_at) || new Date().toISOString(),
    endsAt: toIso(r.ends_at) || new Date().toISOString(),
  }));
}

/**
 * Fixture stub until admin MatchDay ops: opens team +25% window with map spotlight.
 * Wired for banner + spotlight chrome (locked UX — both together).
 */
export async function activateMatchDayFixtureStub(
  db: Queryable,
  userId: string,
  opts: {
    durationMs?: number;
    spotlightPlate?: string;
    label?: string | null;
  } = {},
): Promise<
  | { ok: true; stub: true; event: MatchDayEvent; boost: BoostSnapshot }
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

  const plate = (opts.spotlightPlate || DEFAULT_SPOTLIGHT_PLATE).trim();
  const city = await one<{ plate: string; name_tr: string }>(
    db,
    `SELECT plate, name_tr FROM cities WHERE plate = $1`,
    [plate],
  );
  if (!city) return { ok: false, status: 400, error: "invalid_spotlight_plate" };

  const id = nanoid();
  const durationMs = opts.durationMs ?? 2 * 60 * 60 * 1000;
  const starts = new Date().toISOString();
  const ends = new Date(Date.now() + durationMs).toISOString();
  const team = TEAM_BY_ID.get(user.tribe_id);
  const label =
    opts.label !== undefined
      ? opts.label
      : `${team?.publicAlias ?? "Kabile"} maç günü`;

  await db.query(
    `INSERT INTO team_boost_windows
       (id, team_id, boost_pct, starts_at, ends_at, spotlight_plate, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, user.tribe_id, TEAM_BOOST_MULT, starts, ends, city.plate, label],
  );

  const boost = await boostSnapshotForUser(db, { userId, tribeId: user.tribe_id });
  const event: MatchDayEvent = {
    id,
    teamId: user.tribe_id,
    teamAlias: team?.publicAlias ?? user.tribe_id,
    teamColor: team?.primary ?? null,
    boostPct: TEAM_BOOST_MULT,
    spotlightPlate: city.plate,
    cityNameTr: city.name_tr,
    label,
    startsAt: starts,
    endsAt: ends,
  };
  return { ok: true, stub: true, event, boost };
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

export type TeamScoreboardEntry = {
  rank: number;
  teamId: string;
  alias: string;
  color: string;
  citiesOwned: number;
};

export type PlayerScoreboardEntry = {
  rank: number;
  userId: string;
  handle: string;
  tribeId: string | null;
  tribeAlias: string | null;
  tribeColor: string | null;
  /** Sum of energy spent on support actions inside the season window. */
  supportSpent: number;
};

export type TeamScoreboard = {
  season: SeasonInfo;
  metric: "cities_owned";
  guestBrowse: true;
  teams: TeamScoreboardEntry[];
};

export type PlayerScoreboard = {
  season: SeasonInfo;
  metric: "support_spent";
  guestBrowse: true;
  players: PlayerScoreboardEntry[];
};

/**
 * Team board — live cities owned (map ownership). Season meta carries reset/freeze bounds.
 * Guests may browse without auth (CC-65 / CC-67).
 */
export async function teamScoreboard(db: Queryable): Promise<TeamScoreboard> {
  const season = currentSeason();
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
     GROUP BY t.internal_id, t.public_alias, t.primary_color
     ORDER BY COUNT(c.plate) DESC, t.public_alias ASC`,
  );
  const teams = rows.map((r, i) => ({
    rank: i + 1,
    teamId: r.teamId,
    alias: r.alias,
    color: r.color,
    citiesOwned: Number(r.citiesOwned),
  }));
  return { season, metric: "cities_owned", guestBrowse: true, teams };
}

/** @deprecated Prefer teamScoreboard — kept for older clients expecting `{ teams }`. */
export async function scoreboard(db: Queryable) {
  const board = await teamScoreboard(db);
  return board.teams.map(({ teamId, alias, color, citiesOwned }) => ({
    teamId,
    alias,
    color,
    citiesOwned,
  }));
}

/**
 * User / personal board — total energy spent on support this season (CC-66).
 * Guests may browse without auth (CC-67). Optional viewerId highlights "you".
 */
export async function playerScoreboard(
  db: Queryable,
  opts: { limit?: number; viewerId?: string | null } = {},
): Promise<PlayerScoreboard & { you: PlayerScoreboardEntry | null }> {
  const season = currentSeason();
  const { startsAt, endsAt } = seasonWindow(season);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const rows = await many<{
    userId: string;
    handle: string;
    tribeId: string | null;
    tribeAlias: string | null;
    tribeColor: string | null;
    supportSpent: string;
  }>(
    db,
    `SELECT u.id AS "userId", u.handle,
            u.tribe_id AS "tribeId",
            t.public_alias AS "tribeAlias",
            t.primary_color AS "tribeColor",
            COALESCE(SUM(sl.energy_spent), 0)::text AS "supportSpent"
     FROM support_ledger sl
     JOIN users u ON u.id = sl.user_id
     LEFT JOIN teams t ON t.internal_id = u.tribe_id
     WHERE sl.created_at >= $1 AND sl.created_at <= $2
     GROUP BY u.id, u.handle, u.tribe_id, t.public_alias, t.primary_color
     ORDER BY SUM(sl.energy_spent) DESC, u.handle ASC
     LIMIT $3`,
    [startsAt, endsAt, limit],
  );

  const players = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    handle: r.handle,
    tribeId: r.tribeId,
    tribeAlias: r.tribeAlias,
    tribeColor: r.tribeColor,
    supportSpent: Number(r.supportSpent),
  }));

  let you: PlayerScoreboardEntry | null = null;
  if (opts.viewerId) {
    you = players.find((p) => p.userId === opts.viewerId) ?? null;
    if (!you) {
      const mine = await one<{
        handle: string;
        tribeId: string | null;
        tribeAlias: string | null;
        tribeColor: string | null;
        supportSpent: string;
        rank: string;
      }>(
        db,
        `WITH totals AS (
           SELECT u.id, SUM(sl.energy_spent) AS spent
           FROM support_ledger sl
           JOIN users u ON u.id = sl.user_id
           WHERE sl.created_at >= $1 AND sl.created_at <= $2
           GROUP BY u.id
         ),
         me AS (
           SELECT u.id, u.handle, u.tribe_id,
                  COALESCE(t.spent, 0) AS spent
           FROM users u
           LEFT JOIN totals t ON t.id = u.id
           WHERE u.id = $3
         )
         SELECT m.handle,
                m.tribe_id AS "tribeId",
                tm.public_alias AS "tribeAlias",
                tm.primary_color AS "tribeColor",
                m.spent::text AS "supportSpent",
                CASE WHEN m.spent <= 0 THEN NULL
                     ELSE (1 + (SELECT COUNT(*)::int FROM totals o
                                WHERE o.spent > m.spent
                                   OR (o.spent = m.spent AND o.id < m.id)))::text
                END AS rank
         FROM me m
         LEFT JOIN teams tm ON tm.internal_id = m.tribe_id`,
        [startsAt, endsAt, opts.viewerId],
      );
      if (mine?.rank && Number(mine.supportSpent) > 0) {
        you = {
          rank: Number(mine.rank),
          userId: opts.viewerId,
          handle: mine.handle,
          tribeId: mine.tribeId,
          tribeAlias: mine.tribeAlias,
          tribeColor: mine.tribeColor,
          supportSpent: Number(mine.supportSpent),
        };
      }
    }
  }

  return {
    season,
    metric: "support_spent",
    guestBrowse: true,
    players,
    you,
  };
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

  // Admin-tunable cost is authoritative (band 10–20, default mid 15).
  const actionCost = await getActionCost(db);
  if (opts.amount !== undefined && opts.amount !== actionCost) {
    return {
      ok: false as const,
      status: 400,
      error: "action_cost_mismatch",
      actionCost,
    };
  }
  const cost = actionCost;

  // Cheap existence check outside the tx; owner is re-read under FOR UPDATE inside.
  const cityExists = await one<{ plate: string }>(
    db,
    `SELECT plate FROM cities WHERE plate = $1`,
    [opts.plate],
  );
  if (!cityExists) return { ok: false as const, status: 404, error: "city_not_found" };

  const tribeId = user.tribe_id;

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; idempotentReplay: true }
    | {
        ok: true;
        flipped: boolean;
        toTeamId: string;
        fromOwner: string | null;
        supportCredited: number;
        boost: BoostSnapshot;
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

      // FOR UPDATE on user via debit; then snapshot boost under the same tx (real expiry).
      const debit = await debitEnergy(client, opts.userId, cost);
      if (!debit.ok) return { ok: false as const, status: 400, error: debit.reason };

      const boost = await boostSnapshotForUser(client, { userId: opts.userId, tribeId });
      const supportCredited = creditedSupport(cost, boost);

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
        boost,
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

  // Attack alerts: owned tribe + last-24h spenders, 5-min coalesce, push + in-app.
  // Best-effort — spend already committed.
  try {
    const cityMeta = await one<{ name_tr: string }>(
      db,
      `SELECT name_tr FROM cities WHERE plate = $1`,
      [opts.plate],
    );
    await dispatchAttackAlerts(db, {
      plate: opts.plate,
      cityName: cityMeta?.name_tr ?? opts.plate,
      spenderUserId: opts.userId,
      spenderTribeId: tribeId,
      spenderAlias: TEAM_BY_ID.get(tribeId)?.publicAlias ?? tribeId,
      ownerTribeId: applied.fromOwner,
    });
  } catch (err) {
    console.warn("[alerts] attack dispatch failed", err);
  }

  if (applied.flipped) {
    await recordOwnershipFlip(db, {
      plate: opts.plate,
      fromTeamId: applied.fromOwner,
      toTeamId: applied.toTeamId,
      userId: opts.userId,
    });
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
    boost: applied.boost,
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
