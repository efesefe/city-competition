import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/tribeCrest";
import {
  EMBLEM_GLYPHS,
  TRIBE_EMBLEM_BY_SLUG,
  tribeEmblemGlyph,
  tribeEmblemKey,
  tribeMarkColor,
} from "@/lib/tribeEmblem";

const SEEDED_SLUGS: Record<string, keyof typeof EMBLEM_GLYPHS> = {
  "kizil-ruzgar": "lion",
  "sari-dalga": "canary",
  "siyah-gelgit": "eagle",
  "bordo-firtina": "storm",
  "turkuaz-ufuk": "wave",
  "kirmizi-pusula": "compass",
  "turuncu-sahil": "sun",
  "yesil-ovalar": "crocodile",
  "lacivert-zirve": "mountain",
  "mor-isik": "crescent",
};

describe("tribeEmblemKey", () => {
  it("maps all ten seeded parody tribes", () => {
    expect(Object.keys(TRIBE_EMBLEM_BY_SLUG)).toHaveLength(10);
    for (const [slug, key] of Object.entries(SEEDED_SLUGS)) {
      expect(tribeEmblemKey(slug)).toBe(key);
      const glyph = tribeEmblemGlyph(slug);
      expect(glyph?.paths.length).toBeGreaterThan(0);
      expect(EMBLEM_GLYPHS[key].paths.length).toBeGreaterThan(0);
    }
  });

  it("returns null for unknown slugs", () => {
    expect(tribeEmblemKey("test-tribe")).toBeNull();
    expect(tribeEmblemGlyph("other")).toBeNull();
    expect(tribeEmblemKey(null)).toBeNull();
  });
});

describe("tribeMarkColor", () => {
  it("uses white on near-black fills (Siyah Gelgit)", () => {
    const mark = tribeMarkColor({
      primary_color: "#111111",
      secondary_color: "#FFFFFF",
    });
    expect(mark).toBe("#ffffff");
    expect(contrastRatio(mark, "#111111")!).toBeGreaterThanOrEqual(3);
  });

  it("uses secondary on light yellow fills (Sarı Dalga)", () => {
    const mark = tribeMarkColor({
      primary_color: "#FFE014",
      secondary_color: "#00205B",
    });
    expect(mark).toBe("#00205B");
    expect(contrastRatio(mark, "#FFE014")!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#ffffff", "#FFE014")!).toBeLessThan(3);
  });

  it("uses white on saturated red fills (Kızıl Rüzgar)", () => {
    const mark = tribeMarkColor({
      primary_color: "#C8102E",
      secondary_color: "#FFD100",
    });
    expect(mark).toBe("#ffffff");
    expect(contrastRatio(mark, "#C8102E")!).toBeGreaterThanOrEqual(3);
  });

  it("falls back to near-black when neither white nor secondary contrast", () => {
    const mark = tribeMarkColor({
      primary_color: "#F5F5F5",
      secondary_color: "#EEEEEE",
    });
    expect(mark).toBe("#111111");
    expect(contrastRatio(mark, "#F5F5F5")!).toBeGreaterThanOrEqual(3);
  });
});
