import { nanoid } from "nanoid";
import { TEAM_BY_ID } from "../data/teams.js";
import { many, one, type Queryable } from "./db.js";
import { TEAM_BOOST_MULT, toIso } from "./boost.js";

/** Economy / calendar lock: kickoff −1h → FT +30m. */
export const MATCH_BOOST_PRE_MS = 60 * 60 * 1000;
export const MATCH_BOOST_POST_MS = 30 * 60 * 1000;
export const DEFAULT_TEAM_BOOST_PCT = TEAM_BOOST_MULT; // 1.25 = +25%

export type MatchDayKind = "team_boost" | "derby_war";

export type MatchDayWindow = {
  id: string;
  kind: MatchDayKind;
  teamId: string;
  teamAlias: string;
  boostPct: number;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  label: string | null;
  spotlightPlate: string | null;
  cityNameTr: string | null;
  involvedAliases: string | null;
  canceledAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

type WindowRow = {
  id: string;
  team_id: string;
  boost_pct: number;
  starts_at: string | Date;
  ends_at: string | Date;
  notes: string | null;
  label: string | null;
  spotlight_plate: string | null;
  involved_aliases: string | null;
  canceled_at: string | Date | null;
  created_by: string | null;
  created_at: string | Date;
  kind: string;
  team_alias: string | null;
  city_name: string | null;
};

const WINDOW_SELECT = `
  SELECT w.id, w.team_id, w.boost_pct, w.starts_at, w.ends_at, w.notes, w.label,
         w.spotlight_plate, w.involved_aliases, w.canceled_at, w.created_by, w.created_at, w.kind,
         t.public_alias AS team_alias, c.name_tr AS city_name
  FROM team_boost_windows w
  JOIN teams t ON t.internal_id = w.team_id
  LEFT JOIN cities c ON c.plate = w.spotlight_plate
`;

function mapWindow(r: WindowRow): MatchDayWindow {
  const kind: MatchDayKind = r.kind === "derby_war" ? "derby_war" : "team_boost";
  return {
    id: r.id,
    kind,
    teamId: r.team_id,
    teamAlias: r.team_alias || r.team_id,
    boostPct: Number(r.boost_pct),
    startsAt: toIso(r.starts_at) || new Date().toISOString(),
    endsAt: toIso(r.ends_at) || new Date().toISOString(),
    notes: r.notes,
    label: r.label,
    spotlightPlate: r.spotlight_plate,
    cityNameTr: r.city_name,
    involvedAliases: r.involved_aliases,
    canceledAt: toIso(r.canceled_at),
    createdBy: r.created_by,
    createdAt: toIso(r.created_at) || new Date().toISOString(),
  };
}

/** Pure: default +25% window from fixture kickoff + expected FT (TR/UTC instants). */
export function windowFromFixture(opts: {
  kickoffAt: string | Date;
  fullTimeAt: string | Date;
  preMs?: number;
  postMs?: number;
}): { startsAt: string; endsAt: string } | { error: "invalid_fixture_times" } {
  const kick = new Date(opts.kickoffAt).getTime();
  const ft = new Date(opts.fullTimeAt).getTime();
  if (!Number.isFinite(kick) || !Number.isFinite(ft) || ft <= kick) {
    return { error: "invalid_fixture_times" };
  }
  const pre = opts.preMs ?? MATCH_BOOST_PRE_MS;
  const post = opts.postMs ?? MATCH_BOOST_POST_MS;
  return {
    startsAt: new Date(kick - pre).toISOString(),
    endsAt: new Date(ft + post).toISOString(),
  };
}

function parseBoostPct(raw: number | undefined): number | { error: "invalid_boost_pct" } {
  if (raw === undefined) return DEFAULT_TEAM_BOOST_PCT;
  if (!Number.isFinite(raw) || raw < 1 || raw > 3) return { error: "invalid_boost_pct" };
  return raw;
}

async function requireTeam(
  db: Queryable,
  teamId: string,
): Promise<{ ok: true } | { ok: false; error: "team_not_found" }> {
  const team = await one(db, `SELECT internal_id FROM teams WHERE internal_id = $1`, [teamId]);
  if (!team) return { ok: false, error: "team_not_found" };
  return { ok: true };
}

async function requireCity(
  db: Queryable,
  plate: string,
): Promise<{ ok: true; plate: string; nameTr: string } | { ok: false; error: "invalid_spotlight_plate" }> {
  const normalized = plate.trim();
  const city = await one<{ plate: string; name_tr: string }>(
    db,
    `SELECT plate, name_tr FROM cities WHERE plate = $1`,
    [normalized],
  );
  if (!city) return { ok: false, error: "invalid_spotlight_plate" };
  return { ok: true, plate: city.plate, nameTr: city.name_tr };
}

function resolveExplicitWindow(opts: {
  startsAt?: string;
  endsAt?: string;
  kickoffAt?: string;
  fullTimeAt?: string;
}):
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; error: "invalid_window" | "invalid_fixture_times" } {
  if (opts.kickoffAt && opts.fullTimeAt) {
    const w = windowFromFixture({ kickoffAt: opts.kickoffAt, fullTimeAt: opts.fullTimeAt });
    if ("error" in w) return { ok: false, error: w.error };
    return { ok: true, ...w };
  }
  if (!opts.startsAt || !opts.endsAt) return { ok: false, error: "invalid_window" };
  const s = new Date(opts.startsAt).getTime();
  const e = new Date(opts.endsAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    return { ok: false, error: "invalid_window" };
  }
  return {
    ok: true,
    startsAt: new Date(s).toISOString(),
    endsAt: new Date(e).toISOString(),
  };
}

/** CC-50: schedule a tribe +25% (override OK) match-day boost window. */
export async function scheduleTeamBoost(
  db: Queryable,
  opts: {
    teamId: string;
    adminUserId: string;
    boostPct?: number;
    startsAt?: string;
    endsAt?: string;
    kickoffAt?: string;
    fullTimeAt?: string;
    notes?: string | null;
    label?: string | null;
  },
): Promise<
  | { ok: true; window: MatchDayWindow }
  | {
      ok: false;
      status: number;
      error:
        | "team_not_found"
        | "invalid_window"
        | "invalid_fixture_times"
        | "invalid_boost_pct";
    }
> {
  const teamOk = await requireTeam(db, opts.teamId);
  if (!teamOk.ok) return { ok: false, status: 400, error: teamOk.error };

  const boost = parseBoostPct(opts.boostPct);
  if (typeof boost === "object") return { ok: false, status: 400, error: boost.error };

  const win = resolveExplicitWindow(opts);
  if (!win.ok) return { ok: false, status: 400, error: win.error };

  const id = nanoid();
  const label =
    opts.label ??
    opts.notes ??
    `${TEAM_BY_ID.get(opts.teamId)?.publicAlias ?? opts.teamId} maç günü`;

  await db.query(
    `INSERT INTO team_boost_windows
       (id, team_id, boost_pct, starts_at, ends_at, notes, label, kind, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'team_boost', $8)`,
    [
      id,
      opts.teamId,
      boost,
      win.startsAt,
      win.endsAt,
      opts.notes ?? null,
      label,
      opts.adminUserId,
    ],
  );

  const row = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  return { ok: true, window: mapWindow(row!) };
}

/** CC-51: schedule a derby timed city war (spotlight; same capture rules). */
export async function scheduleDerbyWar(
  db: Queryable,
  opts: {
    /** Host / designated war tribe (used for banner filter when boost applies). */
    teamId: string;
    spotlightPlate: string;
    adminUserId: string;
    /** Default 1.0 — urgency/visibility only; pass 1.25 to also boost the host tribe. */
    boostPct?: number;
    startsAt?: string;
    endsAt?: string;
    kickoffAt?: string;
    fullTimeAt?: string;
    notes?: string | null;
    label?: string | null;
    involvedAliases?: string | null;
  },
): Promise<
  | { ok: true; window: MatchDayWindow }
  | {
      ok: false;
      status: number;
      error:
        | "team_not_found"
        | "invalid_spotlight_plate"
        | "invalid_window"
        | "invalid_fixture_times"
        | "invalid_boost_pct";
    }
> {
  const teamOk = await requireTeam(db, opts.teamId);
  if (!teamOk.ok) return { ok: false, status: 400, error: teamOk.error };

  const city = await requireCity(db, opts.spotlightPlate);
  if (!city.ok) return { ok: false, status: 400, error: city.error };

  const boost = parseBoostPct(opts.boostPct ?? 1.0);
  if (typeof boost === "object") return { ok: false, status: 400, error: boost.error };

  const win = resolveExplicitWindow(opts);
  if (!win.ok) return { ok: false, status: 400, error: win.error };

  const id = nanoid();
  const label =
    opts.label ??
    opts.notes ??
    `${city.nameTr} derbi savaşı`;

  await db.query(
    `INSERT INTO team_boost_windows
       (id, team_id, boost_pct, starts_at, ends_at, notes, label, kind,
        spotlight_plate, involved_aliases, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'derby_war', $8, $9, $10)`,
    [
      id,
      opts.teamId,
      boost,
      win.startsAt,
      win.endsAt,
      opts.notes ?? null,
      label,
      city.plate,
      opts.involvedAliases ?? null,
      opts.adminUserId,
    ],
  );

  const row = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  return { ok: true, window: mapWindow(row!) };
}

export async function updateMatchDayWindow(
  db: Queryable,
  id: string,
  patch: {
    boostPct?: number;
    startsAt?: string;
    endsAt?: string;
    notes?: string | null;
    label?: string | null;
    spotlightPlate?: string | null;
    involvedAliases?: string | null;
  },
): Promise<
  | { ok: true; window: MatchDayWindow }
  | {
      ok: false;
      status: number;
      error: "not_found" | "canceled" | "invalid_window" | "invalid_boost_pct" | "invalid_spotlight_plate";
    }
> {
  const existing = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  if (existing.canceled_at) return { ok: false, status: 409, error: "canceled" };

  let boostPct = Number(existing.boost_pct);
  if (patch.boostPct !== undefined) {
    const parsed = parseBoostPct(patch.boostPct);
    if (typeof parsed === "object") return { ok: false, status: 400, error: parsed.error };
    boostPct = parsed;
  }

  let startsAt = toIso(existing.starts_at)!;
  let endsAt = toIso(existing.ends_at)!;
  if (patch.startsAt !== undefined) startsAt = new Date(patch.startsAt).toISOString();
  if (patch.endsAt !== undefined) endsAt = new Date(patch.endsAt).toISOString();
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { ok: false, status: 400, error: "invalid_window" };
  }

  let spotlight: string | null = existing.spotlight_plate;
  if (patch.spotlightPlate !== undefined) {
    if (patch.spotlightPlate === null || patch.spotlightPlate === "") {
      spotlight = null;
    } else {
      const city = await requireCity(db, patch.spotlightPlate);
      if (!city.ok) return { ok: false, status: 400, error: city.error };
      spotlight = city.plate;
    }
  }

  await db.query(
    `UPDATE team_boost_windows
     SET boost_pct = $2, starts_at = $3, ends_at = $4, notes = $5, label = $6,
         spotlight_plate = $7, involved_aliases = $8
     WHERE id = $1`,
    [
      id,
      boostPct,
      startsAt,
      endsAt,
      patch.notes !== undefined ? patch.notes : existing.notes,
      patch.label !== undefined ? patch.label : existing.label,
      spotlight,
      patch.involvedAliases !== undefined ? patch.involvedAliases : existing.involved_aliases,
    ],
  );

  const row = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  return { ok: true, window: mapWindow(row!) };
}

export async function cancelMatchDayWindow(
  db: Queryable,
  id: string,
): Promise<
  | { ok: true; window: MatchDayWindow }
  | { ok: false; status: number; error: "not_found" | "already_canceled" }
> {
  const existing = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  if (existing.canceled_at) return { ok: false, status: 409, error: "already_canceled" };

  await db.query(`UPDATE team_boost_windows SET canceled_at = NOW() WHERE id = $1`, [id]);
  const row = await one<WindowRow>(db, `${WINDOW_SELECT} WHERE w.id = $1`, [id]);
  return { ok: true, window: mapWindow(row!) };
}

export async function listMatchDayWindows(
  db: Queryable,
  opts: { includeCanceled?: boolean; kind?: MatchDayKind } = {},
): Promise<MatchDayWindow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeCanceled) {
    clauses.push(`w.canceled_at IS NULL`);
  }
  if (opts.kind) {
    params.push(opts.kind);
    clauses.push(`w.kind = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await many<WindowRow>(
    db,
    `${WINDOW_SELECT} ${where} ORDER BY w.starts_at DESC, w.created_at DESC`,
    params,
  );
  return rows.map(mapWindow);
}

/** Promote a verified user to admin (slice bootstrap — real enrollment is OTP leaf). */
export async function promoteAdminSim(
  db: Queryable,
  userId: string,
): Promise<
  | { ok: true; role: "admin" }
  | { ok: false; status: number; error: "user_not_found" | "phone_unverified" }
> {
  const user = await one<{ phone_verified: boolean }>(
    db,
    `SELECT phone_verified FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  if (!user.phone_verified) return { ok: false, status: 403, error: "phone_unverified" };
  await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
  return { ok: true, role: "admin" };
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}
