import { describe, expect, it, vi } from "vitest";
import {
  clampCredits,
  ownershipBarSegments,
  submitSupportOptimistic,
} from "@/lib/map/supportSubmit";
import type { SupportResult } from "@/lib/api/support";

describe("clampCredits", () => {
  it("clamps to [1, balance] and floors", () => {
    expect(clampCredits(10, 100)).toBe(10);
    expect(clampCredits(150, 100)).toBe(100);
    expect(clampCredits(0, 100)).toBe(0);
    expect(clampCredits(-5, 100)).toBe(0);
    expect(clampCredits(10.9, 100)).toBe(10);
    expect(clampCredits(10, 0)).toBe(0);
    expect(clampCredits(Number.NaN, 50)).toBe(0);
  });
});

describe("ownershipBarSegments", () => {
  it("returns share fractions by committed credits", () => {
    const segs = ownershipBarSegments(
      [
        { tribe_id: "a", committed_credits: 75 },
        { tribe_id: "b", committed_credits: 25 },
      ],
      { a: "#111", b: "#222" },
      "#666",
    );
    expect(segs).toHaveLength(2);
    expect(segs[0].share).toBe(0.75);
    expect(segs[1].share).toBe(0.25);
    expect(segs[0].color).toBe("#111");
  });

  it("returns empty when total is zero", () => {
    expect(
      ownershipBarSegments(
        [{ tribe_id: "a", committed_credits: 0 }],
        {},
        "#666",
      ),
    ).toEqual([]);
  });
});

describe("submitSupportOptimistic", () => {
  const baseResult: SupportResult = {
    support_id: "s1",
    il_code: "34",
    credits_spent: 10,
    multiplier: 1,
    effective_support: 10,
    tribe_id: "tribe-a",
    balance_after: 90,
  };

  it("applies optimistic deltas and reconciles on success", async () => {
    const applyOptimisticDelta = vi.fn();
    const reconcileBalance = vi.fn();
    const applySupportDelta = vi.fn();
    const registerPendingSupport = vi.fn();
    const consumePendingSupport = vi.fn(() => true);
    const postSupport = vi.fn(async () => baseResult);

    const outcome = await submitSupportOptimistic(
      { ilCode: "34", tribeId: "tribe-a", credits: 10, derbiActive: false },
      {
        postSupport,
        applyOptimisticDelta,
        reconcileBalance,
        applySupportDelta,
        registerPendingSupport,
        consumePendingSupport,
      },
    );

    expect(outcome.ok).toBe(true);
    expect(applyOptimisticDelta).toHaveBeenCalledWith(-10);
    expect(applySupportDelta).toHaveBeenCalledWith("34", "tribe-a", 10);
    expect(registerPendingSupport).toHaveBeenCalledWith("34", "tribe-a", 10);
    expect(reconcileBalance).toHaveBeenCalledWith(90);
    expect(consumePendingSupport).not.toHaveBeenCalled();
  });

  it("doubles expected city delta when derbi is active", async () => {
    const applySupportDelta = vi.fn();
    const registerPendingSupport = vi.fn();
    await submitSupportOptimistic(
      { ilCode: "34", tribeId: "tribe-a", credits: 10, derbiActive: true },
      {
        postSupport: vi.fn(async () => ({
          ...baseResult,
          multiplier: 2,
          effective_support: 20,
        })),
        applyOptimisticDelta: vi.fn(),
        reconcileBalance: vi.fn(),
        applySupportDelta,
        registerPendingSupport,
        consumePendingSupport: vi.fn(() => true),
      },
    );
    expect(applySupportDelta).toHaveBeenCalledWith("34", "tribe-a", 20);
    expect(registerPendingSupport).toHaveBeenCalledWith("34", "tribe-a", 20);
  });

  it("rolls back wallet and city bar on insufficient_credits", async () => {
    const applyOptimisticDelta = vi.fn();
    const reconcileBalance = vi.fn();
    const applySupportDelta = vi.fn();
    const registerPendingSupport = vi.fn();
    const consumePendingSupport = vi.fn(() => true);
    const postSupport = vi.fn(async () => {
      throw Object.assign(new Error("insufficient_credits"), {
        code: "insufficient_credits",
      });
    });

    const outcome = await submitSupportOptimistic(
      { ilCode: "34", tribeId: "tribe-a", credits: 10, derbiActive: false },
      {
        postSupport,
        applyOptimisticDelta,
        reconcileBalance,
        applySupportDelta,
        registerPendingSupport,
        consumePendingSupport,
      },
    );

    expect(outcome).toEqual({ ok: false, code: "insufficient_credits" });
    expect(applyOptimisticDelta).toHaveBeenCalledWith(-10);
    expect(applyOptimisticDelta).toHaveBeenCalledWith(10);
    expect(applySupportDelta).toHaveBeenNthCalledWith(1, "34", "tribe-a", 10);
    expect(applySupportDelta).toHaveBeenNthCalledWith(2, "34", "tribe-a", -10);
    expect(consumePendingSupport).toHaveBeenCalledWith("34", "tribe-a", 10);
    expect(reconcileBalance).not.toHaveBeenCalled();
  });
});
