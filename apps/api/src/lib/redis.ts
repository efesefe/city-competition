import { createClient, type RedisClientType } from "redis";

/**
 * Upstash-compatible Redis via REDIS_URL (rediss:// for TLS, redis:// for local).
 * Local demo: docker compose redis or `redis-server` — no Upstash cloud required.
 */

let cmd: RedisClientType | null = null;
let sub: RedisClientType | null = null;

export function redisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error(
      "REDIS_URL is required (Upstash or local Redis). Example: redis://127.0.0.1:6379",
    );
  }
  return url;
}

export async function getRedis(): Promise<RedisClientType> {
  if (cmd?.isOpen) return cmd;
  cmd = createClient({ url: redisUrl() });
  cmd.on("error", (err) => {
    console.error("[redis] command client error", err);
  });
  await cmd.connect();
  return cmd;
}

/** Dedicated subscriber connection (Redis clients in subscribe mode cannot run other commands). */
export async function getRedisSubscriber(): Promise<RedisClientType> {
  if (sub?.isOpen) return sub;
  sub = createClient({ url: redisUrl() });
  sub.on("error", (err) => {
    console.error("[redis] subscriber error", err);
  });
  await sub.connect();
  return sub;
}

export async function pingRedis(): Promise<string> {
  const r = await getRedis();
  return r.ping();
}

export async function closeRedis(): Promise<void> {
  const closers: Promise<unknown>[] = [];
  if (sub?.isOpen) closers.push(sub.quit().catch(() => sub?.disconnect()));
  if (cmd?.isOpen) closers.push(cmd.quit().catch(() => cmd?.disconnect()));
  await Promise.all(closers);
  sub = null;
  cmd = null;
}

export const CHANNELS = {
  ownership: "cc:ownership",
} as const;

export const KEYS = {
  rateLimit: (userOrKey: string, group: string) => `ratelimit:${userOrKey}:${group}`,
  coalesceWindow: (kind: string, plate: string, audienceKey: string) =>
    `coalesce:${kind}:${plate}:${audienceKey}`,
  coalesceBuf: (kind: string, plate: string, audienceKey: string) =>
    `coalesce:buf:${kind}:${plate}:${audienceKey}`,
  digestCache: "cc:digest:cache",
  notifQueue: "notif_queue",
} as const;
