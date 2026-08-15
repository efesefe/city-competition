import { describe, expect, it, vi } from "vitest";
import {
  applyLiveFlip,
  applyMarkAllRead,
  applyServerUnread,
  syncConquestLogVisit,
} from "@/lib/conquest/unread";
import type { ConquestLogEntry } from "@/lib/conquest-api";

function entry(id: string): ConquestLogEntry {
  return {
    id,
    il_code: "06",
    city_name: "Ankara",
    previous_tribe_id: null,
    new_tribe_id: "tribe-a",
    winning_committed_credits: 40,
    occurred_at: "2026-08-15T10:00:00Z",
    was_derbi_bonus: false,
    caused_flip: false,
  };
}

describe("conquest unread visit", () => {
  it("clears unread after visiting the log and does not double-count on a later visit", async () => {
    const rows = [entry("old-1"), entry("old-2"), entry("old-3")];
    let cursorRead = false;
    let markReadCalls = 0;
    let liveAfterRead = 0;

    const api = {
      list: vi.fn(async () => ({
        entries: rows,
        next_offset: null,
      })),
      markReadAll: vi.fn(async () => {
        markReadCalls += 1;
        cursorRead = true;
        return { updated: 1 };
      }),
      unreadCount: vi.fn(async () => ({
        unread_count: cursorRead ? liveAfterRead : 3,
      })),
    };

    const first = await syncConquestLogVisit(api);
    expect(first.entries).toHaveLength(3);
    expect(first.unreadCount).toBe(0);
    expect(markReadCalls).toBe(1);
    expect(applyMarkAllRead()).toEqual({ unread_count: 0 });

    const second = await syncConquestLogVisit(api);
    expect(second.entries.map((e) => e.id)).toEqual(["old-1", "old-2", "old-3"]);
    expect(second.unreadCount).toBe(0);
    expect(markReadCalls).toBe(2);
    expect(api.list).toHaveBeenCalledTimes(2);

    liveAfterRead = 1;
    const afterNewFlip = applyLiveFlip(
      applyServerUnread({ unread_count: second.unreadCount }, 0),
    );
    expect(afterNewFlip.unread_count).toBe(1);
  });

  it("applies a live flip on top of the last server count", () => {
    const afterVisit = applyMarkAllRead();
    expect(applyLiveFlip(afterVisit).unread_count).toBe(1);
    expect(applyServerUnread(afterVisit, 0).unread_count).toBe(0);
  });
});
