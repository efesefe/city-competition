import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTION_COST_BAND,
  ACTION_COST_DEFAULT,
  ACTION_COST_MAX,
  ACTION_COST_MIN,
  adminApiKeyConfigured,
  adminKeyAuthorized,
  coerceActionCost,
  parseActionCost,
} from "./actionCost.js";

describe("action cost band 10–20", () => {
  it("locks mid-band default at 15", () => {
    assert.equal(ACTION_COST_MIN, 10);
    assert.equal(ACTION_COST_MAX, 20);
    assert.equal(ACTION_COST_DEFAULT, 15);
    assert.equal(ACTION_COST_BAND.default, 15);
    assert.equal(
      ACTION_COST_DEFAULT,
      Math.floor((ACTION_COST_MIN + ACTION_COST_MAX) / 2),
    );
  });

  it("accepts integers on the band edges and mid", () => {
    assert.deepEqual(parseActionCost(10), { ok: true, value: 10 });
    assert.deepEqual(parseActionCost(15), { ok: true, value: 15 });
    assert.deepEqual(parseActionCost(20), { ok: true, value: 20 });
    assert.deepEqual(parseActionCost("12"), { ok: true, value: 12 });
  });

  it("rejects out-of-band and non-integers", () => {
    assert.equal(parseActionCost(9).ok, false);
    assert.equal(parseActionCost(21).ok, false);
    assert.equal(parseActionCost(15.5).ok, false);
    assert.equal(parseActionCost("nope").ok, false);
    assert.equal(parseActionCost(null).ok, false);
    const bad = parseActionCost(99);
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.error, "out_of_band");
      assert.equal(bad.min, 10);
      assert.equal(bad.max, 20);
    }
  });

  it("coerces corrupt stored values to mid-band default", () => {
    assert.equal(coerceActionCost("15"), 15);
    assert.equal(coerceActionCost("7"), ACTION_COST_DEFAULT);
    assert.equal(coerceActionCost("99"), ACTION_COST_DEFAULT);
    assert.equal(coerceActionCost(undefined), ACTION_COST_DEFAULT);
    assert.equal(coerceActionCost("abc"), ACTION_COST_DEFAULT);
  });
});

describe("admin API key gate", () => {
  it("requires ADMIN_API_KEY and matching x-admin-key", () => {
    const prev = process.env.ADMIN_API_KEY;
    try {
      delete process.env.ADMIN_API_KEY;
      assert.equal(adminApiKeyConfigured(), false);
      assert.equal(adminKeyAuthorized("anything"), false);

      process.env.ADMIN_API_KEY = "secret-ops";
      assert.equal(adminApiKeyConfigured(), true);
      assert.equal(adminKeyAuthorized("secret-ops"), true);
      assert.equal(adminKeyAuthorized("wrong"), false);
      assert.equal(adminKeyAuthorized(undefined), false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = prev;
    }
  });
});
