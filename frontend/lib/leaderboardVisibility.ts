import type { Derby } from "@/lib/derbies-api";
import type { LeaderboardEntry, MeRank } from "@/lib/leaderboard-api";

/** Resolved derbies remain on the Derbi tab for this long after ends_at. */
export const RECENTLY_RESOLVED_MS = 24 * 60 * 60 * 1000;

/** Türkiye-wide bbox [west, south, east, north] for map WS fan-out on this tab. */
export const LEADERBOARD_VIEWPORT_BBOX: [number, number, number, number] = [
  25.5, 35.5, 45.0, 42.5,
];

export function isRecentlyResolved(
  derby: Pick<Derby, "status" | "ends_at">,
  nowMs = Date.now(),
): boolean {
  if (derby.status !== "resolved") return false;
  const ends = Date.parse(derby.ends_at);
  if (Number.isNaN(ends)) return false;
  return ends <= nowMs && nowMs - ends <= RECENTLY_RESOLVED_MS;
}

export function isDerbiTabVisible(
  derbies: Array<Pick<Derby, "status" | "ends_at">>,
  nowMs = Date.now(),
): boolean {
  return derbies.some(
    (d) => d.status === "active" || isRecentlyResolved(d, nowMs),
  );
}

/** Prefer an active derby; otherwise the most recently ended (resolved) one. */
export function selectPrimaryDerby<T extends Pick<Derby, "status" | "ends_at">>(
  derbies: T[],
  nowMs = Date.now(),
): T | null {
  const active = derbies.filter((d) => d.status === "active");
  if (active.length > 0) {
    return [...active].sort(
      (a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at),
    )[0]!;
  }
  const recent = derbies.filter((d) => isRecentlyResolved(d, nowMs));
  if (recent.length === 0) return null;
  return [...recent].sort(
    (a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at),
  )[0]!;
}

export function shouldShowYourRankFooter(
  entries: Array<Pick<LeaderboardEntry, "user_id">>,
  me: MeRank | null | undefined,
  viewerUserId: string | null,
): boolean {
  if (!me || !viewerUserId) return false;
  return !entries.some((e) => e.user_id === viewerUserId);
}

/**
 * Debounced refetch scheduler used by the leaderboard screen for
 * support_applied → HTTP refresh (same latency budget as map live updates).
 */
export function createDebouncedRefetch(
  refetch: () => void | Promise<void>,
  delayMs = 300,
): {
  trigger: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refetch();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function formatRemaining(ms: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return { hours, minutes, seconds };
}
