import { isActivityKind, type ActivityKind } from "@/lib/activity-feed-api";
import { API_BASE } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

/** [minLon, minLat, maxLon, maxLat] in EPSG:4326 */
export type MapBBox = [number, number, number, number];

export type SupportAppliedMessage = {
  type: "support_applied";
  il_code: string;
  tribe_id: string;
  delta: number;
};

/** Forward-compat: backend does not emit this yet. */
export type WalletBalanceChangedMessage = {
  type: "wallet-balance-changed";
  balance: number;
};

export type TribeMessageEvent = {
  type: "tribe_message";
  id: string;
  tribe_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

/** App-wide nationwide ticker item. Backend fans this out to every connected client. */
export type ActivityFeedMessage = {
  type: "activity_feed";
  id: string;
  kind: ActivityKind;
  il_code: string;
  city_name: string;
  tribe_id: string;
  previous_tribe_id: string | null;
  credits: number;
  was_derbi_bonus: boolean;
  occurred_at: string;
};

/** App-wide ownership flip. Backend fans this out to every connected client. */
export type RegionSupportedMessage = {
  type: "region_supported";
  id: string;
  il_code: string;
  city_name: string;
  previous_tribe_id: string | null;
  new_tribe_id: string;
  winning_committed_credits: number;
  occurred_at: string;
  was_derbi_bonus: boolean;
};

export type RealtimeSocketEvent =
  | SupportAppliedMessage
  | WalletBalanceChangedMessage
  | TribeMessageEvent
  | RegionSupportedMessage
  | ActivityFeedMessage;

export type RealtimeSocketStatus = "connecting" | "open" | "closed" | "error";

export type RealtimeSocketOptions = {
  getBBox?: () => MapBBox | null;
  onEvent?: (event: RealtimeSocketEvent) => void;
  onStatus?: (status: RealtimeSocketStatus) => void;
  /** Debounce for viewport pushes after pan/zoom. Default 200ms. */
  viewportDebounceMs?: number;
};

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

function wsURL(token: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  const url = new URL(`${base}/v1/ws/map`);
  url.searchParams.set("token", token);
  return url.toString();
}

function isSupportApplied(data: unknown): data is SupportAppliedMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === "support_applied" &&
    typeof msg.il_code === "string" &&
    typeof msg.tribe_id === "string" &&
    typeof msg.delta === "number"
  );
}

function isWalletBalanceChanged(
  data: unknown,
): data is WalletBalanceChangedMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === "wallet-balance-changed" && typeof msg.balance === "number"
  );
}

function asStringId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function asIsoTime(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

export function isRegionSupported(data: unknown): data is RegionSupportedMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  const id = asStringId(msg.id);
  const ilCode = typeof msg.il_code === "string" ? msg.il_code : null;
  const cityName = typeof msg.city_name === "string" ? msg.city_name : null;
  const newTribeId = asStringId(msg.new_tribe_id);
  const occurredAt = asIsoTime(msg.occurred_at);
  const prev = msg.previous_tribe_id;
  const prevOk = prev === null || prev === undefined || typeof prev === "string";
  if (
    msg.type !== "region_supported" ||
    !id ||
    !ilCode ||
    !cityName ||
    !newTribeId ||
    !occurredAt ||
    !prevOk ||
    typeof msg.winning_committed_credits !== "number" ||
    typeof msg.was_derbi_bonus !== "boolean"
  ) {
    return false;
  }
  (msg as { id: string }).id = id;
  (msg as { occurred_at: string }).occurred_at = occurredAt;
  (msg as { previous_tribe_id: string | null }).previous_tribe_id =
    typeof prev === "string" && prev.length > 0 ? prev : null;
  return true;
}

export function isActivityFeed(data: unknown): data is ActivityFeedMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  const id = asStringId(msg.id);
  const ilCode = typeof msg.il_code === "string" ? msg.il_code : null;
  const cityName = typeof msg.city_name === "string" ? msg.city_name : null;
  const tribeId = asStringId(msg.tribe_id);
  const occurredAt = asIsoTime(msg.occurred_at);
  const prev = msg.previous_tribe_id;
  const prevOk = prev === null || prev === undefined || typeof prev === "string";
  if (
    msg.type !== "activity_feed" ||
    !id ||
    !isActivityKind(msg.kind) ||
    !ilCode ||
    !cityName ||
    !tribeId ||
    !occurredAt ||
    !prevOk ||
    typeof msg.credits !== "number" ||
    typeof msg.was_derbi_bonus !== "boolean"
  ) {
    return false;
  }
  (msg as { id: string }).id = id;
  (msg as { occurred_at: string }).occurred_at = occurredAt;
  (msg as { tribe_id: string }).tribe_id = tribeId;
  (msg as { previous_tribe_id: string | null }).previous_tribe_id =
    typeof prev === "string" && prev.length > 0 ? prev : null;
  return true;
}

/** Returns a typed realtime event or null when the frame is unknown/malformed. */
export function parseRealtimeSocketEvent(
  data: unknown,
): RealtimeSocketEvent | null {
  if (isSupportApplied(data)) return data;
  if (isWalletBalanceChanged(data)) return data;
  if (isTribeMessage(data)) return data;
  if (isRegionSupported(data)) return data;
  if (isActivityFeed(data)) return data;
  return null;
}

function isTribeMessage(data: unknown): data is TribeMessageEvent {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  const id = asStringId(msg.id);
  const tribeId = asStringId(msg.tribe_id);
  const senderId = asStringId(msg.sender_id);
  const createdAt =
    typeof msg.created_at === "string"
      ? msg.created_at
      : msg.created_at instanceof Date
        ? msg.created_at.toISOString()
        : null;
  if (
    msg.type !== "tribe_message" ||
    !id ||
    !tribeId ||
    !senderId ||
    typeof msg.body !== "string" ||
    !createdAt
  ) {
    return false;
  }
  // Normalize in place so downstream always sees strings.
  (msg as { id: string }).id = id;
  (msg as { tribe_id: string }).tribe_id = tribeId;
  (msg as { sender_id: string }).sender_id = senderId;
  (msg as { created_at: string }).created_at = createdAt;
  return true;
}

export type RealtimeSocketHandle = {
  /** Push current viewport (debounced internally when called from move handlers). */
  sendViewport: (bbox?: MapBBox | null) => void;
  /** Immediately send viewport without debounce (e.g. on open). */
  sendViewportNow: (bbox?: MapBBox | null) => void;
  /** Join a Hub room (e.g. tribe:{uuid}). Re-sent on reconnect. */
  joinRoom: (room: string) => void;
  /** Leave a Hub room previously joined. */
  leaveRoom: (room: string) => void;
  close: () => void;
};

/**
 * Connects to the app realtime WebSocket with exponential reconnect
 * backoff capped at 30s. Carries city support events, wallet events,
 * and tribe chat rooms.
 */
export function connectRealtimeSocket(
  opts: RealtimeSocketOptions,
): RealtimeSocketHandle {
  const debounceMs = opts.viewportDebounceMs ?? 200;
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const desiredRooms = new Set<string>();

  const setStatus = (status: RealtimeSocketStatus) => {
    opts.onStatus?.(status);
  };

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const sendJSON = (payload: Record<string, unknown>) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(payload));
  };

  const pushViewport = (bbox: MapBBox | null | undefined) => {
    const box =
      bbox === undefined ? (opts.getBBox?.() ?? null) : bbox;
    if (!box) {
      return;
    }
    sendJSON({ type: "viewport", bbox: box });
  };

  const pushRooms = () => {
    for (const room of desiredRooms) {
      sendJSON({ type: "join", room });
    }
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    clearReconnect();
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closedByUser) return;
    const token = getSessionToken();
    if (!token) {
      setStatus("error");
      scheduleReconnect();
      return;
    }

    const gen = ++generation;
    setStatus("connecting");
    const socket = new WebSocket(wsURL(token));
    ws = socket;

    socket.onopen = () => {
      if (gen !== generation || closedByUser) {
        socket.close();
        return;
      }
      backoffMs = INITIAL_BACKOFF_MS;
      setStatus("open");
      pushViewport(opts.getBBox?.() ?? null);
      pushRooms();
    };

    socket.onmessage = (ev) => {
      if (gen !== generation) return;
      try {
        const data: unknown = JSON.parse(String(ev.data));
        const event = parseRealtimeSocketEvent(data);
        if (event) {
          opts.onEvent?.(event);
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => {
      if (gen !== generation) return;
      setStatus("error");
    };

    socket.onclose = () => {
      if (gen !== generation) return;
      if (ws === socket) {
        ws = null;
      }
      setStatus("closed");
      if (!closedByUser) {
        scheduleReconnect();
      }
    };
  };

  connect();

  return {
    sendViewport(bbox) {
      clearDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        pushViewport(bbox);
      }, debounceMs);
    },
    sendViewportNow(bbox) {
      clearDebounce();
      pushViewport(bbox);
    },
    joinRoom(room) {
      const trimmed = room.trim();
      if (!trimmed) return;
      desiredRooms.add(trimmed);
      sendJSON({ type: "join", room: trimmed });
    },
    leaveRoom(room) {
      const trimmed = room.trim();
      if (!trimmed) return;
      desiredRooms.delete(trimmed);
      sendJSON({ type: "leave", room: trimmed });
    },
    close() {
      closedByUser = true;
      clearReconnect();
      clearDebounce();
      desiredRooms.clear();
      generation += 1;
      const socket = ws;
      ws = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }
      setStatus("closed");
    },
  };
}

/** @deprecated Use connectRealtimeSocket — kept for ProvinceMap migration. */
export const connectMapSocket = connectRealtimeSocket;
export type MapSocketEvent = RealtimeSocketEvent;
export type MapSocketStatus = RealtimeSocketStatus;
export type MapSocketOptions = RealtimeSocketOptions;
export type MapSocketHandle = RealtimeSocketHandle;
