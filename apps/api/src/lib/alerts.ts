import { TEAM_BY_ID } from "../data/teams.js";
import { noteEvent, enqueueNotif, COALESCE_WINDOW_SEC } from "./coalesce.js";
import { many, type Queryable } from "./db.js";
import { insertInbox } from "./inbox.js";

/** Product lock: rolling interest window for “cities I spent on”. */
export const SPEND_INTEREST_HOURS = 24;

export const NotifTypeAttack = "attack_alert";
export const NotifTypeFlipGain = "flip_gain";
export const NotifTypeFlipLoss = "flip_loss";

export type AttackScope = "owned" | "spent_24h";

export type AttackInterest = {
  userId: string;
  tribeId: string;
  /** Prefer owned copy when both scopes match (dedupe). */
  scope: AttackScope;
};

export type AttackAlertInput = {
  plate: string;
  cityName: string;
  spenderUserId: string;
  spenderTribeId: string;
  spenderAlias: string;
  /** Owner tribe *before* this spend’s flip resolution (defending side). */
  ownerTribeId: string | null;
};

export type AttackCopy = {
  titleTr: string;
  bodyTr: string;
  titleEn: string;
  bodyEn: string;
};

export type DispatchAttackResult = {
  interested: number;
  notified: number;
  coalesced: number;
};

/**
 * Resolve who should hear about a rival spend on this city.
 * - Owned: verified members of the defending (owner) tribe, excluding spender.
 * - Last-24h: verified users who spent on this city in the rolling window whose
 *   tribe ≠ spender tribe (rival). Own-tribe spends are non-triggers.
 * Same user in both scopes → one row with scope=owned.
 */
export async function resolveAttackInterests(
  db: Queryable,
  opts: {
    plate: string;
    spenderUserId: string;
    spenderTribeId: string;
    ownerTribeId: string | null;
    now?: Date;
  },
): Promise<AttackInterest[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - SPEND_INTEREST_HOURS * 60 * 60 * 1000).toISOString();
  const byUser = new Map<string, AttackInterest>();

  if (opts.ownerTribeId && opts.ownerTribeId !== opts.spenderTribeId) {
    const owners = await many<{ id: string; tribe_id: string }>(
      db,
      `SELECT id, tribe_id FROM users
       WHERE tribe_id = $1
         AND phone_verified = TRUE
         AND id != $2`,
      [opts.ownerTribeId, opts.spenderUserId],
    );
    for (const u of owners) {
      byUser.set(u.id, { userId: u.id, tribeId: u.tribe_id, scope: "owned" });
    }
  }

  const spenders = await many<{ id: string; tribe_id: string }>(
    db,
    `SELECT DISTINCT u.id, u.tribe_id
     FROM support_ledger sl
     JOIN users u ON u.id = sl.user_id
     WHERE sl.city_plate = $1
       AND sl.created_at >= $2
       AND u.phone_verified = TRUE
       AND u.tribe_id IS NOT NULL
       AND u.tribe_id != $3
       AND u.id != $4`,
    [opts.plate, since, opts.spenderTribeId, opts.spenderUserId],
  );

  for (const u of spenders) {
    const existing = byUser.get(u.id);
    if (existing) continue; // already owned — keep owned copy
    byUser.set(u.id, { userId: u.id, tribeId: u.tribe_id, scope: "spent_24h" });
  }

  return [...byUser.values()];
}

/** Locked copy from notifications-and-share.md (public_alias only). */
export function renderAttackCopy(opts: {
  scope: AttackScope;
  cityName: string;
  rivalAlias: string;
  yourAlias: string;
}): AttackCopy {
  const city = opts.cityName.trim() || "Şehir";
  if (opts.scope === "owned") {
    return {
      titleTr: `${city} saldırı altında`,
      bodyTr: `${opts.rivalAlias} baskı yapıyor. ${opts.yourAlias} için savun.`,
      titleEn: `${city} under attack`,
      bodyEn: `${opts.rivalAlias} is pushing. Defend for ${opts.yourAlias}.`,
    };
  }
  return {
    titleTr: `${city}'de savaş`,
    bodyTr: `Bu savaşa girdin. ${opts.rivalAlias} harcıyor — geri dön.`,
    titleEn: `Fight on ${city}`,
    bodyEn: `You backed this fight. ${opts.rivalAlias} is spending — jump back in.`,
  };
}

export function attackDeepLink(plate: string): string {
  return `/map?il=${plate}`;
}

export type FlipKind = "gain" | "loss";

export type FlipAlertInput = {
  plate: string;
  cityName: string;
  fromTeamId: string | null;
  toTeamId: string;
  toAlias: string;
};

export type DispatchFlipResult = {
  gainInterested: number;
  lossInterested: number;
  notified: number;
  coalesced: number;
};

/** Locked flip copy from notifications-and-share.md (public_alias only). */
export function renderFlipCopy(opts: {
  kind: FlipKind;
  cityName: string;
  /** New owner alias (for loss body) or your alias (for gain body). */
  alias: string;
}): AttackCopy {
  const city = opts.cityName.trim() || "Şehir";
  if (opts.kind === "loss") {
    return {
      titleTr: `${city} el değiştirdi`,
      bodyTr: `${opts.alias} öne geçti. Geri al.`,
      titleEn: `${city} flipped`,
      bodyEn: `${opts.alias} took the lead. Take it back.`,
    };
  }
  return {
    titleTr: `${city} sizin`,
    bodyTr: `${opts.alias} öne geçti. Koru.`,
    titleEn: `${city} is yours`,
    bodyEn: `${opts.alias} took the lead. Hold it.`,
  };
}

/** Verified members of a tribe (flip gain/loss audience). */
export async function resolveTribeMembers(
  db: Queryable,
  tribeId: string,
): Promise<Array<{ userId: string; tribeId: string }>> {
  const rows = await many<{ id: string; tribe_id: string }>(
    db,
    `SELECT id, tribe_id FROM users
     WHERE tribe_id = $1
       AND phone_verified = TRUE`,
    [tribeId],
  );
  return rows.map((u) => ({ userId: u.id, tribeId: u.tribe_id }));
}

/**
 * After a rival spend: resolve interests, 5-min per-user coalesce, dual-write
 * in-app inbox + notif_queue (push worker). Best-effort — never fail the spend.
 */
export async function dispatchAttackAlerts(
  db: Queryable,
  input: AttackAlertInput,
): Promise<DispatchAttackResult> {
  const interests = await resolveAttackInterests(db, input);
  let notified = 0;
  let coalesced = 0;

  for (const interest of interests) {
    const note = await noteEvent({
      kind: "attack",
      plate: input.plate,
      audienceKey: interest.userId,
      rivalAlias: input.spenderAlias,
    });

    if (note.coalesced) {
      coalesced++;
      continue;
    }

    const yourAlias =
      TEAM_BY_ID.get(interest.tribeId)?.publicAlias ?? interest.tribeId;
    const copy = renderAttackCopy({
      scope: interest.scope,
      cityName: input.cityName,
      rivalAlias: input.spenderAlias,
      yourAlias,
    });
    const deepLink = attackDeepLink(input.plate);
    const payload = {
      type: NotifTypeAttack,
      scope: interest.scope,
      plate: input.plate,
      city_name: input.cityName,
      rival_alias: input.spenderAlias,
      your_alias: yourAlias,
      deep_link: deepLink,
      coalesce_window_sec: COALESCE_WINDOW_SEC,
      title_en: copy.titleEn,
      body_en: copy.bodyEn,
    };

    // In-app feed (always) — TR titles match product soft-launch locale.
    await insertInbox(db, {
      userId: interest.userId,
      type: NotifTypeAttack,
      title: copy.titleTr,
      body: copy.bodyTr,
      payload,
    });

    // Push queue — worker delivers when device tokens exist (stub sender OK).
    await enqueueNotif({
      ...payload,
      user_id: interest.userId,
      title: copy.titleTr,
      body: copy.bodyTr,
      data: {
        type: NotifTypeAttack,
        plate: input.plate,
        scope: interest.scope,
        deep_link: deepLink,
      },
    });

    notified++;
  }

  return { interested: interests.length, notified, coalesced };
}

/**
 * After an ownership flip: extra soft-launch push + in-app for verified members
 * of the gaining tribe (gain) and losing tribe (loss). Audience is tribe-only —
 * last-24h spenders who are not in those tribes stay on attack/fight alerts
 * (no flip spillover = attack∩flip dedupe). 5-min per-user coalesce; dual-write
 * inbox + notif_queue. Best-effort.
 */
export async function dispatchFlipAlerts(
  db: Queryable,
  input: FlipAlertInput,
): Promise<DispatchFlipResult> {
  let notified = 0;
  let coalesced = 0;

  const gainMembers = await resolveTribeMembers(db, input.toTeamId);
  const lossMembers =
    input.fromTeamId && input.fromTeamId !== input.toTeamId
      ? await resolveTribeMembers(db, input.fromTeamId)
      : [];

  const deliver = async (
    kind: FlipKind,
    userId: string,
    tribeId: string,
  ): Promise<void> => {
    const note = await noteEvent({
      kind: kind === "gain" ? "flip_gain" : "flip_loss",
      plate: input.plate,
      audienceKey: userId,
      rivalAlias: input.toAlias,
    });

    if (note.coalesced) {
      coalesced++;
      return;
    }

    const yourAlias = TEAM_BY_ID.get(tribeId)?.publicAlias ?? tribeId;
    const copy = renderFlipCopy({
      kind,
      cityName: input.cityName,
      alias: kind === "gain" ? yourAlias : input.toAlias,
    });
    const notifType = kind === "gain" ? NotifTypeFlipGain : NotifTypeFlipLoss;
    const deepLink = attackDeepLink(input.plate);
    const payload = {
      type: notifType,
      kind,
      plate: input.plate,
      city_name: input.cityName,
      to_alias: input.toAlias,
      your_alias: yourAlias,
      deep_link: deepLink,
      coalesce_window_sec: COALESCE_WINDOW_SEC,
      title_en: copy.titleEn,
      body_en: copy.bodyEn,
    };

    await insertInbox(db, {
      userId,
      type: notifType,
      title: copy.titleTr,
      body: copy.bodyTr,
      payload,
    });

    await enqueueNotif({
      ...payload,
      user_id: userId,
      title: copy.titleTr,
      body: copy.bodyTr,
      data: {
        type: notifType,
        plate: input.plate,
        kind,
        deep_link: deepLink,
      },
    });

    notified++;
  };

  for (const m of gainMembers) {
    await deliver("gain", m.userId, m.tribeId);
  }
  for (const m of lossMembers) {
    await deliver("loss", m.userId, m.tribeId);
  }

  return {
    gainInterested: gainMembers.length,
    lossInterested: lossMembers.length,
    notified,
    coalesced,
  };
}
