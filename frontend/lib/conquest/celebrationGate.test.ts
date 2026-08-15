import { describe, expect, it } from "vitest";
import {
  celebrationFromOwnSupport,
  rememberCelebratedId,
  shouldCelebrateOwnSupport,
  shouldCelebrateWitnessedFlip,
} from "@/lib/conquest/celebrationGate";

describe("celebrationGate", () => {
  it("celebrates only when caused_flip is true on the own support result", () => {
    expect(shouldCelebrateOwnSupport({ caused_flip: true })).toBe(true);
    expect(shouldCelebrateOwnSupport({ caused_flip: false })).toBe(false);
    expect(shouldCelebrateOwnSupport({})).toBe(false);
  });

  it("never celebrates a witnessed region_supported event", () => {
    expect(shouldCelebrateWitnessedFlip()).toBe(false);
  });

  it("builds a celebration only for the tipping support with a log id", () => {
    const event = celebrationFromOwnSupport(
      {
        caused_flip: true,
        conquest_log_id: "log-1",
        il_code: "06",
        tribe_id: "tribe-a",
      },
      { city_name: "Ankara", previous_tribe_id: "tribe-b" },
    );
    expect(event).toEqual({
      id: "log-1",
      il_code: "06",
      city_name: "Ankara",
      new_tribe_id: "tribe-a",
      previous_tribe_id: "tribe-b",
    });
  });

  it("returns null for a contributing spend that did not cross the threshold", () => {
    expect(
      celebrationFromOwnSupport(
        {
          caused_flip: false,
          conquest_log_id: null,
          il_code: "06",
        },
        { city_name: "Ankara" },
      ),
    ).toBeNull();
  });

  it("deduplicates celebration ids so HTTP + WS cannot double-fire", () => {
    const once = rememberCelebratedId(new Set(), "log-1");
    expect(once.has("log-1")).toBe(true);
    const again = rememberCelebratedId(once, "log-1");
    expect(again.size).toBe(1);
  });
});
