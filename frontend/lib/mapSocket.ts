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

export type MapSocketEvent = SupportAppliedMessage;

export type MapSocketStatus = "connecting" | "open" | "closed" | "error";

export type MapSocketOptions = {
  getBBox: () => MapBBox | null;
  onEvent?: (event: MapSocketEvent) => void;
  onStatus?: (status: MapSocketStatus) => void;
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

export type MapSocketHandle = {
  /** Push current viewport (debounced internally when called from move handlers). */
  sendViewport: (bbox?: MapBBox | null) => void;
  /** Immediately send viewport without debounce (e.g. on open). */
  sendViewportNow: (bbox?: MapBBox | null) => void;
  close: () => void;
};

/**
 * Connects to the map realtime WebSocket with exponential reconnect
 * backoff capped at 30s.
 */
export function connectMapSocket(opts: MapSocketOptions): MapSocketHandle {
  const debounceMs = opts.viewportDebounceMs ?? 200;
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const setStatus = (status: MapSocketStatus) => {
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

  const pushViewport = (bbox: MapBBox | null | undefined) => {
    const box = bbox === undefined ? opts.getBBox() : bbox;
    if (!box || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: "viewport", bbox: box }));
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
      pushViewport(opts.getBBox());
    };

    socket.onmessage = (ev) => {
      if (gen !== generation) return;
      try {
        const data: unknown = JSON.parse(String(ev.data));
        if (isSupportApplied(data)) {
          opts.onEvent?.(data);
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
    close() {
      closedByUser = true;
      clearReconnect();
      clearDebounce();
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
