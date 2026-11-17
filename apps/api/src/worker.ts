/**
 * Fly worker process (process group `worker`).
 * Reuses existing grant + Redis coalesce queue helpers — does not change spend/flip math.
 *
 * Jobs:
 *  1. TR-midnight free-energy sweep (Europe/Istanbul calendar day)
 *  2. Drain `notif_queue` (stub delivery until Expo Push leaf lands)
 */
import "./loadEnv.js";
import { createClient, type RedisClientType } from "redis";
import { closeDb, getPool, initDb, trDateString } from "./lib/db.js";
import { maybeGrantDailyEnergy } from "./lib/game.js";
import { closeRedis, getRedis, KEYS, pingRedis, redisUrl } from "./lib/redis.js";

const GRANT_POLL_MS = Number(process.env.WORKER_GRANT_POLL_MS || 60_000);
const NOTIF_BRPOP_SEC = Number(process.env.WORKER_NOTIF_BRPOP_SEC || 5);
const GRANT_LOCK_TTL_SEC = Number(process.env.WORKER_GRANT_LOCK_TTL_SEC || 55);

let stopping = false;
/** Dedicated connection for blocking BRPOP so grant locks stay on the command client. */
let notifRedis: RedisClientType | null = null;

async function getNotifRedis(): Promise<RedisClientType> {
  if (notifRedis?.isOpen) return notifRedis;
  notifRedis = createClient({ url: redisUrl() });
  notifRedis.on("error", (err) => {
    console.error("[worker] notif redis error", err);
  });
  await notifRedis.connect();
  return notifRedis;
}

async function sweepDailyGrants(): Promise<void> {
  const db = getPool();
  const redis = await getRedis();
  const today = trDateString();
  const lockKey = `worker:grant:${today}`;

  // Single-flight across worker Machines (Season 0: usually scale worker=1).
  const locked = await redis.set(lockKey, String(Date.now()), {
    NX: true,
    EX: GRANT_LOCK_TTL_SEC,
  });
  if (!locked) return;

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users
     WHERE phone_verified = TRUE
       AND (free_grant_date IS NULL OR free_grant_date <> $1)
     ORDER BY id
     LIMIT 500`,
    [today],
  );

  let granted = 0;
  for (const row of rows) {
    if (stopping) break;
    const result = await maybeGrantDailyEnergy(db, row.id);
    if (result.granted) granted += 1;
  }

  if (rows.length > 0 || granted > 0) {
    console.info(
      JSON.stringify({
        svc: "worker",
        job: "tr_midnight_grant",
        date: today,
        scanned: rows.length,
        granted,
      }),
    );
  }
}

async function drainNotifQueueOnce(): Promise<void> {
  const redis = await getNotifRedis();
  const popped = await redis.brPop(KEYS.notifQueue, NOTIF_BRPOP_SEC);
  if (!popped?.element) return;

  // Stub delivery — Expo Push / APNs / FCM leaf lands later. Ack by dequeue.
  console.info(
    JSON.stringify({
      svc: "worker",
      job: "notif_stub",
      payload: safeJson(popped.element),
    }),
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function grantLoop(): Promise<void> {
  while (!stopping) {
    try {
      await sweepDailyGrants();
    } catch (err) {
      console.error("[worker] grant sweep failed", err);
    }
    await sleep(GRANT_POLL_MS);
  }
}

async function notifLoop(): Promise<void> {
  while (!stopping) {
    try {
      await drainNotifQueueOnce();
    } catch (err) {
      console.error("[worker] notif drain failed", err);
      await sleep(1000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  await initDb();
  const redis = await pingRedis();
  console.info(
    JSON.stringify({
      svc: "worker",
      ok: true,
      db: "postgres",
      redis,
      tzHint: "Europe/Istanbul via trDateString()",
    }),
  );

  const onStop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[worker] shutting down on ${signal}`);
    if (notifRedis?.isOpen) {
      await notifRedis.quit().catch(() => notifRedis?.disconnect());
      notifRedis = null;
    }
    await closeDb();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGTERM", () => void onStop("SIGTERM"));
  process.on("SIGINT", () => void onStop("SIGINT"));

  await Promise.all([grantLoop(), notifLoop()]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
