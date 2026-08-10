import type { City, CompetingTribe } from "@/lib/cities-api";

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
  competing.sort((a, b) => b.committed_credits - a.committed_credits);

  const leader = competing[0];
  let controlling = city.controlling_tribe;
  if (leader && leader.committed_credits > 0) {
    const sameLeader = controlling?.tribe_id === leader.tribe_id;
    const colorFromRoster = tribeColorsById[leader.tribe_id];
    controlling = {
      tribe_id: leader.tribe_id,
      primary_color: sameLeader
        ? (controlling?.primary_color ?? colorFromRoster)
        : colorFromRoster,
    };
  } else {
    controlling = null;
  }

  return {
    ...city,
    competing_tribes: competing,
    controlling_tribe: controlling,
  };
}
