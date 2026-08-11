import { describe, expect, it } from "vitest";
import { groupPackOffers, providersForSurface } from "@/lib/packOffers";
import type { CreditPack } from "@/lib/topup-api";

const packs: CreditPack[] = [
  { provider: "papara", product_id: "credits_100", credits: 100, amount_kurus: 999 },
  { provider: "iyzico", product_id: "credits_100", credits: 100, amount_kurus: 999 },
  { provider: "apple", product_id: "credits_100", credits: 100, amount_kurus: 999 },
  { provider: "papara", product_id: "credits_500", credits: 500, amount_kurus: 4499 },
  { provider: "papara", product_id: "credits_1200", credits: 1200, amount_kurus: 9999 },
  { provider: "google", product_id: "credits_1200", credits: 1200, amount_kurus: 9999 },
];

describe("groupPackOffers", () => {
  it("groups by product_id and frames bonus on better value packs", () => {
    const offers = groupPackOffers(packs);
    expect(offers.map((o) => o.product_id)).toEqual([
      "credits_100",
      "credits_500",
      "credits_1200",
    ]);
    const big = offers.find((o) => o.product_id === "credits_1200");
    expect(big?.bonus_percent).toBeGreaterThanOrEqual(10);
    const small = offers.find((o) => o.product_id === "credits_100");
    expect(small?.bonus_percent).toBe(0);
  });
});

describe("providersForSurface", () => {
  it("filters web vs native providers", () => {
    const offers = groupPackOffers(packs);
    const small = offers.find((o) => o.product_id === "credits_100")!;
    expect(providersForSurface(small, "web")).toEqual(
      expect.arrayContaining(["iyzico", "papara"]),
    );
    expect(providersForSurface(small, "web")).not.toContain("apple");
    expect(providersForSurface(small, "ios")).toEqual(["apple"]);
    const big = offers.find((o) => o.product_id === "credits_1200")!;
    expect(providersForSurface(big, "android")).toEqual(["google"]);
  });
});
