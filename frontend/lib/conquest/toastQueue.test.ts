import { describe, expect, it } from "vitest";
import {
  dismissActiveToast,
  emptyToastQueue,
  enqueueToast,
  queuedCount,
  type CaptureToastItem,
} from "@/lib/conquest/toastQueue";

function item(id: string, city = `City ${id}`): CaptureToastItem {
  return {
    id,
    il_code: id.padStart(2, "0"),
    city_name: city,
    previous_tribe_id: null,
    new_tribe_id: "tribe-new",
    occurred_at: "2026-08-15T10:00:00Z",
    was_derbi_bonus: false,
  };
}

describe("toastQueue", () => {
  it("shows the first enqueue immediately and keeps later items pending", () => {
    let state = emptyToastQueue();
    state = enqueueToast(state, item("a"));
    state = enqueueToast(state, item("b"));
    state = enqueueToast(state, item("c"));

    expect(state.active?.id).toBe("a");
    expect(state.pending.map((p) => p.id)).toEqual(["b", "c"]);
    expect(queuedCount(state)).toBe(3);
  });

  it("does not drop or overlap: dismiss advances one at a time in order", () => {
    let state = emptyToastQueue();
    for (const id of ["a", "b", "c", "d"]) {
      state = enqueueToast(state, item(id));
    }
    const seen: string[] = [];
    while (state.active) {
      seen.push(state.active.id);
      state = dismissActiveToast(state);
    }
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(state.active).toBeNull();
    expect(state.pending).toEqual([]);
  });

  it("ignores duplicate ids so a replayed event does not double-queue", () => {
    let state = emptyToastQueue();
    state = enqueueToast(state, item("a"));
    state = enqueueToast(state, item("a"));
    state = enqueueToast(state, item("b"));
    state = enqueueToast(state, item("b"));
    expect(queuedCount(state)).toBe(2);
    expect(state.pending).toHaveLength(1);
  });
});
