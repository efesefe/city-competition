import type { City, CompetingTribe, ControllingTribe } from "@/lib/cities-api";

/**
 * Derive controlling_tribe from competing_tribes (score leader).
 * Used on hydrate so map ownership survives persona switch / reload even if
 * the API controlling field lags behind live scores.
 */
export function reconcileCityControl(
  city: City,
  tribeColorsById: Record<string, string>,
): City {
  const competing = [...(city.competing_tribes ?? [])].sort(
    (a, b) => b.committed_credits - a.committed_credits,
  );
  const leader = competing[0];
  let controlling: ControllingTribe = null;
  if (leader && leader.committed_credits > 0) {
    const sameLeader = city.controlling_tribe?.tribe_id === leader.tribe_id;
    const colorFromRoster = tribeColorsById[leader.tribe_id];
    controlling = {
      tribe_id: leader.tribe_id,
      primary_color: sameLeader
        ? (city.controlling_tribe?.primary_color ?? colorFromRoster)
        : (colorFromRoster ?? city.controlling_tribe?.primary_color),
    };
  }

  return {
    ...city,
    competing_tribes: competing,
    controlling_tribe: controlling,
  };
}

/** Apply a support delta and resolve controlling tribe color from the roster. */
export function patchCitySupport(
  city: City,
  tribeId: string,
  delta: number,
  tribeColorsById: Record<string, string>,
): City {
  const competing = [...(city.competing_tribes ?? [])];
  const idx = competing.findIndex((c) => c.tribe_id === tribeId);
  if (idx >= 0) {
    const next: CompetingTribe = {
      ...competing[idx],
      committed_credits: competing[idx].committed_credits + delta,
    };
    competing[idx] = next;
  } else {
    competing.push({ tribe_id: tribeId, committed_credits: delta });
  }

  return reconcileCityControl(
    { ...city, competing_tribes: competing },
    tribeColorsById,
  );
}
