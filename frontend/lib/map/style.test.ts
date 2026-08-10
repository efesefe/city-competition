import { describe, expect, it } from "vitest";
import { TURKIYE_MAP_STYLE } from "@/lib/map/style";

describe("TURKIYE_MAP_STYLE", () => {
  it("has sea background only — no fake land rectangle", () => {
    expect(TURKIYE_MAP_STYLE.layers).toHaveLength(1);
    expect(TURKIYE_MAP_STYLE.layers[0].id).toBe("background");
    expect(TURKIYE_MAP_STYLE.sources).toEqual({});
    const ids = TURKIYE_MAP_STYLE.layers.map((l) => l.id);
    expect(ids).not.toContain("land-fill");
  });
});
