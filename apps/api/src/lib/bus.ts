import type { WebSocket } from "ws";
import { CHANNELS, getRedis, getRedisSubscriber } from "./redis.js";

/** Redis pub/sub fan-out for ownership digest + flip deltas (multi-instance safe). */

export type OwnershipDigestCity = {
  plate: string;
  ownerTeamId: string | null;
  ownerAlias: string | null;
  ownerColor: string | null;
};

export type FlipEvent = {
  type: "flip";
  plate: string;
  fromTeamId: string | null;
  toTeamId: string;
  toAlias: string;
  toColor: string;
};

export type DigestEvent = {
  type: "digest";
  cities: OwnershipDigestCity[];
};

export type BusEvent = FlipEvent | DigestEvent | { type: "ping" };

const clients = new Set<WebSocket>();
let subscribed = false;

function fanoutLocal(payload: string) {
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

/** Subscribe this process to the ownership channel (call once at boot). */
export async function startBus(): Promise<void> {
  if (subscribed) return;
  const subscriber = await getRedisSubscriber();
  await subscriber.subscribe(CHANNELS.ownership, (message) => {
    fanoutLocal(message);
  });
  subscribed = true;
  console.info(`[bus] subscribed to Redis channel ${CHANNELS.ownership}`);
}

export function subscribe(ws: WebSocket) {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
}

export async function publish(event: BusEvent): Promise<void> {
  const payload = JSON.stringify(event);
  const r = await getRedis();
  await r.publish(CHANNELS.ownership, payload);
}

export function clientCount() {
  return clients.size;
}
