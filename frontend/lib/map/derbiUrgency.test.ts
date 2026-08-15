import { describe, expect, it } from "vitest";
import { BANNER_SCHEDULED_SOON_MS } from "@/lib/derbiBanner";
import { formatTime } from "@/lib/dateFormat";
import {
  DERBI_FILL_INTENSITY_MUTED,
  derbiChipCopy,
  derbiFillColorPaint,
  derbiFillOpacityPaint,
  cityFillUnderlayOpacityPaint,
  isUrgencyEligible,
  nextUrgencyTransitionMs,
  selectUrgencyDerbies,
  urgencyIlCodes,
} from "@/lib/map/derbiUrgency";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function derby(partial: {
  id?: string;
  il_code?: string;
  status: string;
  starts_at?: string;
  ends_at?: string;
}) {
  return {
    id: partial.id ?? "d1",
    host_tribe_id: "host",
    guest_tribe_id: "guest",
    il_code: partial.il_code ?? "34",
    starts_at: partial.starts_at ?? "2026-08-11T10:00:00.000Z",
    ends_at: partial.ends_at ?? "2026-08-11T14:00:00.000Z",
    status: partial.status,
    host_effective_total: 0,
    guest_effective_total: 0,
    created_by_admin_id: "a",
    created_at: "2026-08-11T09:00:00.000Z",
  };
}

describe("isUrgencyEligible", () => {
  it("includes active derbies before ends_at", () => {
    expect(isUrgencyEligible(derby({ status: "active" }), NOW)).toBe(true);
  });

  it("excludes active derbies whose ends_at has passed", () => {
    expect(
      isUrgencyEligible(
        derby({
          status: "active",
          ends_at: "2026-08-11T11:59:00.000Z",
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("includes scheduled derbies within 24h", () => {
    expect(
      isUrgencyEligible(
        derby({
          status: "scheduled",
          starts_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(NOW + 4 * 60 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes scheduled derbies more than 24h away", () => {
    expect(
      isUrgencyEligible(
        derby({
          status: "scheduled",
          starts_at: new Date(
            NOW + BANNER_SCHEDULED_SOON_MS + 60_000,
          ).toISOString(),
          ends_at: new Date(
            NOW + BANNER_SCHEDULED_SOON_MS + 2 * 60 * 60 * 1000,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("keeps a scheduled derby whose start has passed until ends_at (poll lag)", () => {
    expect(
      isUrgencyEligible(
        derby({
          status: "scheduled",
          starts_at: "2026-08-11T11:59:00.000Z",
          ends_at: "2026-08-11T14:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes resolved derbies", () => {
    expect(isUrgencyEligible(derby({ status: "resolved" }), NOW)).toBe(false);
  });
});

describe("selectUrgencyDerbies", () => {
  it("returns one derby per il_code and prefers active", () => {
    const scheduled = derby({
      id: "soon",
      status: "scheduled",
      starts_at: new Date(NOW + 60_000).toISOString(),
      ends_at: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
    });
    const active = derby({ id: "live", status: "active" });
    const otherCity = derby({
      id: "ank",
      il_code: "06",
      status: "active",
      ends_at: "2026-08-11T13:00:00.000Z",
    });
    const selected = selectUrgencyDerbies(
      [scheduled, active, otherCity, derby({ id: "done", status: "resolved" })],
      NOW,
    );
    expect(selected.map((d) => d.id).sort()).toEqual(["ank", "live"]);
  });

  it("exposes il_codes for feature-state sync", () => {
    expect(
      [...urgencyIlCodes([derby({ status: "active" })], NOW)],
    ).toEqual(["34"]);
  });
});

describe("derbiChipCopy", () => {
  it("uses compact remaining hours and minutes while active", () => {
    expect(derbiChipCopy(derby({ status: "active" }), NOW)).toEqual({
      kind: "remaining",
      hours: 2,
      minutes: 0,
    });
  });

  it("omits hours when less than 60 minutes remain", () => {
    expect(
      derbiChipCopy(
        derby({
          status: "active",
          ends_at: "2026-08-11T12:14:00.000Z",
        }),
        NOW,
      ),
    ).toEqual({ kind: "remainingMinutes", minutes: 14 });
  });

  it("uses soon plus start time for scheduled-but-not-started derbies", () => {
    const starts_at = "2026-08-11T14:30:00.000Z";
    expect(
      derbiChipCopy(
        derby({
          status: "scheduled",
          starts_at,
          ends_at: "2026-08-11T16:00:00.000Z",
        }),
        NOW,
      ),
    ).toEqual({ kind: "soon", time: formatTime(starts_at) });
  });
});

describe("nextUrgencyTransitionMs", () => {
  it("returns ends_at for an active derby so styling can clear immediately", () => {
    expect(
      nextUrgencyTransitionMs([derby({ status: "active" })], NOW),
    ).toBe(Date.parse("2026-08-11T14:00:00.000Z"));
  });

  it("returns the 24h window open for a far-future scheduled derby", () => {
    const starts = NOW + BANNER_SCHEDULED_SOON_MS + 2 * 60 * 60 * 1000;
    expect(
      nextUrgencyTransitionMs(
        [
          derby({
            status: "scheduled",
            starts_at: new Date(starts).toISOString(),
            ends_at: new Date(starts + 2 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBe(starts - BANNER_SCHEDULED_SOON_MS);
  });
});

describe("derbi fill paint", () => {
  it("branches saturation on derbi_active feature-state", () => {
    const color = JSON.stringify(derbiFillColorPaint());
    expect(color).toContain("derbi_active");
    expect(color).toContain("interpolate-hcl");
    expect(color).toContain(String(DERBI_FILL_INTENSITY_MUTED));
    const opacity = JSON.stringify(derbiFillOpacityPaint());
    expect(opacity).toContain("derbi_active");
  });

  it("hides the solid underlay once kit stripes are showing", () => {
    const opacity = JSON.stringify(cityFillUnderlayOpacityPaint());
    expect(opacity).toContain("striped");
    expect(opacity).toContain("derbi_active");
  });
});
