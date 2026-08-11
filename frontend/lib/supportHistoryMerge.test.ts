import { describe, expect, it } from "vitest";
import type { SupportHistoryItem } from "@/lib/support-api";
import { mergeSupportHistoryPages } from "@/lib/supportHistoryMerge";

function row(id: string, offsetHint = 0): SupportHistoryItem {
  return {
    id,
    il_code: "34",
    tribe_id: "tribe-a",
    credits_spent: 10 + offsetHint,
    multiplier: 1,
    effective_support: 10 + offsetHint,
    created_at: new Date(Date.UTC(2026, 0, 1, 12, offsetHint)).toISOString(),
  };
}

describe("mergeSupportHistoryPages", () => {
  it("appends new rows without duplicating ids across pages", () => {
    const page1 = [row("a"), row("b"), row("c")];
    const page2Overlap = [row("c"), row("d"), row("e")];
    const merged = mergeSupportHistoryPages(page1, page2Overlap);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns existing when incoming is empty", () => {
    const existing = [row("a")];
    expect(mergeSupportHistoryPages(existing, [])).toEqual(existing);
  });

  it("keeps first occurrence when duplicates appear in the same page", () => {
    const existing = [row("a", 1)];
    const incoming = [row("a", 99), row("b")];
    const merged = mergeSupportHistoryPages(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[0].credits_spent).toBe(11);
    expect(merged[1].id).toBe("b");
  });
});
