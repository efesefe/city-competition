import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupportAppliedMessage } from "@/lib/realtimeSocket";
import { createDebouncedRefetch } from "@/lib/leaderboardVisibility";

/**
 * Integration-style: a support_applied event schedules a board refetch
 * within the same debounce latency budget used by map live updates (~300ms).
 */
describe("leaderboard live update on support_applied", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches the active board after support_applied within 300ms", async () => {
    const fetchBoard = vi.fn().mockResolvedValue({
      entries: [{ rank: 1, user_id: "u1", username: "ace", score: 42 }],
      limit: 50,
      me: { rank: 1, score: 42 },
    });

    const { trigger, cancel } = createDebouncedRefetch(() => {
      void fetchBoard();
    }, 300);

    const listeners = new Set<(e: SupportAppliedMessage) => void>();
    const subscribe = (listener: (e: SupportAppliedMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };

    const unsub = subscribe((event) => {
      if (event.type !== "support_applied") return;
      trigger();
    });

    // Initial HTTP paint already done — WS should not wait for first paint.
    expect(fetchBoard).toHaveBeenCalledTimes(0);

    const t0 = performance.now();
    for (const listener of listeners) {
      listener({
        type: "support_applied",
        il_code: "34",
        tribe_id: "tribe-a",
        delta: 10,
      });
    }

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchBoard).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchBoard).toHaveBeenCalledTimes(1);

    const elapsed = performance.now() - t0;
    // Fake timers: assert debounce budget, not wall clock.
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(fetchBoard.mock.calls.length).toBe(1);

    unsub();
    cancel();
  });

  it("coalesces burst of support_applied into one refetch", async () => {
    const fetchBoard = vi.fn().mockResolvedValue({ entries: [], limit: 50 });
    const { trigger, cancel } = createDebouncedRefetch(() => {
      void fetchBoard();
    }, 300);

    for (let i = 0; i < 5; i++) {
      trigger();
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    cancel();
  });
});
