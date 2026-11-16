import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankCaptureCandidates, rankFightCandidates, type CityMargin } from "./tutorial.js";

function city(partial: Partial<CityMargin> & Pick<CityMargin, "plate">): CityMargin {
  return {
    nameTr: partial.plate,
    ownerTeamId: "sl_fenerbahce",
    leadMargin: 40,
    leadSupport: 400,
    secondSupport: 360,
    teamCount: 3,
    playerSupport: 0,
    ...partial,
  };
}

describe("rankCaptureCandidates", () => {
  it("picks thin mid-seed margins not owned by the player", () => {
    const tribe = "sl_besiktas";
    const ranked = rankCaptureCandidates(
      [
        city({ plate: "42", leadMargin: 620, leadSupport: 900, ownerTeamId: "sl_konyaspor" }),
        city({ plate: "10", leadMargin: 20, leadSupport: 360, playerSupport: 320 }),
        city({ plate: "16", leadMargin: 30, leadSupport: 480, playerSupport: 420 }),
        city({ plate: "99", leadMargin: 20, ownerTeamId: tribe }),
      ],
      tribe,
      15,
    );
    assert.equal(ranked[0]?.plate, "10");
    assert.ok(ranked.every((c) => c.ownerTeamId !== tribe));
  });
});

describe("rankFightCandidates", () => {
  it("prefers contested hot cities and excludes capture plate", () => {
    const ranked = rankFightCandidates(
      [
        city({ plate: "34", leadMargin: 20, leadSupport: 1000, teamCount: 3 }),
        city({ plate: "10", leadMargin: 20, leadSupport: 360, teamCount: 3 }),
        city({ plate: "61", leadMargin: 720, leadSupport: 1000, teamCount: 3 }),
      ],
      "sl_amed",
      "10",
    );
    assert.equal(ranked[0]?.plate, "34");
    assert.ok(ranked.every((c) => c.plate !== "10"));
  });
});
