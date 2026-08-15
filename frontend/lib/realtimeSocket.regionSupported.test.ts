import { describe, expect, it } from "vitest";
import { parseRealtimeSocketEvent } from "@/lib/realtimeSocket";

describe("parseRealtimeSocketEvent region_supported", () => {
  it("accepts a full flip payload including a null previous tribe", () => {
    const event = parseRealtimeSocketEvent({
      type: "region_supported",
      id: "11111111-1111-4111-8111-111111111111",
      il_code: "06",
      city_name: "Ankara",
      previous_tribe_id: null,
      new_tribe_id: "22222222-2222-4222-8222-222222222222",
      winning_committed_credits: 40,
      occurred_at: "2026-08-15T10:00:00Z",
      was_derbi_bonus: false,
    });
    expect(event?.type).toBe("region_supported");
    if (event?.type === "region_supported") {
      expect(event.city_name).toBe("Ankara");
      expect(event.previous_tribe_id).toBeNull();
      expect(event.il_code).toBe("06");
    }
  });

  it("drops unknown or incomplete frames", () => {
    expect(parseRealtimeSocketEvent({ type: "activity_feed" })).toBeNull();
    expect(
      parseRealtimeSocketEvent({
        type: "region_supported",
        id: "x",
        il_code: "06",
      }),
    ).toBeNull();
  });
});
