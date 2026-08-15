/** Rival-threat push payload routing. FCM/VAPID delivery is Track H. */

export const RIVAL_THREAT_TYPE = "rival_threat";
export const PUSH_CLICK_EVENT = "cc:push-click";
export const THREAT_ALERT_EVENT = "cc:threat-alert";
export const PENDING_DEEP_LINK_KEY = "cc_pending_push_deep_link";
export const FOCUS_CREDITS_PARAM = "focus";
export const FOCUS_CREDITS_VALUE = "credits";

export type ThreatPushPayload = {
  type: typeof RIVAL_THREAT_TYPE;
  il_code: string;
  city_name: string;
  tribe_id: string;
  tension_percent: number;
  level: number;
  deep_link: string;
  contest_tension?: number;
  user_id?: string;
};

export type InAppThreatAlert = {
  il_code: string;
  city_name: string;
  tribe_id: string;
  tension_percent: number;
  level: number;
};

export type ForegroundPushResult =
  | { kind: "threat_banner"; alert: InAppThreatAlert }
  | { kind: "ignore" };

type ThreatAlertListener = (alert: InAppThreatAlert) => void;
type PushClickListener = (href: string) => void;

const threatListeners = new Set<ThreatAlertListener>();
const clickListeners = new Set<PushClickListener>();

function sessionStore(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  return data as Record<string, unknown>;
}

export function readPushString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const value = obj[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function readPushInt(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const value = obj[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Same-origin relative path only — no protocol-relative or absolute URLs. */
export function isSafeAppPath(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.includes("://")) return false;
  if (trimmed.includes("\\")) return false;
  if (trimmed.includes("\n") || trimmed.includes("\r")) return false;
  return true;
}

export function isMapDeepLink(href: string): boolean {
  if (!isSafeAppPath(href)) return false;
  const path = href.split("?")[0];
  return path === "/map";
}

export function appendFocusCredits(href: string): string {
  if (!isSafeAppPath(href)) return href;
  const url = new URL(href, "https://city-competition.local");
  if (url.searchParams.get(FOCUS_CREDITS_PARAM) !== FOCUS_CREDITS_VALUE) {
    url.searchParams.set(FOCUS_CREDITS_PARAM, FOCUS_CREDITS_VALUE);
  }
  return `${url.pathname}${url.search}`;
}

export function resolveThreatHref(payload: {
  il_code?: unknown;
  deep_link?: unknown;
}): string | null {
  const deep =
    typeof payload.deep_link === "string" ? payload.deep_link.trim() : "";
  if (deep && isMapDeepLink(deep)) {
    return appendFocusCredits(deep);
  }
  const il =
    typeof payload.il_code === "string"
      ? payload.il_code.trim()
      : typeof payload.il_code === "number"
        ? String(payload.il_code)
        : "";
  if (!/^\d{2}$/.test(il)) {
    return null;
  }
  return appendFocusCredits(`/map?il=${encodeURIComponent(il)}`);
}

export function parseThreatPush(data: unknown): ThreatPushPayload | null {
  const obj = asRecord(data);
  if (!obj) return null;
  const type = readPushString(obj, "type");
  if (type !== RIVAL_THREAT_TYPE) return null;
  const ilCode = readPushString(obj, "il_code");
  if (!ilCode || !/^\d{2}$/.test(ilCode)) return null;
  const href = resolveThreatHref(obj);
  if (!href) return null;

  const tensionPercent = readPushInt(obj, "tension_percent") ?? 0;
  let level = readPushInt(obj, "level");
  if (level == null || level <= 0) {
    level = tensionPercent >= 90 ? 90 : 70;
  }

  return {
    type: RIVAL_THREAT_TYPE,
    il_code: ilCode,
    city_name: readPushString(obj, "city_name") ?? ilCode,
    tribe_id: readPushString(obj, "tribe_id") ?? "",
    tension_percent: tensionPercent,
    level,
    deep_link: href,
    contest_tension: (() => {
      const raw = obj.contest_tension;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim()) {
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    })(),
    user_id: readPushString(obj, "user_id") ?? undefined,
  };
}

export function threatPayloadToAlert(
  payload: ThreatPushPayload,
): InAppThreatAlert {
  return {
    il_code: payload.il_code,
    city_name: payload.city_name,
    tribe_id: payload.tribe_id,
    tension_percent: payload.tension_percent,
    level: payload.level,
  };
}

export function inboxNotificationHref(item: {
  type: string;
  payload: Record<string, unknown> | null | undefined;
}): string | null {
  const payload = item.payload ?? {};
  if (item.type === RIVAL_THREAT_TYPE || payload.type === RIVAL_THREAT_TYPE) {
    return resolveThreatHref({
      il_code: payload.il_code,
      deep_link: payload.deep_link,
    });
  }
  const link = readPushString(payload, "deep_link");
  if (link && isSafeAppPath(link)) {
    return link;
  }
  return null;
}

export function stashPendingDeepLink(href: string): void {
  if (!isSafeAppPath(href)) return;
  sessionStore()?.setItem(PENDING_DEEP_LINK_KEY, href);
}

export function consumePendingDeepLink(): string | null {
  const store = sessionStore();
  if (!store) return null;
  const href = store.getItem(PENDING_DEEP_LINK_KEY);
  store.removeItem(PENDING_DEEP_LINK_KEY);
  if (!href || !isSafeAppPath(href)) return null;
  return href;
}

export function subscribePushClick(listener: PushClickListener): () => void {
  clickListeners.add(listener);
  return () => {
    clickListeners.delete(listener);
  };
}

export function dispatchPushClick(href: string): void {
  if (!isSafeAppPath(href)) return;
  for (const listener of clickListeners) {
    listener(href);
  }
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(PUSH_CLICK_EVENT, { detail: { href } }));
  } catch {
    // Node tests without CustomEvent / EventTarget.
  }
}

export function subscribeThreatAlert(
  listener: ThreatAlertListener,
): () => void {
  threatListeners.add(listener);
  return () => {
    threatListeners.delete(listener);
  };
}

export function emitThreatAlert(alert: InAppThreatAlert): void {
  for (const listener of threatListeners) {
    listener(alert);
  }
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(THREAT_ALERT_EVENT, { detail: alert }));
  } catch {
    // Node tests without CustomEvent / EventTarget.
  }
}

/** Notification tap: persist href for cold start, then notify a live client. */
export function handleNotificationClick(data: unknown): string | null {
  const threat = parseThreatPush(data);
  const href = threat
    ? resolveThreatHref(threat)
    : inboxNotificationHref({
        type: readPushString(asRecord(data) ?? {}, "type") ?? "",
        payload: asRecord(data) ?? {},
      });
  if (!href) return null;
  stashPendingDeepLink(href);
  dispatchPushClick(href);
  return href;
}

/**
 * App already visible: rival-threat becomes an in-app banner event.
 * Does not require the system notification to be tapped.
 */
export function handleForegroundPush(data: unknown): ForegroundPushResult {
  const threat = parseThreatPush(data);
  if (!threat) {
    return { kind: "ignore" };
  }
  const alert = threatPayloadToAlert(threat);
  emitThreatAlert(alert);
  return { kind: "threat_banner", alert };
}
