import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "../lib/dateFormat";

describe("dateFormat", () => {
  // Fixed instant: 2024-06-15 14:30:00 UTC = 17:30 Europe/Istanbul (UTC+3 in summer)
  const fixed = new Date("2024-06-15T14:30:00.000Z");

  it("formats DD.MM.YYYY in Europe/Istanbul", () => {
    expect(formatDate(fixed)).toBe("15.06.2024");
  });

  it("formats HH:mm 24h in Europe/Istanbul", () => {
    expect(formatTime(fixed)).toBe("17:30");
  });

  it("formats combined date-time", () => {
    expect(formatDateTime(fixed)).toBe("15.06.2024 17:30");
  });
});
