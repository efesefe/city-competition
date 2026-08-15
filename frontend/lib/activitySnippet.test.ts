import { describe, expect, it } from "vitest";
import { activityPlaceLabel, activityTribeLabel } from "@/lib/activitySnippet";

describe("activityPlaceLabel", () => {
  it("uses locative for Turkish support events", () => {
    expect(activityPlaceLabel("İzmir", "tr")).toBe("İzmir'de");
    expect(activityPlaceLabel("Ankara", "tr-TR", "large_support")).toBe(
      "Ankara'da",
    );
    expect(activityPlaceLabel("Kars", "tr", "derby_support")).toBe("Kars'ta");
  });

  it("uses accusative for Turkish conquest events", () => {
    expect(activityPlaceLabel("İzmir", "tr", "conquest")).toBe("İzmir'i");
    expect(activityPlaceLabel("Ankara", "tr-TR", "conquest")).toBe("Ankara'yı");
    expect(activityPlaceLabel("İstanbul", "tr", "conquest")).toBe("İstanbul'u");
  });

  it("keeps the bare city name for English", () => {
    expect(activityPlaceLabel("İzmir", "en")).toBe("İzmir");
    expect(activityPlaceLabel("Ankara", "en-US", "conquest")).toBe("Ankara");
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
