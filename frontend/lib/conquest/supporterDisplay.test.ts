import { describe, expect, it } from "vitest";
import { API_BASE } from "@/lib/auth-api";
import type { ConquestSupporter } from "@/lib/conquest-api";
import {
  hueFromUserId,
  moreCount,
  rankedSupporters,
  resolveAvatarSrc,
  supporterInitials,
} from "@/lib/conquest/supporterDisplay";

function supporter(
  partial: Partial<ConquestSupporter> & Pick<ConquestSupporter, "user_id">,
): ConquestSupporter {
  return {
    display_name: "player",
    avatar_url: "/v1/users/x/avatar",
    contribution: 10,
    is_you: false,
    ...partial,
  };
}

describe("rankedSupporters", () => {
  it("assigns 1-based ranks in the given array order without re-sorting", () => {
    const input = [
      supporter({ user_id: "low", contribution: 5, display_name: "low" }),
      supporter({ user_id: "high", contribution: 90, display_name: "high" }),
      supporter({ user_id: "mid", contribution: 20, display_name: "mid" }),
    ];
    const ranked = rankedSupporters(input);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((r) => r.supporter.user_id)).toEqual([
      "low",
      "high",
      "mid",
    ]);
    expect(ranked.map((r) => r.supporter.contribution)).toEqual([5, 90, 20]);
  });
});

describe("moreCount", () => {
  it("is total minus returned, floored at zero", () => {
    expect(moreCount(12, 10)).toBe(2);
    expect(moreCount(10, 10)).toBe(0);
    expect(moreCount(3, 10)).toBe(0);
    expect(moreCount(0, 0)).toBe(0);
  });
});

describe("supporterInitials", () => {
  it("takes 1–2 Turkish-uppercased letters and skips spaces", () => {
    expect(supporterInitials("şeyma")).toBe("ŞE");
    expect(supporterInitials("ı")).toBe("I");
    expect(supporterInitials("i")).toBe("İ");
    expect(supporterInitials("A B")).toBe("AB");
    expect(supporterInitials("x")).toBe("X");
    expect(supporterInitials("")).toBe("?");
    expect(supporterInitials("   ")).toBe("?");
  });
});

describe("resolveAvatarSrc", () => {
  it("prefixes relative paths with API_BASE", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(resolveAvatarSrc(`/v1/users/${id}/avatar`)).toBe(
      `${API_BASE.replace(/\/$/, "")}/v1/users/${id}/avatar`,
    );
  });

  it("passes through absolute and data URLs", () => {
    expect(resolveAvatarSrc("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(resolveAvatarSrc("data:image/png;base64,abc")).toBe(
      "data:image/png;base64,abc",
    );
  });

  it("returns empty for a blank url", () => {
    expect(resolveAvatarSrc("")).toBe("");
    expect(resolveAvatarSrc("   ")).toBe("");
  });
});

describe("hueFromUserId", () => {
  it("matches the first-4-bytes modulo 360 of a UUID", () => {
    expect(hueFromUserId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      0x550e8400 % 360,
    );
  });
});
