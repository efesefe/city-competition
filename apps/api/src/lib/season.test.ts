import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEASON_0,
  SEASON_0_END_ISO,
  SEASON_0_START_ISO,
  currentSeason,
  isWithinSeason,
  seasonWindow,
} from "./season.js";

describe("Season 0 bounds", () => {
  it("exposes locked soft-launch start and May 2027 freeze", () => {
    const s = currentSeason();
    assert.equal(s.id, "season-0");
    assert.equal(s.label, "Season 0");
    assert.equal(s.startsAt, SEASON_0_START_ISO);
    assert.equal(s.endsAt, SEASON_0_END_ISO);
    assert.equal(s.endsAtLabelTr, "23 May 2027, 23:59 TR");
    assert.equal(s.timezone, "Europe/Istanbul");
  });

  it("seasonWindow mirrors current season", () => {
    assert.deepEqual(seasonWindow(), {
      startsAt: SEASON_0.startsAt,
      endsAt: SEASON_0.endsAt,
    });
  });

  it("includes soft-launch go-live instant", () => {
    assert.equal(isWithinSeason("2026-11-27T09:00:00.000Z"), true);
  });

  it("includes end freeze instant", () => {
    assert.equal(isWithinSeason("2027-05-23T20:59:59.999Z"), true);
  });

  it("excludes spends before Season 0", () => {
    assert.equal(isWithinSeason("2026-11-27T08:59:59.999Z"), false);
  });

  it("excludes spends after freeze", () => {
    assert.equal(isWithinSeason("2027-05-23T21:00:00.000Z"), false);
  });

  it("rejects invalid timestamps", () => {
    assert.equal(isWithinSeason("not-a-date"), false);
  });
});
