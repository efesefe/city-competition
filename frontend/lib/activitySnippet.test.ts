import { describe, expect, it } from "vitest";
import { activityPlaceLabel, activityTribeLabel } from "@/lib/activitySnippet";

describe("activityPlaceLabel", () => {
  it("uses locative for Turkish locales", () => {
    expect(activityPlaceLabel("İzmir", "tr")).toBe("İzmir'de");
    expect(activityPlaceLabel("Ankara", "tr-TR")).toBe("Ankara'da");
    expect(activityPlaceLabel("Kars", "tr")).toBe("Kars'ta");
  });

  it("keeps the bare city name for English", () => {
    expect(activityPlaceLabel("İzmir", "en")).toBe("İzmir");
    expect(activityPlaceLabel("Ankara", "en-US")).toBe("Ankara");
  });
});

describe("activityTribeLabel", () => {
  it("prefers short_name then display_name then fallback", () => {
    expect(
      activityTribeLabel({ short_name: "GS", display_name: "Galatasaray" }),
    ).toBe("GS");
    expect(
      activityTribeLabel({ short_name: "  ", display_name: "Galatasaray" }),
    ).toBe("Galatasaray");
    expect(activityTribeLabel(null, "abcd1234")).toBe("abcd1234");
  });
});
