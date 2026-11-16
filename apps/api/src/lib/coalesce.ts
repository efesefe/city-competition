import { getRedis, KEYS } from "./redis.js";

/** Locked product: coalesce rival spends on the same city within 5 minutes. */
export const COALESCE_WINDOW_SEC = 5 * 60;

export type CoalesceKind = "attack" | "flip_gain" | "flip_loss";

export type CoalesceEvent = {
  kind: CoalesceKind;
  plate: string;
  /** Audience key — e.g. defending tribe id or interested user id. */
  audienceKey: string;
  rivalAlias?: string;
  at: string;
  count: number;
};

export type NoteResult =
  | { coalesced: true; windowOpen: true; count: number }
  | { coalesced: false; windowOpen: false; count: number; flush?: CoalesceEvent };

/**
 * Record an interest event into a 5-minute coalesce window.
 * First event opens the window (SET NX EX). Subsequent events increment the buffer
 * without emitting a new alert. Callers / workers can flushReady() for closed windows.
 *
 * Push delivery itself remains a later leaf — this is the Redis hook surface.
 */
export async function noteEvent(input: {
  kind: CoalesceKind;
  plate: string;
  audienceKey: string;
  rivalAlias?: string;
}): Promise<NoteResult> {
  const r = await getRedis();
  const winKey = KEYS.coalesceWindow(input.kind, input.plate, input.audienceKey);
  const bufKey = KEYS.coalesceBuf(input.kind, input.plate, input.audienceKey);
  const at = new Date().toISOString();

  // Open window if absent.
  const opened = await r.set(winKey, at, { NX: true, EX: COALESCE_WINDOW_SEC });

  const count = await r.hIncrBy(bufKey, "count", 1);
  await r.hSet(bufKey, {
    kind: input.kind,
    plate: input.plate,
    audienceKey: input.audienceKey,
    rivalAlias: input.rivalAlias ?? "",
    firstAt: opened ? at : ((await r.hGet(bufKey, "firstAt")) ?? at),
    lastAt: at,
  });
  await r.expire(bufKey, COALESCE_WINDOW_SEC + 30);

  if (opened) {
    // First event in window — eligible to notify immediately; buffer keeps counting.
    return {
      coalesced: false,
      windowOpen: false,
      count,
      flush: {
        kind: input.kind,
        plate: input.plate,
        audienceKey: input.audienceKey,
        rivalAlias: input.rivalAlias,
        at,
        count: 1,
      },
    };
  }

  return { coalesced: true, windowOpen: true, count };
}

/** Enqueue a coalesced notification payload for a future push worker (LPUSH notif_queue). */
export async function enqueueNotif(payload: Record<string, unknown>): Promise<void> {
  const r = await getRedis();
  await r.lPush(KEYS.notifQueue, JSON.stringify({ ...payload, enqueuedAt: new Date().toISOString() }));
}

/**
 * After a spend that threatens a rival-owned city, note coalesce for the defending tribe.
 * Returns whether a new alert should fire now (window was closed).
 */
export async function noteRivalAttack(opts: {
  plate: string;
  defendingTribeId: string | null;
  spenderTribeId: string;
  spenderAlias: string;
}): Promise<NoteResult | null> {
  if (!opts.defendingTribeId) return null;
  if (opts.defendingTribeId === opts.spenderTribeId) return null;

  const result = await noteEvent({
    kind: "attack",
    plate: opts.plate,
    audienceKey: opts.defendingTribeId,
    rivalAlias: opts.spenderAlias,
  });

  if (!result.coalesced && result.flush) {
    await enqueueNotif({
      type: "attack_coalesced",
      ...result.flush,
    });
  }

  return result;
}

/** Note flip gain/loss coalesce hooks for the tribes involved. */
export async function noteFlip(opts: {
  plate: string;
  fromTeamId: string | null;
  toTeamId: string;
  toAlias: string;
}): Promise<void> {
  const gain = await noteEvent({
    kind: "flip_gain",
    plate: opts.plate,
    audienceKey: opts.toTeamId,
    rivalAlias: opts.toAlias,
  });
  if (!gain.coalesced && gain.flush) {
    await enqueueNotif({ type: "flip_gain", ...gain.flush });
  }

  if (opts.fromTeamId && opts.fromTeamId !== opts.toTeamId) {
    const loss = await noteEvent({
      kind: "flip_loss",
      plate: opts.plate,
      audienceKey: opts.fromTeamId,
      rivalAlias: opts.toAlias,
    });
    if (!loss.coalesced && loss.flush) {
      await enqueueNotif({ type: "flip_loss", ...loss.flush });
    }
  }
}
