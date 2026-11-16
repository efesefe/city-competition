/**
 * Season 0 bounds (Europe/Istanbul) — locked calendar.
 * Soft-launch target: Thu 27 Nov 2026, 12:00 TR
 * End / scoreboard freeze: Sun 23 May 2027, 23:59 TR
 *
 * Tunables may override these defaults once admin season writes land.
 */

export type SeasonInfo = {
  id: string;
  label: string;
  /** Inclusive season start (ISO UTC). */
  startsAt: string;
  /** Inclusive season end (ISO UTC) — freeze instant. */
  endsAt: string;
  /** Human copy for boards: "23 May 2027, 23:59 TR" */
  endsAtLabelTr: string;
  timezone: "Europe/Istanbul";
};

/** Soft-launch go-live 2026-11-27 12:00 TR = 09:00 UTC (TR = UTC+3, no DST that day). */
export const SEASON_0_START_ISO = "2026-11-27T09:00:00.000Z";
/** 2027-05-23 23:59:59.999 TR = 20:59:59.999 UTC. */
export const SEASON_0_END_ISO = "2027-05-23T20:59:59.999Z";

export const SEASON_0: SeasonInfo = {
  id: "season-0",
  label: "Season 0",
  startsAt: SEASON_0_START_ISO,
  endsAt: SEASON_0_END_ISO,
  endsAtLabelTr: "23 May 2027, 23:59 TR",
  timezone: "Europe/Istanbul",
};

/** Active competitive season for scoreboard queries. */
export function currentSeason(): SeasonInfo {
  return SEASON_0;
}

export function seasonWindow(season: SeasonInfo = currentSeason()): {
  startsAt: string;
  endsAt: string;
} {
  return { startsAt: season.startsAt, endsAt: season.endsAt };
}

/** True when `iso` falls inside [startsAt, endsAt] inclusive. */
export function isWithinSeason(
  iso: string,
  season: SeasonInfo = currentSeason(),
): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(season.startsAt) && t <= Date.parse(season.endsAt);
}
