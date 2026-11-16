import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERSONAL_BOOST_DURATION_MS,
  PERSONAL_BOOST_MULT,
  TEAM_BOOST_MULT,
  creditedSupport,
  isPersonalBoostActive,
  personalExpiryFromNow,
  type BoostSnapshot,
} from "./boost.js";

const none: BoostSnapshot = {
  personalBoostPct: 1,
  teamBoostPct: 1,
  personalExpiresAt: null,
  teamWindowEndsAt: null,
};

describe("isPersonalBoostActive", () => {
  it("false when expiry missing", () => {
    assert.equal(isPersonalBoostActive(null), false);
    assert.equal(isPersonalBoostActive(undefined), false);
  });

  it("true while expires_at is in the future", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    const expires = new Date(now + 60_000).toISOString();
    assert.equal(isPersonalBoostActive(expires, now), true);
  });

  it("false at exact expiry and after", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    const expires = new Date(now).toISOString();
    assert.equal(isPersonalBoostActive(expires, now), false);
    assert.equal(isPersonalBoostActive(expires, now + 1), false);
  });
});

describe("personalExpiryFromNow", () => {
  it("is +1h from now by default", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    assert.equal(
      personalExpiryFromNow(now),
      new Date(now + PERSONAL_BOOST_DURATION_MS).toISOString(),
    );
    assert.equal(PERSONAL_BOOST_DURATION_MS, 3_600_000);
  });
});

describe("creditedSupport stacking", () => {
  it("base spend with no boost equals energy", () => {
    assert.equal(creditedSupport(20, none), 20);
    assert.equal(creditedSupport(15, none), 15);
  });

  it("personal only: +50% → ×1.5", () => {
    const boost: BoostSnapshot = { ...none, personalBoostPct: PERSONAL_BOOST_MULT };
    assert.equal(creditedSupport(20, boost), 30);
    assert.equal(PERSONAL_BOOST_MULT, 1.5);
  });

  it("team only: +25% → ×1.25", () => {
    const boost: BoostSnapshot = { ...none, teamBoostPct: TEAM_BOOST_MULT };
    assert.equal(creditedSupport(20, boost), 25);
    assert.equal(TEAM_BOOST_MULT, 1.25);
  });

  it("personal × team: 20 × 1.5 × 1.25 = 37.5", () => {
    const boost: BoostSnapshot = {
      personalBoostPct: PERSONAL_BOOST_MULT,
      teamBoostPct: TEAM_BOOST_MULT,
      personalExpiresAt: "2026-11-16T13:00:00.000Z",
      teamWindowEndsAt: "2026-11-16T14:00:00.000Z",
    };
    assert.equal(creditedSupport(20, boost), 37.5);
  });

  it("rounds to 3 decimal places", () => {
    const boost: BoostSnapshot = {
      ...none,
      personalBoostPct: PERSONAL_BOOST_MULT,
      teamBoostPct: TEAM_BOOST_MULT,
    };
    // 11 × 1.5 × 1.25 = 20.625
    assert.equal(creditedSupport(11, boost), 20.625);
  });
});
