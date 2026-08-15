import type { City, CompetingTribe, ControllingTribe } from "@/lib/cities-api";
import { contestTension } from "@/lib/map/contestTension";
import { NEUTRAL_TRIBE_COLOR } from "@/lib/tribeCrest";

function rosterOrNeutral(
  tribeColorsById: Record<string, string>,
  tribeId: string,
): string {
  return tribeColorsById[tribeId] || NEUTRAL_TRIBE_COLOR;
}

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
    controlling = {
      tribe_id: leader.tribe_id,
      // Never inherit the previous owner's color on a leadership change.
      primary_color: sameLeader
        ? (city.controlling_tribe?.primary_color ??
          rosterOrNeutral(tribeColorsById, leader.tribe_id))
        : rosterOrNeutral(tribeColorsById, leader.tribe_id),
    };
  }

  return {
    ...city,
    competing_tribes: competing,
    controlling_tribe: controlling,
    contest_tension: contestTension(competing),
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

export type RegionFlipPatch = {
  new_tribe_id: string;
  winning_committed_credits: number;
};

/**
 * Apply an authoritative ownership flip from `region_supported`.
 * Bumps the winner's score to at least the server total, then forces
 * controlling_tribe to the new tribe's roster color (never the previous owner).
 */
export function patchCityRegionFlip(
  city: City,
  flip: RegionFlipPatch,
  tribeColorsById: Record<string, string>,
): City {
  const competing = [...(city.competing_tribes ?? [])];
  const idx = competing.findIndex((c) => c.tribe_id === flip.new_tribe_id);
  const nextCredits = Math.max(
    idx >= 0 ? competing[idx].committed_credits : 0,
    flip.winning_committed_credits,
  );
  if (idx >= 0) {
    competing[idx] = { ...competing[idx], committed_credits: nextCredits };
  } else {
    competing.push({
      tribe_id: flip.new_tribe_id,
      committed_credits: nextCredits,
    });
  }

  const reconciled = reconcileCityControl(
    { ...city, competing_tribes: competing },
    tribeColorsById,
  );
  return {
    ...reconciled,
    controlling_tribe: {
      tribe_id: flip.new_tribe_id,
      primary_color: rosterOrNeutral(tribeColorsById, flip.new_tribe_id),
    },
  };
}
