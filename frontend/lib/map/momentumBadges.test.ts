import { describe, expect, it } from "vitest";
import {
  MOMENTUM_FLIPS_DISPLAY_THRESHOLD,
  STREAK_DAYS_DISPLAY_THRESHOLD,
  cityMomentumBadge,
  selectMomentumBadges,
} from "@/lib/map/momentumBadges";
import type { City } from "@/lib/cities-api";

function city(partial: Partial<City> & Pick<City, "id">): City {
  return {
    name: partial.name ?? "Test",
    centroid: partial.centroid ?? { lng: 32, lat: 39 },
    controlling_tribe: partial.controlling_tribe ?? null,
    competing_tribes: partial.competing_tribes ?? [],
    ...partial,
  };
}

describe("cityMomentumBadge", () => {
  it("shows momentum at the flips threshold and hides below it", () => {
    expect(cityMomentumBadge({ flips_today: 1, current_streak_days: 0 })).toBeNull();
    expect(
      cityMomentumBadge({
        flips_today: MOMENTUM_FLIPS_DISPLAY_THRESHOLD,
        current_streak_days: 0,
      }),
    ).toEqual({ kind: "momentum", count: 2 });
  });

  it("shows streak at the days threshold when the city is not volatile", () => {
    expect(cityMomentumBadge({ flips_today: 0, current_streak_days: 4 })).toBeNull();
    expect(
      cityMomentumBadge({
        flips_today: 0,
        current_streak_days: STREAK_DAYS_DISPLAY_THRESHOLD,
      }),
    ).toEqual({ kind: "streak", count: 5 });
  });

  it("never returns both: flips win over streak", () => {
    expect(
      cityMomentumBadge({
        flips_today: 3,
        current_streak_days: 12,
      }),
    ).toEqual({ kind: "momentum", count: 3 });
  });
});

describe("selectMomentumBadges", () => {
  it("omits quiet cities so the overlay stays sparse", () => {
    const selected = selectMomentumBadges([
      city({ id: "34", flips_today: 3, current_streak_days: 0 }),
      city({ id: "06", flips_today: 0, current_streak_days: 8 }),
      city({ id: "35", flips_today: 1, current_streak_days: 2 }),
    ]);
    expect(selected.map((row) => [row.city.id, row.badge.kind])).toEqual([
      ["34", "momentum"],
      ["06", "streak"],
    ]);
  });
});
