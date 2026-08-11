import { describe, expect, it } from "vitest";
import {
  BANNER_SCHEDULED_SOON_MS,
  isBannerEligible,
  isScheduledSoon,
  selectBannerDerby,
  tribeParticipates,
} from "@/lib/derbiBanner";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const TRIBE = "tribe-a";
const OTHER = "tribe-b";
const OUTSIDER = "tribe-c";

function derby(partial: {
  id?: string;
  status: string;
  starts_at?: string;
  ends_at?: string;
  host_tribe_id?: string;
  guest_tribe_id?: string;
}) {
  return {
    id: partial.id ?? "d1",
    host_tribe_id: partial.host_tribe_id ?? TRIBE,
    guest_tribe_id: partial.guest_tribe_id ?? OTHER,
    il_code: "34",
    starts_at: partial.starts_at ?? "2026-08-11T10:00:00.000Z",
    ends_at: partial.ends_at ?? "2026-08-11T14:00:00.000Z",
    status: partial.status,
    host_effective_total: 0,
    guest_effective_total: 0,
    created_by_admin_id: "a",
    created_at: "2026-08-11T09:00:00.000Z",
  };
}

describe("tribeParticipates", () => {
  it("matches host or guest only", () => {
    const d = derby({ status: "active" });
    expect(tribeParticipates(d, TRIBE)).toBe(true);
    expect(tribeParticipates(d, OTHER)).toBe(true);
    expect(tribeParticipates(d, OUTSIDER)).toBe(false);
    expect(tribeParticipates(d, null)).toBe(false);
  });
});

describe("isScheduledSoon", () => {
  it("is true within 24h window", () => {
    expect(
      isScheduledSoon(
        derby({
          status: "scheduled",
          starts_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is false outside window", () => {
    expect(
      isScheduledSoon(
        derby({
          status: "scheduled",
          starts_at: new Date(
            NOW + BANNER_SCHEDULED_SOON_MS + 60_000,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isBannerEligible", () => {
  it("includes active and scheduled-soon", () => {
    expect(
      isBannerEligible(
        derby({
          status: "active",
          ends_at: new Date(NOW + 3_600_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isBannerEligible(
        derby({
          status: "resolved",
          ends_at: new Date(NOW - 60_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("selectBannerDerby", () => {
  it("hides events for non-participating tribes", () => {
    expect(
      selectBannerDerby(
        [derby({ status: "active", id: "live" })],
        OUTSIDER,
        NOW,
      ),
    ).toBeNull();
  });

  it("prefers active over scheduled", () => {
    const selected = selectBannerDerby(
      [
        derby({
          id: "soon",
          status: "scheduled",
          starts_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
          ends_at: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
        }),
        derby({
          id: "live",
          status: "active",
          starts_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
          ends_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      TRIBE,
      NOW,
    );
    expect(selected?.id).toBe("live");
  });

  it("picks soonest scheduled when none active", () => {
    const selected = selectBannerDerby(
      [
        derby({
          id: "later",
          status: "scheduled",
          starts_at: new Date(NOW + 6 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(NOW + 8 * 60 * 60 * 1000).toISOString(),
        }),
        derby({
          id: "sooner",
          status: "scheduled",
          starts_at: new Date(NOW + 1 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      TRIBE,
      NOW,
    );
    expect(selected?.id).toBe("sooner");
  });

  it("returns null once resolved", () => {
    expect(
      selectBannerDerby(
        [
          derby({
            id: "done",
            status: "resolved",
            ends_at: new Date(NOW - 60_000).toISOString(),
          }),
        ],
        TRIBE,
        NOW,
      ),
    ).toBeNull();
  });
});
