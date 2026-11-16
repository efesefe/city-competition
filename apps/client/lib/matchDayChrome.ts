import type { MatchDayEvent } from "./api";

/**
 * Prefer an active boost window for the viewer's tribe (banner copy).
 * Guests / other tribes still get map spotlight from any spotlighted event.
 */
export function selectBannerEvent(
  events: MatchDayEvent[],
  tribeId: string | null | undefined,
  nowMs = Date.now(),
): MatchDayEvent | null {
  const live = events.filter((e) => {
    const ends = Date.parse(e.endsAt);
    return Number.isFinite(ends) ? ends > nowMs : true;
  });
  if (live.length === 0) return null;
  if (tribeId) {
    const mine = live.filter((e) => e.teamId === tribeId);
    if (mine.length > 0) {
      return [...mine].sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0]!;
    }
  }
  return null;
}

/** One spotlight plate per city; latest-ending event wins ties. */
export function selectSpotlightPlates(
  events: MatchDayEvent[],
  nowMs = Date.now(),
): Set<string> {
  const byPlate = new Map<string, MatchDayEvent>();
  for (const e of events) {
    if (!e.spotlightPlate) continue;
    const ends = Date.parse(e.endsAt);
    if (Number.isFinite(ends) && ends <= nowMs) continue;
    const prev = byPlate.get(e.spotlightPlate);
    if (!prev || Date.parse(e.endsAt) > Date.parse(prev.endsAt)) {
      byPlate.set(e.spotlightPlate, e);
    }
  }
  return new Set(byPlate.keys());
}

export function boostPctLabel(boostPct: number): string {
  const pct = Math.round((boostPct - 1) * 100);
  if (pct <= 0) return "+0%";
  return `+${pct}%`;
}

export function formatCountdown(endsAt: string, nowMs = Date.now()): string {
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return "—";
  const ms = Math.max(0, ends - nowMs);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}s ${String(m).padStart(2, "0")}dk`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
