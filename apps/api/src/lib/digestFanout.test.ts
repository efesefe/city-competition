import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OwnershipDigestCity } from "./bus.js";
import { mergeDigestCity, spendFanoutMode } from "./game.js";

function city(
  partial: Partial<OwnershipDigestCity> & Pick<OwnershipDigestCity, "plate">,
): OwnershipDigestCity {
  return {
    ownerTeamId: "gs",
    ownerAlias: "Cim Bom",
    ownerColor: "#E74C3C",
    leadSupport: 100,
    rivalSupport: 80,
    leadMargin: 20,
    ...partial,
  };
}

describe("spendFanoutMode", () => {
  it("publishes support-only when ownership did not flip", () => {
    assert.equal(spendFanoutMode(false), "support-only");
  });

  it("publishes support+digest after an ownership flip", () => {
    assert.equal(spendFanoutMode(true), "support+digest");
  });
});

describe("mergeDigestCity", () => {
  it("replaces a single plate without touching others", () => {
    const before = [city({ plate: "06", leadSupport: 10 }), city({ plate: "34", leadSupport: 50 })];
    const patched = mergeDigestCity(before, city({ plate: "34", leadSupport: 65, leadMargin: 15 }));
    assert.equal(patched.length, 2);
    assert.equal(patched.find((c) => c.plate === "06")?.leadSupport, 10);
    assert.equal(patched.find((c) => c.plate === "34")?.leadSupport, 65);
    assert.equal(patched.find((c) => c.plate === "34")?.leadMargin, 15);
  });

  it("appends a missing plate in plate order", () => {
    const before = [city({ plate: "06" }), city({ plate: "34" })];
    const patched = mergeDigestCity(before, city({ plate: "16", leadSupport: 1 }));
    assert.deepEqual(
      patched.map((c) => c.plate),
      ["06", "16", "34"],
    );
  });
});
