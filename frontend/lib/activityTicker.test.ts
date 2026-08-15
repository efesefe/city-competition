import { describe, expect, it } from "vitest";
import type { ActivityFeedItem } from "@/lib/activity-feed-api";
import {
  ACTIVITY_FEED_CAP,
  appendActivityItem,
  toChronological,
} from "@/lib/activityTicker";

function item(id: string, city = "Ankara"): ActivityFeedItem {
  return {
    id,
    kind: "large_support",
    il_code: "06",
    city_name: city,
    tribe_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    previous_tribe_id: null,
    credits: 50,
    was_derbi_bonus: false,
    occurred_at: "2026-08-15T10:00:00Z",
  };
}

describe("toChronological", () => {
  it("reverses newest-first API order to oldest-first for the ticker", () => {
    expect(toChronological([item("c"), item("b"), item("a")]).map((e) => e.id)).toEqual(
      ["a", "b", "c"],
    );
  });
});

describe("appendActivityItem", () => {
  it("ignores duplicates and appends new items at the entry edge", () => {
    const seeded = [item("a"), item("b")];
    expect(appendActivityItem(seeded, item("b"))).toBe(seeded);
    expect(appendActivityItem(seeded, item("c")).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("drops the oldest items when over cap", () => {
    const seeded = Array.from({ length: ACTIVITY_FEED_CAP }, (_, i) =>
      item(`id-${i}`),
    );
    const next = appendActivityItem(seeded, item("new"));
    expect(next).toHaveLength(ACTIVITY_FEED_CAP);
    expect(next[0].id).toBe("id-1");
    expect(next[next.length - 1].id).toBe("new");
  });
});
