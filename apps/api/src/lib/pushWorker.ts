import type { Db } from "./db.js";
import { listPushTokens } from "./inbox.js";
import { getRedis, KEYS } from "./redis.js";

export type DeliveredPush = {
  userId: string;
  platform: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export type PushSender = {
  send(input: DeliveredPush): Promise<void>;
};

/** Dev / Season 0 stub — logs delivery; no FCM/APNs credentials required. */
export class LogPushSender implements PushSender {
  readonly sent: DeliveredPush[] = [];

  async send(input: DeliveredPush): Promise<void> {
    this.sent.push(input);
    const suffix = input.token.length > 8 ? input.token.slice(-8) : input.token;
    console.info(
      `[push] deliver user=${input.userId} platform=${input.platform} token=…${suffix} title=${input.title}`,
    );
  }
}

type QueuePayload = {
  type?: string;
  user_id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  deep_link?: string;
  plate?: string;
};

function asStringMap(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

/**
 * Drain one notif_queue item: look up device tokens and invoke sender.
 * Items without user_id or without tokens are acknowledged (dropped) so the
 * queue does not stall — inbox dual-write already covered in-app.
 */
export async function processNotifPayload(
  db: Db,
  raw: string,
  sender: PushSender,
): Promise<{ delivered: number; skipped: string | null }> {
  let parsed: QueuePayload;
  try {
    parsed = JSON.parse(raw) as QueuePayload;
  } catch {
    return { delivered: 0, skipped: "invalid_json" };
  }

  const userId = parsed.user_id;
  if (!userId) return { delivered: 0, skipped: "missing_user_id" };

  const title = parsed.title ?? "City Competition";
  const body = parsed.body ?? parsed.type ?? "";
  const data = asStringMap({
    type: parsed.type ?? "",
    plate: parsed.plate ?? "",
    deep_link: parsed.deep_link ?? "",
    ...(parsed.data ?? {}),
  });

  const tokens = await listPushTokens(db, userId);
  if (tokens.length === 0) return { delivered: 0, skipped: "no_device_tokens" };

  let delivered = 0;
  for (const t of tokens) {
    await sender.send({
      userId,
      platform: t.platform,
      token: t.token,
      title,
      body,
      data,
    });
    delivered++;
  }
  return { delivered, skipped: null };
}

/**
 * Background BRPOP loop on notif_queue. Stops when abort signal fires.
 */
export async function runPushWorker(opts: {
  db: Db;
  sender?: PushSender;
  signal: AbortSignal;
  brpopTimeoutSec?: number;
}): Promise<void> {
  const sender = opts.sender ?? new LogPushSender();
  const timeout = opts.brpopTimeoutSec ?? 2;

  while (!opts.signal.aborted) {
    try {
      const r = await getRedis();
      const popped = await r.brPop(KEYS.notifQueue, timeout);
      if (!popped) continue;
      await processNotifPayload(opts.db, popped.element, sender);
    } catch (err) {
      if (opts.signal.aborted) break;
      console.warn("[push-worker] loop error", err);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export function startPushWorker(db: Db, sender?: PushSender): AbortController {
  const ac = new AbortController();
  void runPushWorker({ db, sender, signal: ac.signal }).catch((err) => {
    console.error("[push-worker] stopped", err);
  });
  return ac;
}
