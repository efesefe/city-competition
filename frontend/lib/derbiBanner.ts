import type { Derby } from "@/lib/derbies-api";

/** Scheduled derbies appear on the map banner when starts_at is within this window. */
export const BANNER_SCHEDULED_SOON_MS = 24 * 60 * 60 * 1000;

export function isScheduledSoon(
  derby: Pick<Derby, "status" | "starts_at">,
  nowMs = Date.now(),
): boolean {
  if (derby.status !== "scheduled") return false;
  const starts = Date.parse(derby.starts_at);
  if (Number.isNaN(starts)) return false;
  return starts > nowMs && starts - nowMs <= BANNER_SCHEDULED_SOON_MS;
}

export function isBannerEligible(
  derby: Pick<Derby, "status" | "starts_at" | "ends_at">,
  nowMs = Date.now(),
): boolean {
  if (derby.status === "active") {
    const ends = Date.parse(derby.ends_at);
    if (Number.isNaN(ends)) return true;
    return ends > nowMs;
  }
  return isScheduledSoon(derby, nowMs);
}

export function tribeParticipates(
  derby: Pick<Derby, "host_tribe_id" | "guest_tribe_id">,
  tribeId: string | null | undefined,
): boolean {
  if (!tribeId) return false;
  return (
    derby.host_tribe_id === tribeId || derby.guest_tribe_id === tribeId
  );
}

/**
 * Prefer an active participating derby (latest ends_at); else the soonest
 * scheduled-soon participating derby. Returns null when none apply.
 */
export function selectBannerDerby<
  T extends Pick<
    Derby,
    | "status"
    | "starts_at"
    | "ends_at"
    | "host_tribe_id"
    | "guest_tribe_id"
  >,
>(derbies: T[], tribeId: string | null | undefined, nowMs = Date.now()): T | null {
  if (!tribeId) return null;
  const mine = derbies.filter(
    (d) => tribeParticipates(d, tribeId) && isBannerEligible(d, nowMs),
  );
  if (mine.length === 0) return null;

  const active = mine.filter((d) => d.status === "active");
  if (active.length > 0) {
    return [...active].sort(
      (a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at),
    )[0]!;
  }

  return [...mine].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  )[0]!;
}
