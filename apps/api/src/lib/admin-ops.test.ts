import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SEASON_0_END,
  DEFAULT_SEASON_0_START,
  GATED_PURPOSES,
} from "./admin-ops.js";
import { CITY_SEEDS } from "../data/city-seeds.js";
import { TEAMS, TEAM_BY_ALIAS, registerTeam, teamsForPicker } from "../data/teams.js";

describe("admin OTP gated purposes (CC-52)", () => {
  it("covers prices, economy, season, and seed writes", () => {
    assert.deepEqual([...GATED_PURPOSES].sort(), [
      "economy_tunables",
      "pack_prices",
      "season_bounds",
      "seed_write",
    ]);
  });

  it("locks Season 0 soft-launch → 23 May 2027 defaults (CC-71)", () => {
    assert.equal(DEFAULT_SEASON_0_START, "2026-11-27T09:00:00.000Z");
    assert.equal(DEFAULT_SEASON_0_END, "2027-05-23T20:59:00.000Z");
    const endTr = new Date(DEFAULT_SEASON_0_END);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(endTr);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    assert.equal(`${get("year")}-${get("month")}-${get("day")}`, "2027-05-23");
    assert.equal(`${get("hour")}:${get("minute")}`, "23:59");
  });
});

describe("aliases + seed matrix (CC-54)", () => {
  it("ships 18 Süper Lig Kabile aliases", () => {
    assert.equal(TEAMS.length, 18);
    assert.ok(TEAM_BY_ALIAS.has("Aslan Kabilesi"));
    assert.ok(TEAM_BY_ALIAS.has("Hitit Kabilesi"));
  });

  it("ships draft-final 81-city seed matrix", () => {
    assert.equal(CITY_SEEDS.length, 81);
    for (const city of CITY_SEEDS) {
      assert.ok(city.seeds.length >= 2 && city.seeds.length <= 3);
      for (const s of city.seeds) {
        assert.ok(TEAM_BY_ALIAS.has(s.alias), `missing alias ${s.alias} for ${city.plate}`);
      }
    }
  });

  it("registerTeam exposes ticket-accepted aliases in picker", () => {
    registerTeam({
      internalId: "sl_ticket_test",
      publicAlias: "Deneme Kabilesi",
      primary: "#111111",
      secondary: "#eeeeee",
      big4: false,
    });
    assert.ok(teamsForPicker().some((t) => t.internalId === "sl_ticket_test"));
  });
});
