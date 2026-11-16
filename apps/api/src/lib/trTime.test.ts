import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  msUntilNextTrMidnight,
  nextTrMidnight,
  trDateString,
  trLocalToUtc,
  trParts,
  TR_TIMEZONE,
} from "./trTime.js";

describe("trTime Europe/Istanbul", () => {
  it("exports the locked Season 0 timezone", () => {
    assert.equal(TR_TIMEZONE, "Europe/Istanbul");
  });

  it("formats TR calendar dates as YYYY-MM-DD", () => {
    // 2026-03-15 22:30 UTC = 2026-03-16 01:30 TR (UTC+3)
    const d = new Date("2026-03-15T22:30:00.000Z");
    assert.equal(trDateString(d), "2026-03-16");
    const parts = trParts(d);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 3);
    assert.equal(parts.day, 16);
    assert.equal(parts.hour, 1);
  });

  it("keeps the previous UTC day when still before TR midnight", () => {
    // 2026-03-15 20:59 UTC = 2026-03-15 23:59 TR
    const d = new Date("2026-03-15T20:59:00.000Z");
    assert.equal(trDateString(d), "2026-03-15");
  });

  it("rolls the TR date at 00:00 Istanbul (21:00 UTC previous day)", () => {
    const before = new Date("2026-06-10T20:59:59.000Z");
    const after = new Date("2026-06-10T21:00:00.000Z");
    assert.equal(trDateString(before), "2026-06-10");
    assert.equal(trDateString(after), "2026-06-11");
  });

  it("resolves next TR midnight across the UTC day boundary", () => {
    const from = new Date("2026-06-10T12:00:00.000Z"); // 15:00 TR
    const next = nextTrMidnight(from);
    assert.equal(trDateString(next), "2026-06-11");
    assert.deepEqual(trParts(next), {
      year: 2026,
      month: 6,
      day: 11,
      hour: 0,
      minute: 0,
      second: 0,
    });
    assert.equal(msUntilNextTrMidnight(from), next.getTime() - from.getTime());
  });

  it("returns from itself when already at TR midnight", () => {
    const midnight = trLocalToUtc(2026, 11, 16, 0, 0, 0);
    assert.equal(nextTrMidnight(midnight).getTime(), midnight.getTime());
    assert.equal(msUntilNextTrMidnight(midnight), 0);
  });
});
