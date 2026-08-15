import { describe, expect, it } from "vitest";
import { accusative, locative } from "@/lib/i18n/turkishSuffix";

describe("locative", () => {
  it("applies vowel-harmony suffixes to province names", () => {
    const cases: Array<[string, string]> = [
      ["İzmir", "İzmir'de"],
      ["Eskişehir", "Eskişehir'de"],
      ["Rize", "Rize'de"],
      ["Artvin", "Artvin'de"],
      ["Çanakkale", "Çanakkale'de"],
      ["Mersin", "Mersin'de"],
      ["Denizli", "Denizli'de"],
      ["Ankara", "Ankara'da"],
      ["İstanbul", "İstanbul'da"],
      ["Bursa", "Bursa'da"],
      ["Trabzon", "Trabzon'da"],
      ["Aydın", "Aydın'da"],
      ["Antalya", "Antalya'da"],
      ["Giresun", "Giresun'da"],
      ["Bolu", "Bolu'da"],
      ["Van", "Van'da"],
      ["Tekirdağ", "Tekirdağ'da"],
      ["Kars", "Kars'ta"],
      ["Muş", "Muş'ta"],
      ["Bitlis", "Bitlis'te"],
      ["Siirt", "Siirt'te"],
    ];
    for (const [input, want] of cases) {
      expect(locative(input), input).toBe(want);
    }
  });

  it("keeps the proper-noun stem before the apostrophe", () => {
    for (const name of ["İzmir", "Ankara", "Kars", "Bitlis"]) {
      const got = locative(name);
      const idx = got.lastIndexOf("'");
      expect(idx).toBeGreaterThan(0);
      expect(got.slice(0, idx)).toBe(name);
      expect(["de", "da", "te", "ta"]).toContain(got.slice(idx + 1));
    }
  });

  it("falls back to 'da for unclassifiable names", () => {
    for (const input of ["", "   ", "bcd", "xyz", "123"]) {
      expect(locative(input).endsWith("'da")).toBe(true);
    }
  });
});

describe("accusative", () => {
  it("applies vowel-harmony suffixes and y-buffer after vowels", () => {
    const cases: Array<[string, string]> = [
      ["İzmir", "İzmir'i"],
      ["Eskişehir", "Eskişehir'i"],
      ["Rize", "Rize'yi"],
      ["Artvin", "Artvin'i"],
      ["Çanakkale", "Çanakkale'yi"],
      ["Mersin", "Mersin'i"],
      ["Denizli", "Denizli'yi"],
      ["Ankara", "Ankara'yı"],
      ["İstanbul", "İstanbul'u"],
      ["Bursa", "Bursa'yı"],
      ["Trabzon", "Trabzon'u"],
      ["Aydın", "Aydın'ı"],
      ["Antalya", "Antalya'yı"],
      ["Giresun", "Giresun'u"],
      ["Bolu", "Bolu'yu"],
      ["Van", "Van'ı"],
      ["Tekirdağ", "Tekirdağ'ı"],
      ["Kars", "Kars'ı"],
      ["Muş", "Muş'u"],
      ["Bitlis", "Bitlis'i"],
      ["Siirt", "Siirt'i"],
    ];
    for (const [input, want] of cases) {
      expect(accusative(input), input).toBe(want);
    }
  });

  it("keeps the proper-noun stem before the apostrophe", () => {
    for (const name of ["İzmir", "Ankara", "Rize", "Bolu"]) {
      const got = accusative(name);
      const idx = got.lastIndexOf("'");
      expect(idx).toBeGreaterThan(0);
      expect(got.slice(0, idx)).toBe(name);
    }
  });

  it("falls back to 'ı for unclassifiable names", () => {
    for (const input of ["", "   ", "bcd", "xyz", "123"]) {
      expect(accusative(input).endsWith("'ı")).toBe(true);
    }
  });
});
