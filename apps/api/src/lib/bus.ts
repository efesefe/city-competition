import type { WebSocket } from "ws";
import { CHANNELS, getRedis, getRedisSubscriber } from "./redis.js";

/** Redis pub/sub fan-out for ownership/support digest + flip/support deltas (multi-instance safe). */

export type OwnershipDigestCity = {
  plate: string;
  ownerTeamId: string | null;
  ownerAlias: string | null;
  ownerColor: string | null;
  /** Top cumulative support on the city (persists across flips). */
  leadSupport: number;
  /** Second-place support; 0 when uncontested / single tally. */
  rivalSupport: number;
  /** leadSupport − rivalSupport. */
  leadMargin: number;
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

/** Compact per-city support tick after a spend (guests + players on digest channel). */
export type SupportTickEvent = {
  type: "support";
  plate: string;
  ownerTeamId: string | null;
  ownerAlias: string | null;
  ownerColor: string | null;
  leadSupport: number;
  rivalSupport: number;
  leadMargin: number;
  spentTeamId: string;
  supportCredited: number;
};

export type BusEvent = FlipEvent | DigestEvent | SupportTickEvent | { type: "ping" };

export type DigestChannel = "digest";

type ClientState = {
  ws: WebSocket;
  channels: Set<DigestChannel>;
};

const clients = new Map<WebSocket, ClientState>();
let subscribed = false;

function fanoutLocal(payload: string) {
  let parsed: { type?: string } | null = null;
  try {
    parsed = JSON.parse(payload) as { type?: string };
  } catch {
    return;
  }
  const eventType = parsed?.type;
  // Digest-channel events only reach clients that subscribed to "digest".
  const digestTypes = new Set(["digest", "flip", "support", "ping"]);
  for (const state of clients.values()) {
    if (state.ws.readyState !== 1) continue;
    if (eventType && digestTypes.has(eventType) && !state.channels.has("digest")) continue;
    state.ws.send(payload);
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

/** Register a raw socket; channels empty until `subscribeChannel`. */
export function attachClient(ws: WebSocket): ClientState {
  const state: ClientState = { ws, channels: new Set() };
  clients.set(ws, state);
  ws.on("close", () => clients.delete(ws));
  return state;
}

/** @deprecated Prefer attachClient + subscribeChannel — kept for call-site clarity. */
export function subscribe(ws: WebSocket) {
  const state = attachClient(ws);
  state.channels.add("digest");
}

export function subscribeChannel(ws: WebSocket, channel: DigestChannel): boolean {
  const state = clients.get(ws);
  if (!state) return false;
  if (channel !== "digest") return false;
  state.channels.add(channel);
  return true;
}

export function unsubscribeChannel(ws: WebSocket, channel: DigestChannel): boolean {
  const state = clients.get(ws);
  if (!state) return false;
  state.channels.delete(channel);
  return true;
}

export function clientChannels(ws: WebSocket): DigestChannel[] {
  return [...(clients.get(ws)?.channels ?? [])];
}

export async function publish(event: BusEvent): Promise<void> {
  const payload = JSON.stringify(event);
  const r = await getRedis();
  await r.publish(CHANNELS.ownership, payload);
}

export function clientCount() {
  return clients.size;
}

export function digestSubscriberCount() {
  let n = 0;
  for (const state of clients.values()) {
    if (state.channels.has("digest")) n += 1;
  }
  return n;
}
