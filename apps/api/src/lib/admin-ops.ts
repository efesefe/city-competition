import { nanoid } from "nanoid";
import { CITY_SEEDS } from "../data/city-seeds.js";
import { TEAM_BY_ALIAS, TEAMS, registerTeam, type Team } from "../data/teams.js";
import { issueOtp, normalizeTrPhone, verifyOtp } from "./auth.js";
import { clientCount } from "./bus.js";
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

/** Locked Season 0 bounds (Europe/Istanbul) — admin-overridable with OTP. */
export const DEFAULT_SEASON_0_START = "2026-11-27T09:00:00.000Z"; // Thu 27 Nov 2026 12:00 TR
export const DEFAULT_SEASON_0_END = "2027-05-23T20:59:00.000Z"; // Sun 23 May 2027 23:59 TR

export const GATED_PURPOSES = [
  "pack_prices",
  "economy_tunables",
  "season_bounds",
  "seed_write",
] as const;

export type GatedPurpose = (typeof GATED_PURPOSES)[number];

export type PackPrices = {
  smallTry: number | null;
  mediumTry: number | null;
  largeTry: number | null;
  subTry: number | null;
  personalBoostTry: number | null;
};

export type SeasonBounds = {
  season0StartsAt: string;
  season0EndsAt: string;
  season1PrepStartsAt: string | null;
};

export type TeamAddTicket = {
  id: string;
  userId: string;
  requesterHandle: string | null;
  requestedClub: string;
  status: "open" | "accepted" | "rejected" | "deferred";
  adminNote: string | null;
  createdPublicAlias: string | null;
  createdTeamId: string | null;
  triagedBy: string | null;
  triagedAt: string | null;
  createdAt: string;
};

export type OpsMetrics = {
  dau: number;
  dauSparkline: { day: string; dau: number }[];
  flipsToday: number;
  flips7d: number;
  revenueTodayTry: number;
  revenueMtdTry: number;
  matchDay: {
    nextEvent: {
      id: string;
      kind: string;
      label: string | null;
      startsAt: string;
      endsAt: string;
    } | null;
    lastPeakConcurrent: number | null;
    lastPeakAt: string | null;
    currentConcurrent: number;
    inMatchWindow: boolean;
  };
  openTeamAddTickets: number;
  note: string;
};

const PACK_KEYS = {
  smallTry: "pack_price_small_try",
  mediumTry: "pack_price_medium_try",
  largeTry: "pack_price_large_try",
  subTry: "pack_price_sub_try",
  personalBoostTry: "pack_price_personal_boost_try",
} as const;

const SEASON_KEYS = {
  season0StartsAt: "season_0_starts_at",
  season0EndsAt: "season_0_ends_at",
  season1PrepStartsAt: "season_1_prep_starts_at",
  seedsConfirmedAt: "seeds_confirmed_at",
} as const;

const MOCK_OTP = process.env.MOCK_OTP_CODE || "123456";
const HAS_NETGSM = Boolean(process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD);

function isPurpose(v: string): v is GatedPurpose {
  return (GATED_PURPOSES as readonly string[]).includes(v);
}

async function getTunable(db: Queryable, key: string): Promise<string | null> {
  const row = await one<{ value: string }>(db, `SELECT value FROM tunables WHERE key = $1`, [key]);
  return row?.value ?? null;
}

async function setTunable(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO tunables (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function ensureAdminOpsDefaults(db: Queryable): Promise<void> {
  const defaults: [string, string][] = [
    [PACK_KEYS.smallTry, "49.99"],
    [PACK_KEYS.mediumTry, "129.99"],
    [PACK_KEYS.largeTry, "249.99"],
    [PACK_KEYS.subTry, ""],
    [PACK_KEYS.personalBoostTry, ""],
    [SEASON_KEYS.season0StartsAt, DEFAULT_SEASON_0_START],
    [SEASON_KEYS.season0EndsAt, DEFAULT_SEASON_0_END],
    [SEASON_KEYS.season1PrepStartsAt, ""],
  ];
  for (const [key, value] of defaults) {
    const existing = await getTunable(db, key);
    if (existing === null) await setTunable(db, key, value);
  }
}

export async function enrollAdminPhone(
  db: Queryable,
  userId: string,
  phoneInput?: string,
): Promise<
  | { ok: true; phoneE164: string; enrolled: true }
  | {
      ok: false;
      status: number;
      error: "user_not_found" | "phone_unverified" | "invalid_tr_phone" | "phone_required";
    }
> {
  const user = await one<{
    id: string;
    phone_e164: string | null;
    phone_verified: boolean;
  }>(db, `SELECT id, phone_e164, phone_verified FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false, status: 404, error: "user_not_found" };

  let phone = user.phone_e164;
  if (phoneInput) {
    const normalized = normalizeTrPhone(phoneInput);
    if (!normalized) return { ok: false, status: 400, error: "invalid_tr_phone" };
    phone = normalized;
    await db.query(`UPDATE users SET phone_e164 = $2, phone_verified = TRUE WHERE id = $1`, [
      userId,
      phone,
    ]);
  }
  if (!phone) return { ok: false, status: 400, error: "phone_required" };
  if (!user.phone_verified && !phoneInput) {
    return { ok: false, status: 403, error: "phone_unverified" };
  }

  await db.query(`UPDATE users SET admin_phone_enrolled = TRUE WHERE id = $1`, [userId]);
  return { ok: true, phoneE164: phone, enrolled: true };
}

export async function adminOtpStatus(
  db: Queryable,
  userId: string,
): Promise<{ enrolled: boolean; phoneE164: string | null; purposes: GatedPurpose[] }> {
  const user = await one<{ phone_e164: string | null; admin_phone_enrolled: boolean }>(
    db,
    `SELECT phone_e164, admin_phone_enrolled FROM users WHERE id = $1`,
    [userId],
  );
  return {
    enrolled: Boolean(user?.admin_phone_enrolled),
    phoneE164: user?.phone_e164 ?? null,
    purposes: [...GATED_PURPOSES],
  };
}

/** Issue purpose-scoped OTP to enrolled admin phone (reuses otp_codes delivery). */
export async function challengeAdminOtp(
  db: Queryable,
  userId: string,
  purpose: string,
): Promise<
  | { ok: true; challengeId: string; purpose: GatedPurpose; mock: boolean; code?: string; expiresAt: string }
  | {
      ok: false;
      status: number;
      error: "invalid_purpose" | "not_enrolled" | "user_not_found" | "phone_required";
    }
> {
  if (!isPurpose(purpose)) return { ok: false, status: 400, error: "invalid_purpose" };
  const user = await one<{
    phone_e164: string | null;
    admin_phone_enrolled: boolean;
  }>(db, `SELECT phone_e164, admin_phone_enrolled FROM users WHERE id = $1`, [userId]);
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (!user.admin_phone_enrolled) return { ok: false, status: 403, error: "not_enrolled" };
  if (!user.phone_e164) return { ok: false, status: 400, error: "phone_required" };

  const delivered = await issueOtp(db, user.phone_e164);
  const code = delivered.code ?? (HAS_NETGSM ? String(Math.floor(100000 + Math.random() * 900000)) : MOCK_OTP);
  // When Netgsm path, issueOtp already stored the real code; re-read it.
  const stored = await one<{ code: string; expires_at: string }>(
    db,
    `SELECT code, expires_at FROM otp_codes WHERE phone_e164 = $1`,
    [user.phone_e164],
  );
  const challengeCode = stored?.code ?? code;
  const expiresAt = stored?.expires_at ?? delivered.expiresAt;
  const challengeId = nanoid();
  await db.query(
    `INSERT INTO admin_otp_challenges (id, user_id, purpose, code, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [challengeId, userId, purpose, challengeCode, expiresAt],
  );

  return {
    ok: true,
    challengeId,
    purpose,
    mock: delivered.mock,
    ...(delivered.mock ? { code: challengeCode } : {}),
    expiresAt,
  };
}

export async function consumeAdminOtp(
  db: Queryable,
  opts: { userId: string; purpose: GatedPurpose; otp: string },
): Promise<{ ok: true } | { ok: false; status: number; error: "otp_required" | "invalid_otp" | "not_enrolled" }> {
  if (!opts.otp?.trim()) return { ok: false, status: 400, error: "otp_required" };

  const user = await one<{ phone_e164: string | null; admin_phone_enrolled: boolean }>(
    db,
    `SELECT phone_e164, admin_phone_enrolled FROM users WHERE id = $1`,
    [opts.userId],
  );
  if (!user?.admin_phone_enrolled) return { ok: false, status: 403, error: "not_enrolled" };

  const challenge = await one<{
    id: string;
    code: string;
    expires_at: string | Date;
    attempts: number;
  }>(
    db,
    `SELECT id, code, expires_at, attempts FROM admin_otp_challenges
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [opts.userId, opts.purpose],
  );
  if (!challenge) return { ok: false, status: 401, error: "invalid_otp" };
  if (challenge.attempts >= 5) return { ok: false, status: 401, error: "invalid_otp" };
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "invalid_otp" };
  }

  await db.query(`UPDATE admin_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [
    challenge.id,
  ]);
  if (challenge.code !== opts.otp.trim()) return { ok: false, status: 401, error: "invalid_otp" };

  await db.query(`UPDATE admin_otp_challenges SET consumed_at = NOW() WHERE id = $1`, [
    challenge.id,
  ]);
  // Also clear login OTP row if present (shared delivery channel).
  if (user.phone_e164) {
    await verifyOtp(db, user.phone_e164, opts.otp.trim()).catch(() => false);
  }
  return { ok: true };
}

async function writeAudit(
  db: Queryable,
  opts: {
    actorUserId: string;
    action: string;
    targetKey?: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log (id, actor_user_id, action, target_key, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      nanoid(),
      opts.actorUserId,
      opts.action,
      opts.targetKey ?? null,
      opts.oldValue === undefined ? null : JSON.stringify(opts.oldValue),
      opts.newValue === undefined ? null : JSON.stringify(opts.newValue),
    ],
  );
}

export async function getPackPrices(db: Queryable): Promise<PackPrices> {
  const parse = (v: string | null) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    smallTry: parse(await getTunable(db, PACK_KEYS.smallTry)),
    mediumTry: parse(await getTunable(db, PACK_KEYS.mediumTry)),
    largeTry: parse(await getTunable(db, PACK_KEYS.largeTry)),
    subTry: parse(await getTunable(db, PACK_KEYS.subTry)),
    personalBoostTry: parse(await getTunable(db, PACK_KEYS.personalBoostTry)),
  };
}

export async function updatePackPrices(
  db: Queryable,
  opts: { actorUserId: string; otp: string; prices: Partial<PackPrices> },
): Promise<
  | { ok: true; prices: PackPrices }
  | { ok: false; status: number; error: string }
> {
  const gate = await consumeAdminOtp(db, {
    userId: opts.actorUserId,
    purpose: "pack_prices",
    otp: opts.otp,
  });
  if (!gate.ok) return gate;

  const before = await getPackPrices(db);
  const next: PackPrices = { ...before, ...opts.prices };
  const entries: [keyof PackPrices, string][] = [
    ["smallTry", PACK_KEYS.smallTry],
    ["mediumTry", PACK_KEYS.mediumTry],
    ["largeTry", PACK_KEYS.largeTry],
    ["subTry", PACK_KEYS.subTry],
    ["personalBoostTry", PACK_KEYS.personalBoostTry],
  ];
  for (const [field, key] of entries) {
    const val = next[field];
    await setTunable(db, key, val === null || val === undefined ? "" : String(val));
  }
  const after = await getPackPrices(db);
  await writeAudit(db, {
    actorUserId: opts.actorUserId,
    action: "pack_prices.update",
    targetKey: "pack_prices",
    oldValue: before,
    newValue: after,
  });
  return { ok: true, prices: after };
}

export async function updateEconomyTunables(
  db: Queryable,
  opts: {
    actorUserId: string;
    otp: string;
    freeDailyGrant?: number;
    actionCost?: number;
  },
): Promise<
  | { ok: true; freeDailyGrant: number; actionCost: number }
  | { ok: false; status: number; error: string }
> {
  const gate = await consumeAdminOtp(db, {
    userId: opts.actorUserId,
    purpose: "economy_tunables",
    otp: opts.otp,
  });
  if (!gate.ok) return gate;

  const before = {
    freeDailyGrant: await getFreeGrant(db),
    actionCost: await getActionCost(db),
  };

  if (opts.freeDailyGrant !== undefined) {
    if (!Number.isFinite(opts.freeDailyGrant) || opts.freeDailyGrant < 0 || opts.freeDailyGrant > 10_000) {
      return { ok: false, status: 400, error: "invalid_free_daily_grant" };
    }
    await setTunable(db, "free_daily_grant", String(Math.round(opts.freeDailyGrant)));
  }
  if (opts.actionCost !== undefined) {
    if (!Number.isFinite(opts.actionCost) || opts.actionCost < 10 || opts.actionCost > 20) {
      return { ok: false, status: 400, error: "invalid_action_cost" };
    }
    await setTunable(db, "action_cost", String(Math.round(opts.actionCost)));
  }

  const after = {
    freeDailyGrant: await getFreeGrant(db),
    actionCost: await getActionCost(db),
  };
  await writeAudit(db, {
    actorUserId: opts.actorUserId,
    action: "economy_tunables.update",
    targetKey: "economy",
    oldValue: before,
    newValue: after,
  });
  return { ok: true, ...after };
}

export async function getSeasonBounds(db: Queryable): Promise<SeasonBounds> {
  const start = (await getTunable(db, SEASON_KEYS.season0StartsAt)) || DEFAULT_SEASON_0_START;
  const end = (await getTunable(db, SEASON_KEYS.season0EndsAt)) || DEFAULT_SEASON_0_END;
  const prep = await getTunable(db, SEASON_KEYS.season1PrepStartsAt);
  return {
    season0StartsAt: start,
    season0EndsAt: end,
    season1PrepStartsAt: prep && prep.length > 0 ? prep : null,
  };
}

export async function updateSeasonBounds(
  db: Queryable,
  opts: {
    actorUserId: string;
    otp: string;
    season0StartsAt?: string;
    season0EndsAt?: string;
    season1PrepStartsAt?: string | null;
  },
): Promise<
  | { ok: true; bounds: SeasonBounds }
  | { ok: false; status: number; error: string }
> {
  const gate = await consumeAdminOtp(db, {
    userId: opts.actorUserId,
    purpose: "season_bounds",
    otp: opts.otp,
  });
  if (!gate.ok) return gate;

  const before = await getSeasonBounds(db);
  const start = opts.season0StartsAt ?? before.season0StartsAt;
  const end = opts.season0EndsAt ?? before.season0EndsAt;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    return { ok: false, status: 400, error: "invalid_season_bounds" };
  }

  await setTunable(db, SEASON_KEYS.season0StartsAt, new Date(s).toISOString());
  await setTunable(db, SEASON_KEYS.season0EndsAt, new Date(e).toISOString());
  if (opts.season1PrepStartsAt !== undefined) {
    await setTunable(
      db,
      SEASON_KEYS.season1PrepStartsAt,
      opts.season1PrepStartsAt ? new Date(opts.season1PrepStartsAt).toISOString() : "",
    );
  }

  const after = await getSeasonBounds(db);
  await writeAudit(db, {
    actorUserId: opts.actorUserId,
    action: "season_bounds.update",
    targetKey: "season_0",
    oldValue: before,
    newValue: after,
  });
  return { ok: true, bounds: after };
}

export async function getSeedStatus(db: Queryable): Promise<{
  teams: number;
  cities: number;
  supportRows: number;
  expectedTeams: number;
  expectedCities: number;
  confirmedAt: string | null;
  aliases: { internalId: string; publicAlias: string }[];
}> {
  const teams = Number((await one<{ c: string }>(db, `SELECT COUNT(*)::text AS c FROM teams`))?.c ?? 0);
  const cities = Number((await one<{ c: string }>(db, `SELECT COUNT(*)::text AS c FROM cities`))?.c ?? 0);
  const supportRows = Number(
    (await one<{ c: string }>(db, `SELECT COUNT(*)::text AS c FROM city_support`))?.c ?? 0,
  );
  const confirmedAt = await getTunable(db, SEASON_KEYS.seedsConfirmedAt);
  const aliases = await many<{ internalId: string; publicAlias: string }>(
    db,
    `SELECT internal_id AS "internalId", public_alias AS "publicAlias"
     FROM teams ORDER BY big4 DESC, public_alias`,
  );
  return {
    teams,
    cities,
    supportRows,
    expectedTeams: TEAMS.length,
    expectedCities: CITY_SEEDS.length,
    confirmedAt: confirmedAt && confirmedAt.length > 0 ? confirmedAt : null,
    aliases,
  };
}

/** Upsert Süper Lig aliases + re-apply 81-city seed matrix (OTP gated). */
export async function loadAliasesAndSeedMatrix(
  db: Db,
  opts: { actorUserId: string; otp: string; resetSupport?: boolean },
): Promise<
  | { ok: true; status: Awaited<ReturnType<typeof getSeedStatus>> }
  | { ok: false; status: number; error: string }
> {
  const gate = await consumeAdminOtp(db, {
    userId: opts.actorUserId,
    purpose: "seed_write",
    otp: opts.otp,
  });
  if (!gate.ok) return gate;

  const before = await getSeedStatus(db);

  await withTransaction(db, async (client) => {
    for (const t of TEAMS) {
      await client.query(
        `INSERT INTO teams (internal_id, public_alias, primary_color, secondary_color, big4)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (internal_id) DO UPDATE SET
           public_alias = EXCLUDED.public_alias,
           primary_color = EXCLUDED.primary_color,
           secondary_color = EXCLUDED.secondary_color,
           big4 = EXCLUDED.big4`,
        [t.internalId, t.publicAlias, t.primary, t.secondary, t.big4],
      );
      registerTeam(t);
    }

    for (const city of CITY_SEEDS) {
      let ownerId: string | null = null;
      let best = -1;
      for (const s of city.seeds) {
        const team = TEAM_BY_ALIAS.get(s.alias);
        if (!team) throw new Error(`Unknown alias in seed: ${s.alias}`);
        if (s.points > best) {
          best = s.points;
          ownerId = team.internalId;
        }
      }
      await client.query(
        `INSERT INTO cities (plate, name_tr, owner_team_id) VALUES ($1, $2, $3)
         ON CONFLICT (plate) DO UPDATE SET name_tr = EXCLUDED.name_tr, owner_team_id = EXCLUDED.owner_team_id`,
        [city.plate, city.nameTr, ownerId],
      );
      if (opts.resetSupport !== false) {
        await client.query(`DELETE FROM city_support WHERE city_plate = $1`, [city.plate]);
        for (const s of city.seeds) {
          const team = TEAM_BY_ALIAS.get(s.alias)!;
          await client.query(
            `INSERT INTO city_support (city_plate, team_id, support) VALUES ($1, $2, $3)`,
            [city.plate, team.internalId, s.points],
          );
        }
      }
    }

    await client.query(
      `INSERT INTO tunables (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SEASON_KEYS.seedsConfirmedAt, new Date().toISOString()],
    );
  });

  const after = await getSeedStatus(db);
  await writeAudit(db, {
    actorUserId: opts.actorUserId,
    action: "seed_write.load",
    targetKey: "aliases_and_matrix",
    oldValue: {
      teams: before.teams,
      cities: before.cities,
      supportRows: before.supportRows,
      confirmedAt: before.confirmedAt,
    },
    newValue: {
      teams: after.teams,
      cities: after.cities,
      supportRows: after.supportRows,
      confirmedAt: after.confirmedAt,
    },
  });
  return { ok: true, status: after };
}

export async function submitTeamAddTicket(
  db: Queryable,
  opts: { userId: string; requestedClub: string },
): Promise<
  | { ok: true; ticket: TeamAddTicket }
  | { ok: false; status: number; error: "invalid_request" | "duplicate_open" }
> {
  const club = opts.requestedClub.trim();
  if (club.length < 2 || club.length > 120) {
    return { ok: false, status: 400, error: "invalid_request" };
  }
  const dup = await one<{ id: string }>(
    db,
    `SELECT id FROM team_add_tickets
     WHERE user_id = $1 AND status = 'open'
       AND lower(requested_club) = lower($2)`,
    [opts.userId, club],
  );
  if (dup) return { ok: false, status: 409, error: "duplicate_open" };

  const id = nanoid();
  await db.query(
    `INSERT INTO team_add_tickets (id, user_id, requested_club, status)
     VALUES ($1, $2, $3, 'open')`,
    [id, opts.userId, club],
  );
  const ticket = await getTicket(db, id);
  return { ok: true, ticket: ticket! };
}

async function getTicket(db: Queryable, id: string): Promise<TeamAddTicket | null> {
  const row = await one<{
    id: string;
    user_id: string;
    handle: string | null;
    requested_club: string;
    status: string;
    admin_note: string | null;
    created_public_alias: string | null;
    created_team_id: string | null;
    triaged_by: string | null;
    triaged_at: string | Date | null;
    created_at: string | Date;
  }>(
    db,
    `SELECT t.id, t.user_id, u.handle, t.requested_club, t.status, t.admin_note,
            t.created_public_alias, t.created_team_id, t.triaged_by, t.triaged_at, t.created_at
     FROM team_add_tickets t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  if (!row) return null;
  return mapTicket(row);
}

function mapTicket(row: {
  id: string;
  user_id: string;
  handle: string | null;
  requested_club: string;
  status: string;
  admin_note: string | null;
  created_public_alias: string | null;
  created_team_id: string | null;
  triaged_by: string | null;
  triaged_at: string | Date | null;
  created_at: string | Date;
}): TeamAddTicket {
  const status = row.status as TeamAddTicket["status"];
  return {
    id: row.id,
    userId: row.user_id,
    requesterHandle: row.handle,
    requestedClub: row.requested_club,
    status,
    adminNote: row.admin_note,
    createdPublicAlias: row.created_public_alias,
    createdTeamId: row.created_team_id,
    triagedBy: row.triaged_by,
    triagedAt: row.triaged_at ? new Date(row.triaged_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listTeamAddTickets(
  db: Queryable,
  opts: { status?: TeamAddTicket["status"] } = {},
): Promise<TeamAddTicket[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.status) {
    params.push(opts.status);
    where = `WHERE t.status = $1`;
  }
  const rows = await many<{
    id: string;
    user_id: string;
    handle: string | null;
    requested_club: string;
    status: string;
    admin_note: string | null;
    created_public_alias: string | null;
    created_team_id: string | null;
    triaged_by: string | null;
    triaged_at: string | Date | null;
    created_at: string | Date;
  }>(
    db,
    `SELECT t.id, t.user_id, u.handle, t.requested_club, t.status, t.admin_note,
            t.created_public_alias, t.created_team_id, t.triaged_by, t.triaged_at, t.created_at
     FROM team_add_tickets t
     LEFT JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT 200`,
    params,
  );
  return rows.map(mapTicket);
}

export async function triageTeamAddTicket(
  db: Queryable,
  opts: {
    ticketId: string;
    adminUserId: string;
    action: "accept" | "reject" | "defer";
    adminNote?: string | null;
    /** Required on accept — public_alias only (*… Kabilesi*). */
    publicAlias?: string;
    primaryColor?: string;
    secondaryColor?: string;
    internalId?: string;
  },
): Promise<
  | { ok: true; ticket: TeamAddTicket }
  | {
      ok: false;
      status: number;
      error:
        | "not_found"
        | "already_triaged"
        | "alias_required"
        | "alias_taken"
        | "invalid_alias";
    }
> {
  const existing = await getTicket(db, opts.ticketId);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  if (existing.status !== "open" && existing.status !== "deferred") {
    return { ok: false, status: 409, error: "already_triaged" };
  }

  if (opts.action === "reject" || opts.action === "defer") {
    const status = opts.action === "reject" ? "rejected" : "deferred";
    // Reject if requested club already matches a known alias (ops hint).
    const note =
      opts.adminNote ??
      (opts.action === "reject" ? "pick existing alias / not adding" : "deferred");
    await db.query(
      `UPDATE team_add_tickets
       SET status = $2, admin_note = $3, triaged_by = $4, triaged_at = NOW()
       WHERE id = $1`,
      [opts.ticketId, status, note, opts.adminUserId],
    );
    return { ok: true, ticket: (await getTicket(db, opts.ticketId))! };
  }

  const alias = opts.publicAlias?.trim();
  if (!alias) return { ok: false, status: 400, error: "alias_required" };
  if (!/Kabilesi$/i.test(alias) || alias.length < 8) {
    return { ok: false, status: 400, error: "invalid_alias" };
  }

  const taken = await one<{ internal_id: string }>(
    db,
    `SELECT internal_id FROM teams WHERE lower(public_alias) = lower($1)`,
    [alias],
  );
  if (taken) return { ok: false, status: 409, error: "alias_taken" };

  const internalId =
    opts.internalId?.trim() ||
    `sl_ticket_${alias
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 24)}`;
  const primary = opts.primaryColor || "#4A5568";
  const secondary = opts.secondaryColor || "#E2E8F0";

  const team: Team = {
    internalId,
    publicAlias: alias,
    primary,
    secondary,
    big4: false,
  };

  await db.query(
    `INSERT INTO teams (internal_id, public_alias, primary_color, secondary_color, big4)
     VALUES ($1, $2, $3, $4, FALSE)`,
    [internalId, alias, primary, secondary],
  );
  registerTeam(team);

  await db.query(
    `UPDATE team_add_tickets
     SET status = 'accepted', admin_note = $2, created_public_alias = $3,
         created_team_id = $4, triaged_by = $5, triaged_at = NOW()
     WHERE id = $1`,
    [opts.ticketId, opts.adminNote ?? null, alias, internalId, opts.adminUserId],
  );

  return { ok: true, ticket: (await getTicket(db, opts.ticketId))! };
}

export async function recordOwnershipFlip(
  db: Queryable,
  opts: {
    plate: string;
    fromTeamId: string | null;
    toTeamId: string;
    userId: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO ownership_flips (id, city_plate, from_team_id, to_team_id, caused_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [nanoid(), opts.plate, opts.fromTeamId, opts.toTeamId, opts.userId],
  );
}

export async function recordPurchaseStub(
  db: Queryable,
  opts: { userId: string; sku: string; amountTry: number },
): Promise<{ ok: true; id: string }> {
  const id = nanoid();
  await db.query(
    `INSERT INTO purchase_events (id, user_id, sku, amount_try) VALUES ($1, $2, $3, $4)`,
    [id, opts.userId, opts.sku, opts.amountTry],
  );
  return { ok: true, id };
}

function trDayBounds(day: string): { startUtc: Date; endUtc: Date } {
  // day is en-CA YYYY-MM-DD in Europe/Istanbul; convert approx via offset format.
  const startUtc = new Date(`${day}T00:00:00+03:00`);
  const endUtc = new Date(`${day}T23:59:59.999+03:00`);
  return { startUtc, endUtc };
}

function lastNTrDays(n: number): string[] {
  const days: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    days.push(trDateString(new Date(now - i * 86_400_000)));
  }
  return days;
}

export async function sampleConcurrent(
  db: Queryable,
): Promise<{ concurrent: number; inMatchWindow: boolean; windowId: string | null }> {
  const concurrent = clientCount();
  const active = await one<{ id: string }>(
    db,
    `SELECT id FROM team_boost_windows
     WHERE canceled_at IS NULL AND starts_at <= NOW() AND ends_at >= NOW()
     ORDER BY starts_at DESC LIMIT 1`,
  );
  const inMatchWindow = Boolean(active);
  await db.query(
    `INSERT INTO concurrent_peaks (id, concurrent, in_match_window, window_id)
     VALUES ($1, $2, $3, $4)`,
    [nanoid(), concurrent, inMatchWindow, active?.id ?? null],
  );
  return { concurrent, inMatchWindow, windowId: active?.id ?? null };
}

export async function getOpsMetrics(db: Queryable): Promise<OpsMetrics> {
  await sampleConcurrent(db);

  const today = trDateString();
  const { startUtc: todayStart, endUtc: todayEnd } = trDayBounds(today);

  const dauRow = await one<{ c: string }>(
    db,
    `SELECT COUNT(DISTINCT user_id)::text AS c FROM (
       SELECT user_id FROM support_ledger
         WHERE created_at::timestamptz >= $1 AND created_at::timestamptz <= $2
       UNION
       SELECT user_id FROM sessions
         WHERE created_at::timestamptz >= $1 AND created_at::timestamptz <= $2
     ) u`,
    [todayStart.toISOString(), todayEnd.toISOString()],
  );
  const dau = Number(dauRow?.c ?? 0);

  const sparkDays = lastNTrDays(14);
  const dauSparkline: { day: string; dau: number }[] = [];
  for (const day of sparkDays) {
    const { startUtc, endUtc } = trDayBounds(day);
    const row = await one<{ c: string }>(
      db,
      `SELECT COUNT(DISTINCT user_id)::text AS c FROM (
         SELECT user_id FROM support_ledger
           WHERE created_at::timestamptz >= $1 AND created_at::timestamptz <= $2
         UNION
         SELECT user_id FROM sessions
           WHERE created_at::timestamptz >= $1 AND created_at::timestamptz <= $2
       ) u`,
      [startUtc.toISOString(), endUtc.toISOString()],
    );
    dauSparkline.push({ day, dau: Number(row?.c ?? 0) });
  }

  const flipsToday = Number(
    (
      await one<{ c: string }>(
        db,
        `SELECT COUNT(*)::text AS c FROM ownership_flips
         WHERE created_at >= $1 AND created_at <= $2`,
        [todayStart.toISOString(), todayEnd.toISOString()],
      )
    )?.c ?? 0,
  );

  const weekStart = trDayBounds(sparkDays[sparkDays.length - 7] ?? today).startUtc;
  const flips7d = Number(
    (
      await one<{ c: string }>(
        db,
        `SELECT COUNT(*)::text AS c FROM ownership_flips WHERE created_at >= $1`,
        [weekStart.toISOString()],
      )
    )?.c ?? 0,
  );

  const revenueTodayTry = Number(
    (
      await one<{ s: string }>(
        db,
        `SELECT COALESCE(SUM(amount_try),0)::text AS s FROM purchase_events
         WHERE created_at >= $1 AND created_at <= $2`,
        [todayStart.toISOString(), todayEnd.toISOString()],
      )
    )?.s ?? 0,
  );

  const monthPrefix = today.slice(0, 7); // YYYY-MM
  const mtdStart = new Date(`${monthPrefix}-01T00:00:00+03:00`);
  const revenueMtdTry = Number(
    (
      await one<{ s: string }>(
        db,
        `SELECT COALESCE(SUM(amount_try),0)::text AS s FROM purchase_events
         WHERE created_at >= $1`,
        [mtdStart.toISOString()],
      )
    )?.s ?? 0,
  );

  const nextEvent = await one<{
    id: string;
    kind: string;
    label: string | null;
    starts_at: string | Date;
    ends_at: string | Date;
  }>(
    db,
    `SELECT id, kind, label, starts_at, ends_at FROM team_boost_windows
     WHERE canceled_at IS NULL AND ends_at >= NOW()
     ORDER BY starts_at ASC LIMIT 1`,
  );

  const lastPeak = await one<{
    concurrent: number;
    sampled_at: string | Date;
  }>(
    db,
    `SELECT concurrent, sampled_at FROM concurrent_peaks
     WHERE in_match_window = TRUE
     ORDER BY concurrent DESC, sampled_at DESC LIMIT 1`,
  );

  const openTickets = Number(
    (
      await one<{ c: string }>(
        db,
        `SELECT COUNT(*)::text AS c FROM team_add_tickets WHERE status = 'open'`,
      )
    )?.c ?? 0,
  );

  const sample = await sampleConcurrent(db);

  return {
    dau,
    dauSparkline,
    flipsToday,
    flips7d,
    revenueTodayTry,
    revenueMtdTry,
    matchDay: {
      nextEvent: nextEvent
        ? {
            id: nextEvent.id,
            kind: nextEvent.kind,
            label: nextEvent.label,
            startsAt: new Date(nextEvent.starts_at).toISOString(),
            endsAt: new Date(nextEvent.ends_at).toISOString(),
          }
        : null,
      lastPeakConcurrent: lastPeak ? Number(lastPeak.concurrent) : null,
      lastPeakAt: lastPeak ? new Date(lastPeak.sampled_at).toISOString() : null,
      currentConcurrent: sample.concurrent,
      inMatchWindow: sample.inMatchWindow,
    },
    openTeamAddTickets: openTickets,
    note: "Watch-only soft-launch metrics — no kill-switch thresholds",
  };
}

export async function listAuditLog(
  db: Queryable,
  limit = 50,
): Promise<
  {
    id: string;
    actorUserId: string;
    action: string;
    targetKey: string | null;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }[]
> {
  const rows = await many<{
    id: string;
    actor_user_id: string;
    action: string;
    target_key: string | null;
    old_value: string | null;
    new_value: string | null;
    created_at: string | Date;
  }>(
    db,
    `SELECT id, actor_user_id, action, target_key, old_value, new_value, created_at
     FROM admin_audit_log ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    action: r.action,
    targetKey: r.target_key,
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
