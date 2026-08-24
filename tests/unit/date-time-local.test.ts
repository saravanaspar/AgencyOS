import { describe, expect, it } from "vitest";

import { toDateTimeLocalValue } from "@/lib/date-time-local";

describe("datetime-local values", () => {
  it("preserves positive-offset local wall-clock time", () => {
    expect(toDateTimeLocalValue("2026-07-21T10:15:00.000Z", "Asia/Kolkata")).toBe(
      "2026-07-21T15:45",
    );
  });

  it("preserves daylight-saving and standard-time wall-clock values", () => {
    expect(toDateTimeLocalValue("2026-01-15T15:00:00.000Z", "America/New_York")).toBe(
      "2026-01-15T10:00",
    );
    expect(toDateTimeLocalValue("2026-07-15T14:00:00.000Z", "America/New_York")).toBe(
      "2026-07-15T10:00",
    );
  });

  it("returns an empty value for missing, invalid, or invalid-timezone input", () => {
    expect(toDateTimeLocalValue(null)).toBe("");
    expect(toDateTimeLocalValue("not-a-date")).toBe("");
    expect(toDateTimeLocalValue("2026-07-21T10:15:00.000Z", "Not/A_Timezone")).toBe("");
  });
});
