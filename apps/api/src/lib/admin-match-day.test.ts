import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TEAM_BOOST_PCT,
  MATCH_BOOST_POST_MS,
  MATCH_BOOST_PRE_MS,
  isAdminRole,
  windowFromFixture,
} from "./admin-match-day.js";
import { TEAM_BOOST_MULT } from "./boost.js";

describe("windowFromFixture (kickoff−1h → FT+30m)", () => {
  it("defaults to −1h / +30m around kickoff and FT", () => {
    const kickoff = "2026-11-27T17:00:00.000Z";
    const ft = "2026-11-27T18:50:00.000Z";
    const w = windowFromFixture({ kickoffAt: kickoff, fullTimeAt: ft });
    assert.ok(!("error" in w));
    assert.equal(w.startsAt, new Date(Date.parse(kickoff) - MATCH_BOOST_PRE_MS).toISOString());
    assert.equal(w.endsAt, new Date(Date.parse(ft) + MATCH_BOOST_POST_MS).toISOString());
    assert.equal(MATCH_BOOST_PRE_MS, 3_600_000);
    assert.equal(MATCH_BOOST_POST_MS, 1_800_000);
  });

  it("rejects FT at or before kickoff", () => {
    const w = windowFromFixture({
      kickoffAt: "2026-11-27T17:00:00.000Z",
      fullTimeAt: "2026-11-27T17:00:00.000Z",
    });
    assert.deepEqual(w, { error: "invalid_fixture_times" });
  });
});

describe("admin match-day constants", () => {
  it("default team boost is +25% (1.25)", () => {
    assert.equal(DEFAULT_TEAM_BOOST_PCT, 1.25);
    assert.equal(DEFAULT_TEAM_BOOST_PCT, TEAM_BOOST_MULT);
  });

  it("isAdminRole only accepts admin", () => {
    assert.equal(isAdminRole("admin"), true);
    assert.equal(isAdminRole("player"), false);
    assert.equal(isAdminRole(undefined), false);
  });
});
