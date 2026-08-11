import { describe, expect, it } from "vitest";
import {
  NEUTRAL_TRIBE_COLOR,
  SHELL_DARK_BG,
  contrastRatio,
  tribeAccentColor,
  tribeAccentOnDark,
  tribeCrestInitial,
} from "@/lib/tribeCrest";

describe("tribeCrestInitial", () => {
  it("prefers short_name up to three chars", () => {
    expect(
      tribeCrestInitial({
        short_name: "SGT",
        display_name: "Siyah Gelgit",
        slug: "siyah-gelgit",
      }),
    ).toBe("SGT");
  });
});

describe("tribeAccentColor", () => {
  it("returns primary when valid", () => {
    expect(tribeAccentColor({ primary_color: "#111111" })).toBe("#111111");
  });

  it("falls back to neutral for invalid primary", () => {
    expect(tribeAccentColor({ primary_color: "red" })).toBe(NEUTRAL_TRIBE_COLOR);
    expect(tribeAccentColor(null)).toBe(NEUTRAL_TRIBE_COLOR);
  });
});

describe("tribeAccentOnDark", () => {
  it("keeps bright primary colors on the dark shell", () => {
    const accent = tribeAccentOnDark({
      primary_color: "#FFE014",
      secondary_color: "#00205B",
    });
    expect(accent).toBe("#FFE014");
    expect(contrastRatio(accent, SHELL_DARK_BG)!).toBeGreaterThanOrEqual(3);
  });

  it("uses secondary when primary is near-black (Siyah Gelgit)", () => {
    const accent = tribeAccentOnDark({
      primary_color: "#111111",
      secondary_color: "#FFFFFF",
    });
    expect(accent).toBe("#FFFFFF");
    expect(contrastRatio(accent, SHELL_DARK_BG)!).toBeGreaterThanOrEqual(3);
  });

  it("lightens dark primary when secondary is also dark", () => {
    const accent = tribeAccentOnDark({
      primary_color: "#6B0F1A",
      secondary_color: "#1B4D3E",
    });
    expect(accent).not.toBe("#6B0F1A");
    expect(accent).not.toBe("#1B4D3E");
    expect(contrastRatio(accent, SHELL_DARK_BG)!).toBeGreaterThanOrEqual(3);
  });
});
