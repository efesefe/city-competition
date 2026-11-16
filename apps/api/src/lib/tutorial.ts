/**
 * Season 0 first-session tutorial (CC-61 / CC-62).
 * Flow: claim → dynamic mid-seed capture → live fight; skippable after verify.
 */
import { getActionCost, many, one, trDateString, type Queryable } from "./db.js";
import type { UserRow } from "./auth.js";

export type TutorialStep = "claim" | "capture" | "fight" | "done" | "idle";

export type TutorialState = {
  claimedEnergy: boolean;
  capture: boolean;
  liveFight: boolean;
  skipped: boolean;
  complete: boolean;
  capturePlate: string | null;
  fightPlate: string | null;
  /** Successful confirms on capture plate toward no-flip completion (CC-62). */
  captureConfirms: number;
  captureConfirmsNeeded: number;
  step: TutorialStep;
  active: boolean;
};

export type CityMargin = {
  plate: string;
  nameTr: string;
  ownerTeamId: string | null;
  leadMargin: number;
  leadSupport: number;
  secondSupport: number;
  teamCount: number;
  playerSupport: number;
};

const MID_MARGIN_MIN = 15;
const MID_MARGIN_MAX = 120;
/** Locked (Efe, 2026-11-15): capture beat without flip completes after 3 confirms. */
export const CAPTURE_CONFIRMS_NEEDED = 3;

/** Pure helper: should the capture beat complete from confirms alone? */
export function captureCompleteFromConfirms(confirms: number, needed = CAPTURE_CONFIRMS_NEEDED): boolean {
  return confirms >= needed;
}

export function tutorialFromUser(user: UserRow): TutorialState {
  const claimedEnergy = Boolean(user.tutorial_claimed_energy);
  const capture = Boolean(user.tutorial_capture);
  const liveFight = Boolean(user.tutorial_live_fight);
  const skipped = Boolean(user.tutorial_skipped);
  const complete = Boolean(user.tutorial_complete) || skipped || (claimedEnergy && capture && liveFight);
  const captureConfirms = Number(user.tutorial_capture_confirms ?? 0);

  let step: TutorialStep = "idle";
  const ready = Boolean(user.phone_verified && user.tribe_id);
  if (ready && !complete && !skipped) {
    if (!claimedEnergy) step = "claim";
    else if (!capture) step = "capture";
    else if (!liveFight) step = "fight";
    else step = "done";
  } else if (complete || skipped) {
    step = "done";
  }

  return {
    claimedEnergy,
    capture,
    liveFight,
    skipped,
    complete,
    capturePlate: user.tutorial_capture_plate ?? null,
    fightPlate: user.tutorial_fight_plate ?? null,
    captureConfirms,
    captureConfirmsNeeded: CAPTURE_CONFIRMS_NEEDED,
    step,
    active: ready && !complete && !skipped && step !== "done" && step !== "idle",
  };
}

/** Pure ranking for mid-seed capture: thin lead, not owned by player, preferably mid totals. */
export function rankCaptureCandidates(
  cities: CityMargin[],
  tribeId: string,
  actionCost: number,
): CityMargin[] {
  const flippableCeiling = actionCost * 3;
  return cities
    .filter((c) => c.ownerTeamId && c.ownerTeamId !== tribeId)
    .filter((c) => c.leadMargin >= MID_MARGIN_MIN && c.leadMargin <= Math.max(MID_MARGIN_MAX, flippableCeiling))
    .map((c) => {
      const gap = c.leadMargin;
      // Prefer margins close to 1–2 action costs and cities where player already has seed support.
      const costFit = Math.abs(gap - actionCost * 1.5);
      const playerBoost = c.playerSupport > 0 ? 0 : 40;
      const heatPenalty = c.leadSupport > 800 ? 30 : 0;
      return { city: c, score: costFit + playerBoost + heatPenalty + gap * 0.05 };
    })
    .sort((a, b) => a.score - b.score || a.city.plate.localeCompare(b.city.plate))
    .map((x) => x.city);
}

/** Contested / hot fight city: close race, multi-team, different from capture when possible. */
export function rankFightCandidates(
  cities: CityMargin[],
  tribeId: string,
  excludePlate: string | null,
): CityMargin[] {
  return cities
    .filter((c) => c.ownerTeamId !== tribeId || c.leadMargin <= 80)
    .filter((c) => c.teamCount >= 2)
    .filter((c) => c.plate !== excludePlate)
    .map((c) => {
      const close = c.leadMargin;
      const multi = c.teamCount >= 3 ? -15 : 0;
      const istanbulBoost = c.plate === "34" ? -25 : 0;
      const ownPenalty = c.ownerTeamId === tribeId ? 50 : 0;
      return { city: c, score: close + multi + istanbulBoost + ownPenalty };
    })
    .sort((a, b) => a.score - b.score || a.city.plate.localeCompare(b.city.plate))
    .map((x) => x.city);
}

export async function loadCityMargins(db: Queryable, tribeId: string): Promise<CityMargin[]> {
  const rows = await many<{
    plate: string;
    name_tr: string;
    owner_team_id: string | null;
    lead: string | null;
    second: string | null;
    team_count: string;
    player_support: string | null;
  }>(
    db,
    `SELECT c.plate, c.name_tr, c.owner_team_id,
            (
              SELECT cs.support FROM city_support cs
              WHERE cs.city_plate = c.plate
              ORDER BY cs.support DESC, cs.team_id ASC
              LIMIT 1
            )::text AS lead,
            (
              SELECT cs.support FROM city_support cs
              WHERE cs.city_plate = c.plate
              ORDER BY cs.support DESC, cs.team_id ASC
              OFFSET 1 LIMIT 1
            )::text AS second,
            (
              SELECT COUNT(*)::text FROM city_support cs WHERE cs.city_plate = c.plate AND cs.support > 0
            ) AS team_count,
            (
              SELECT cs.support::text FROM city_support cs
              WHERE cs.city_plate = c.plate AND cs.team_id = $1
            ) AS player_support
     FROM cities c
     ORDER BY c.plate`,
    [tribeId],
  );

  return rows.map((r) => {
    const leadSupport = Number(r.lead ?? 0);
    const secondSupport = Number(r.second ?? 0);
    return {
      plate: r.plate,
      nameTr: r.name_tr,
      ownerTeamId: r.owner_team_id,
      leadMargin: leadSupport - secondSupport,
      leadSupport,
      secondSupport,
      teamCount: Number(r.team_count ?? 0),
      playerSupport: Number(r.player_support ?? 0),
    };
  });
}

async function refreshComplete(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET tutorial_complete = TRUE
     WHERE id = $1
       AND tutorial_skipped = FALSE
       AND tutorial_claimed_energy = TRUE
       AND tutorial_capture = TRUE
       AND tutorial_live_fight = TRUE
       AND tutorial_complete = FALSE`,
    [userId],
  );
}

export async function markTutorialClaimed(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET tutorial_claimed_energy = TRUE
     WHERE id = $1 AND tutorial_claimed_energy = FALSE AND tutorial_skipped = FALSE`,
    [userId],
  );
  await refreshComplete(db, userId);
}

export async function markTutorialCapture(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET tutorial_capture = TRUE
     WHERE id = $1 AND tutorial_capture = FALSE AND tutorial_skipped = FALSE`,
    [userId],
  );
  await refreshComplete(db, userId);
}

export async function markTutorialLiveFight(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET tutorial_live_fight = TRUE
     WHERE id = $1 AND tutorial_live_fight = FALSE AND tutorial_skipped = FALSE`,
    [userId],
  );
  await refreshComplete(db, userId);
}

export async function skipTutorial(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET
       tutorial_skipped = TRUE,
       tutorial_complete = TRUE
     WHERE id = $1`,
    [userId],
  );
}

/** Lock a dynamic mid-seed capture city (and fight city) when capture step starts. */
export async function ensureTutorialCities(
  db: Queryable,
  user: UserRow,
): Promise<{ capturePlate: string | null; fightPlate: string | null }> {
  if (!user.tribe_id || !user.phone_verified) {
    return { capturePlate: null, fightPlate: null };
  }
  if (user.tutorial_skipped || user.tutorial_complete) {
    return {
      capturePlate: user.tutorial_capture_plate ?? null,
      fightPlate: user.tutorial_fight_plate ?? null,
    };
  }

  let capturePlate: string | null = user.tutorial_capture_plate ?? null;
  let fightPlate: string | null = user.tutorial_fight_plate ?? null;
  const margins = await loadCityMargins(db, user.tribe_id);
  const actionCost = await getActionCost(db);

  if (!capturePlate) {
    const ranked = rankCaptureCandidates(margins, user.tribe_id, actionCost);
    capturePlate = ranked[0]?.plate ?? margins.find((c) => c.ownerTeamId !== user.tribe_id)?.plate ?? null;
    if (capturePlate) {
      await db.query(`UPDATE users SET tutorial_capture_plate = $1 WHERE id = $2 AND tutorial_capture_plate IS NULL`, [
        capturePlate,
        user.id,
      ]);
    }
  }

  if (!fightPlate) {
    const ranked = rankFightCandidates(margins, user.tribe_id, capturePlate);
    fightPlate =
      ranked[0]?.plate ??
      margins.find((c) => c.plate !== capturePlate && c.ownerTeamId !== user.tribe_id)?.plate ??
      null;
    if (fightPlate) {
      await db.query(`UPDATE users SET tutorial_fight_plate = $1 WHERE id = $2 AND tutorial_fight_plate IS NULL`, [
        fightPlate,
        user.id,
      ]);
    }
  }

  return { capturePlate, fightPlate };
}

export async function getTutorialPayload(db: Queryable, user: UserRow) {
  // Already claimed today (e.g. grant on tribe join) → advance claim beat.
  if (
    !user.tutorial_claimed_energy &&
    !user.tutorial_skipped &&
    user.phone_verified &&
    user.free_grant_date === trDateString()
  ) {
    await markTutorialClaimed(db, user.id);
  }

  const cities = await ensureTutorialCities(db, user);
  // Re-read after possible plate locks / claim auto-mark.
  const fresh =
    (await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [user.id])) ?? user;
  const state = tutorialFromUser(fresh);
  let captureName: string | null = null;
  let fightName: string | null = null;
  if (cities.capturePlate) {
    const row = await one<{ name_tr: string }>(
      db,
      `SELECT name_tr FROM cities WHERE plate = $1`,
      [cities.capturePlate],
    );
    captureName = row?.name_tr ?? null;
  }
  if (cities.fightPlate) {
    const row = await one<{ name_tr: string }>(
      db,
      `SELECT name_tr FROM cities WHERE plate = $1`,
      [cities.fightPlate],
    );
    fightName = row?.name_tr ?? null;
  }
  return {
    ...state,
    capturePlate: cities.capturePlate ?? state.capturePlate,
    fightPlate: cities.fightPlate ?? state.fightPlate,
    captureName,
    fightName,
  };
}

/**
 * After a successful confirmed spend, advance tutorial beats.
 * Capture: flip to player tribe **or** 3 confirms on locked capture plate (CC-62).
 * Live fight: any successful spend on locked fight plate.
 */
export async function applyTutorialSpendProgress(
  db: Queryable,
  opts: {
    userId: string;
    plate: string;
    flipped: boolean;
    toTeamId: string;
    tribeId: string;
  },
): Promise<void> {
  const user = await one<UserRow>(db, `SELECT * FROM users WHERE id = $1`, [opts.userId]);
  if (!user || user.tutorial_skipped || user.tutorial_complete) return;

  if (!user.tutorial_capture && user.tutorial_capture_plate && opts.plate === user.tutorial_capture_plate) {
    const flippedToUs = opts.flipped && opts.toTeamId === opts.tribeId;
    if (flippedToUs) {
      await markTutorialCapture(db, opts.userId);
    } else {
      await incrementCaptureConfirmsAndMaybeComplete(db, opts.userId);
    }
  }

  if (!user.tutorial_live_fight && user.tutorial_fight_plate && opts.plate === user.tutorial_fight_plate) {
    await markTutorialLiveFight(db, opts.userId);
  }
}

async function incrementCaptureConfirmsAndMaybeComplete(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users
     SET tutorial_capture_confirms = COALESCE(tutorial_capture_confirms, 0) + 1
     WHERE id = $1
       AND tutorial_capture = FALSE
       AND tutorial_skipped = FALSE`,
    [userId],
  );
  const row = await one<{ tutorial_capture_confirms: number }>(
    db,
    `SELECT tutorial_capture_confirms FROM users WHERE id = $1`,
    [userId],
  );
  if (row && captureCompleteFromConfirms(Number(row.tutorial_capture_confirms))) {
    await markTutorialCapture(db, userId);
  }
}

export async function maybeAutoMarkClaimFromGrant(
  db: Queryable,
  userId: string,
  grantReason: string | undefined,
  granted: boolean,
): Promise<void> {
  if (granted || grantReason === "already_granted") {
    await markTutorialClaimed(db, userId);
  }
}
