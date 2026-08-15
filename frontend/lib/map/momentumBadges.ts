import type { City } from "@/lib/cities-api";

export const MOMENTUM_FLIPS_DISPLAY_THRESHOLD = 2;
export const STREAK_DAYS_DISPLAY_THRESHOLD = 5;

export type MomentumBadgeKind = "momentum" | "streak";

export type CityMomentumBadge = {
  kind: MomentumBadgeKind;
  count: number;
};

/**
 * One badge per city: volatile (flips today) wins over a holding streak.
 * Cities below both thresholds return null so the overlay stays sparse.
 */
export function cityMomentumBadge(
  city: Pick<City, "flips_today" | "current_streak_days">,
): CityMomentumBadge | null {
  const flips = city.flips_today ?? 0;
  const streak = city.current_streak_days ?? 0;
  if (flips >= MOMENTUM_FLIPS_DISPLAY_THRESHOLD) {
    return { kind: "momentum", count: flips };
  }
  if (streak >= STREAK_DAYS_DISPLAY_THRESHOLD) {
    return { kind: "streak", count: streak };
  }
  return null;
}

export function selectMomentumBadges<T extends Pick<City, "id" | "flips_today" | "current_streak_days">>(
  cities: T[],
): Array<{ city: T; badge: CityMomentumBadge }> {
  const out: Array<{ city: T; badge: CityMomentumBadge }> = [];
  for (const city of cities) {
    const badge = cityMomentumBadge(city);
    if (badge) {
      out.push({ city, badge });
    }
  }
  return out;
}
