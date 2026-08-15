import { describe, expect, it } from "vitest";
import {
  PRESENCE_TTL_MS,
  expireStaleOnlineIds,
  formatApproximateCount,
  isMemberOnline,
  replaceOnlineIds,
  userAvatarPath,
} from "@/lib/presence";

describe("formatApproximateCount", () => {
  it("groups thousands with a tr-TR dot", () => {
    expect(formatApproximateCount(1240, "tr")).toBe("1.240");
  });

  it("groups thousands with an en-US comma", () => {
    expect(formatApproximateCount(1240, "en")).toBe("1,240");
  });

  it("never emits a fractional string", () => {
    expect(formatApproximateCount(3.9, "tr")).toBe("4");
    expect(formatApproximateCount(1240.7, "en")).toBe("1,241");
    expect(formatApproximateCount(1000.4, "tr")).toBe("1.000");
  });

  it("does not include a tilde (i18n supplies ~)", () => {
    expect(formatApproximateCount(1240, "tr")).not.toContain("~");
    expect(formatApproximateCount(3, "en")).toBe("3");
  });

  it("clamps non-finite and negative values to 0", () => {
    expect(formatApproximateCount(Number.NaN, "tr")).toBe("0");
    expect(formatApproximateCount(-12, "en")).toBe("0");
  });
});

describe("replaceOnlineIds", () => {
  it("replaces rather than unions, lowercasing ids", () => {
    const first = replaceOnlineIds(["AAA", "bbb"]);
    expect([...first].sort()).toEqual(["aaa", "bbb"]);
    const second = replaceOnlineIds(["CCC"]);
    expect([...second]).toEqual(["ccc"]);
    expect(second.has("aaa")).toBe(false);
  });

  it("drops blank and non-string entries", () => {
    const ids = replaceOnlineIds(["  ", "", 12, null, "ok-id"]);
    expect([...ids]).toEqual(["ok-id"]);
  });
});

describe("expireStaleOnlineIds", () => {
  const ids = new Set(["a"]);

  it("clears when last success is older than TTL", () => {
    expect(expireStaleOnlineIds(ids, 0, PRESENCE_TTL_MS + 1).size).toBe(0);
  });

  it("keeps ids within the TTL window", () => {
    expect(expireStaleOnlineIds(ids, 10, 10 + PRESENCE_TTL_MS).has("a")).toBe(
      true,
    );
  });

  it("clears when there was never a successful poll", () => {
    expect(expireStaleOnlineIds(ids, null, 1_000).size).toBe(0);
  });
});

describe("isMemberOnline / userAvatarPath", () => {
  it("matches sender ids case-insensitively", () => {
    const online = replaceOnlineIds(["AbC-def"]);
    expect(isMemberOnline("abc-def", online)).toBe(true);
    expect(isMemberOnline("zzz", online)).toBe(false);
  });

  it("builds the canonical avatar path", () => {
    expect(userAvatarPath("u1")).toBe("/v1/users/u1/avatar");
  });
});
