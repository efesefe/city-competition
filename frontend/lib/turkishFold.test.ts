import { describe, expect, it } from "vitest";
import {
  compareTurkish,
  foldTurkish,
  matchesTurkishSearch,
} from "@/lib/turkishFold";

describe("foldTurkish", () => {
  it("folds İstanbul variants to the same key", () => {
    expect(foldTurkish("İstanbul")).toBe(foldTurkish("istanbul"));
    expect(foldTurkish("ISTANBUL")).toBe(foldTurkish("istanbul"));
    expect(foldTurkish("İSTANBUL")).toBe(foldTurkish("istanbul"));
  });
});

describe("matchesTurkishSearch", () => {
  it("matches folded substrings and ids", () => {
    expect(matchesTurkishSearch("ist", "İstanbul")).toBe(true);
    expect(matchesTurkishSearch("ISTANBUL", "İstanbul")).toBe(true);
    expect(matchesTurkishSearch("34", "Ankara", "34")).toBe(true);
    expect(matchesTurkishSearch("izm", "İstanbul")).toBe(false);
  });

  it("treats empty query as match-all", () => {
    expect(matchesTurkishSearch("", "İstanbul")).toBe(true);
    expect(matchesTurkishSearch("   ", "Ankara")).toBe(true);
  });
});

describe("compareTurkish", () => {
  it("sorts sample city names in Turkish alphabetical order", () => {
    const names = ["İstanbul", "Ankara", "İzmir", "Bursa", "Adana"];
    const sorted = [...names].sort(compareTurkish);
    expect(sorted).toEqual(["Adana", "Ankara", "Bursa", "İstanbul", "İzmir"]);
  });
});
