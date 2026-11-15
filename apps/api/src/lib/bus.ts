import type { WebSocket } from "ws";

/** In-memory pub/sub stand-in for Redis (slice). */

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

type BusEvent = FlipEvent | DigestEvent | { type: "ping" };

const clients = new Set<WebSocket>();

export function subscribe(ws: WebSocket) {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
}

export function publish(event: BusEvent) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

export function clientCount() {
  return clients.size;
}
