/**
 * Season 0 economy clock is Europe/Istanbul (TR), not UTC.
 * Turkey permanently observes UTC+3 (no DST since 2016), but we still use the
 * IANA zone so the boundary stays correct if the zone rules ever change.
 */

export const TR_TIMEZONE = "Europe/Istanbul";

/** Calendar date in TR as `YYYY-MM-DD` (en-CA is ISO-like). */
export function trDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Wall-clock parts in Europe/Istanbul. */
export function trParts(d: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/**
 * Instant of the next 00:00 Europe/Istanbul strictly after `from`
 * (or `from` itself when it lands exactly on TR midnight).
 */
export function nextTrMidnight(from: Date = new Date()): Date {
  const parts = trParts(from);
  const atMidnight =
    parts.hour === 0 && parts.minute === 0 && parts.second === 0;
  // Search forward from "today 00:00 TR" or tomorrow if already past midnight.
  const startDayOffset = atMidnight ? 0 : 1;
  for (let add = startDayOffset; add < 4; add++) {
    const candidate = trLocalToUtc(
      parts.year,
      parts.month,
      parts.day + add,
      0,
      0,
      0,
    );
    if (candidate.getTime() >= from.getTime()) return candidate;
  }
  throw new Error("nextTrMidnight: failed to resolve");
}

/** Milliseconds until the next TR midnight boundary (0 if already there). */
export function msUntilNextTrMidnight(from: Date = new Date()): number {
  return Math.max(0, nextTrMidnight(from).getTime() - from.getTime());
}

/**
 * Convert a TR civil datetime to a UTC `Date` via binary search against Intl.
 * Handles the day overflow from `day + n` in {@link nextTrMidnight}.
 */
export function trLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  // Normalize day overflow (e.g. day 32) via a UTC probe date first.
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const target = {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
    hour,
    minute,
    second,
  };

  // TR is UTC+3 year-round today; search a ±36h window around that guess.
  let lo = Date.UTC(target.year, target.month - 1, target.day, hour, minute, second) - 36 * 3600_000;
  let hi = lo + 72 * 3600_000;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = trParts(new Date(mid));
    const cmp = compareParts(p, target);
    if (cmp === 0) return new Date(mid);
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  throw new Error(
    `trLocalToUtc: no match for ${target.year}-${target.month}-${target.day} ${hour}:${minute}:${second} TR`,
  );
}

function compareParts(
  a: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  b: { year: number; month: number; day: number; hour: number; minute: number; second: number },
): number {
  return (
    a.year - b.year ||
    a.month - b.month ||
    a.day - b.day ||
    a.hour - b.hour ||
    a.minute - b.minute ||
    a.second - b.second
  );
}
