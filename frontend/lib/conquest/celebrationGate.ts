export type OwnSupportForCelebration = {
  caused_flip?: boolean;
  conquest_log_id?: string | null;
  il_code: string;
  tribe_id?: string;
};

export type CelebrationEvent = {
  id: string;
  il_code: string;
  city_name: string;
  new_tribe_id: string;
  previous_tribe_id: string | null;
};

/**
 * Own-capture celebration fires only when the support POST says this spend
 * was the tipping contribution. Witnessed region_supported events never pass.
 */
export function shouldCelebrateOwnSupport(
  result: Pick<OwnSupportForCelebration, "caused_flip">,
): boolean {
  return result.caused_flip === true;
}

export function shouldCelebrateWitnessedFlip(): boolean {
  return false;
}

export function celebrationFromOwnSupport(
  result: OwnSupportForCelebration,
  extras: {
    city_name: string;
    new_tribe_id?: string;
    previous_tribe_id?: string | null;
  },
): CelebrationEvent | null {
  if (!shouldCelebrateOwnSupport(result)) {
    return null;
  }
  const id = result.conquest_log_id;
  if (!id) {
    return null;
  }
  return {
    id,
    il_code: result.il_code,
    city_name: extras.city_name,
    new_tribe_id: extras.new_tribe_id ?? result.tribe_id ?? "",
    previous_tribe_id: extras.previous_tribe_id ?? null,
  };
}

export function rememberCelebratedId(
  seen: ReadonlySet<string>,
  id: string,
): Set<string> {
  if (seen.has(id)) {
    return new Set(seen);
  }
  const next = new Set(seen);
  next.add(id);
  return next;
}
