import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createDebouncedRefetch,
  isDerbiTabVisible,
  isRecentlyResolved,
  RECENTLY_RESOLVED_MS,
  selectPrimaryDerby,
  shouldShowYourRankFooter,
} from "@/lib/leaderboardVisibility";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function derby(partial: {
  status: string;
  ends_at: string;
  id?: string;
}) {
  return {
    id: partial.id ?? "d1",
    host_tribe_id: "h",
    guest_tribe_id: "g",
    il_code: "34",
    starts_at: "2026-08-11T10:00:00.000Z",
    ends_at: partial.ends_at,
    status: partial.status,
    host_effective_total: 0,
    guest_effective_total: 0,
    created_by_admin_id: "a",
    created_at: "2026-08-11T09:00:00.000Z",
  };
}

describe("isRecentlyResolved", () => {
  it("is true within 24h after ends_at", () => {
    expect(
      isRecentlyResolved(
        derby({
          status: "resolved",
          ends_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is false after 24h window", () => {
    expect(
      isRecentlyResolved(
        derby({
          status: "resolved",
          ends_at: new Date(NOW - RECENTLY_RESOLVED_MS - 1).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is false for active/scheduled", () => {
    expect(
      isRecentlyResolved(
        derby({ status: "active", ends_at: new Date(NOW + 3600_000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isDerbiTabVisible", () => {
  it("hides when only scheduled or old resolved", () => {
    expect(
      isDerbiTabVisible(
        [
          derby({
            status: "scheduled",
            ends_at: new Date(NOW + 86_400_000).toISOString(),
          }),
          derby({
            status: "resolved",
            ends_at: new Date(NOW - RECENTLY_RESOLVED_MS - 1000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it("shows for active derby", () => {
    expect(
      isDerbiTabVisible(
        [
          derby({
            status: "active",
            ends_at: new Date(NOW + 3600_000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it("shows for recently resolved", () => {
    expect(
      isDerbiTabVisible(
        [
          derby({
            status: "resolved",
            ends_at: new Date(NOW - 2 * 3600_000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBe(true);
  });
});

describe("selectPrimaryDerby", () => {
  it("prefers active over recently resolved", () => {
    const active = derby({
      id: "active",
      status: "active",
      ends_at: new Date(NOW + 3600_000).toISOString(),
    });
    const resolved = derby({
      id: "resolved",
      status: "resolved",
      ends_at: new Date(NOW - 1000).toISOString(),
    });
    expect(selectPrimaryDerby([resolved, active], NOW)?.id).toBe("active");
  });

  it("picks most recently ended when all resolved", () => {
    const older = derby({
      id: "older",
      status: "resolved",
      ends_at: new Date(NOW - 10 * 3600_000).toISOString(),
    });
    const newer = derby({
      id: "newer",
      status: "resolved",
      ends_at: new Date(NOW - 1000).toISOString(),
    });
    expect(selectPrimaryDerby([older, newer], NOW)?.id).toBe("newer");
  });

  it("returns null when none qualify", () => {
    expect(
      selectPrimaryDerby(
        [
          derby({
            status: "scheduled",
            ends_at: new Date(NOW + 86_400_000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("shouldShowYourRankFooter", () => {
  it("shows when viewer is not in visible entries", () => {
    expect(
      shouldShowYourRankFooter(
        [{ user_id: "u1" }, { user_id: "u2" }],
        { rank: 99, score: 1 },
        "me",
      ),
    ).toBe(true);
  });

  it("hides when viewer row is visible", () => {
    expect(
      shouldShowYourRankFooter(
        [{ user_id: "me" }, { user_id: "u2" }],
        { rank: 1, score: 10 },
        "me",
      ),
    ).toBe(false);
  });

  it("hides without me or viewer", () => {
    expect(shouldShowYourRankFooter([{ user_id: "u1" }], null, "me")).toBe(
      false,
    );
    expect(
      shouldShowYourRankFooter([{ user_id: "u1" }], { rank: 2, score: 1 }, null),
    ).toBe(false);
  });
});

describe("createDebouncedRefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces multiple triggers into one refetch", async () => {
    const refetch = vi.fn();
    const { trigger, cancel } = createDebouncedRefetch(refetch, 300);
    trigger();
    trigger();
    trigger();
    expect(refetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(refetch).toHaveBeenCalledTimes(1);
    cancel();
  });
});
