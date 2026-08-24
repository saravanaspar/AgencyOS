import { describe, expect, it } from "vitest";

import { attendanceDurationMinutes } from "@/modules/hr/attendance";
import {
  attendanceCorrectionSchema,
  manualAttendanceSchema,
} from "@/modules/hr/schemas/attendance";

const membershipId = "11111111-1111-4111-8111-111111111111";

describe("HR attendance validation", () => {
  it("normalizes optional attendance values", () => {
    expect(
      manualAttendanceSchema.parse({
        membershipId,
        attendanceDate: "2026-07-17",
        checkInTime: "09:00",
        checkOutTime: "17:30",
        attendanceStatus: "present",
        lateMinutes: "",
        earlyDepartureMinutes: "0",
        overtimeMinutes: "30",
        notes: " ",
      }),
    ).toEqual({
      membershipId,
      attendanceDate: "2026-07-17",
      checkInTime: "09:00",
      checkOutTime: "17:30",
      attendanceStatus: "present",
      lateMinutes: null,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 30,
      notes: null,
    });
  });

  it("rejects reversed times and short correction reasons", () => {
    const result = attendanceCorrectionSchema.safeParse({
      membershipId,
      attendanceDate: "2026-07-17",
      checkInTime: "18:00",
      checkOutTime: "09:00",
      attendanceStatus: "present",
      lateMinutes: "0",
      earlyDepartureMinutes: "0",
      overtimeMinutes: "0",
      notes: "",
      reason: "no",
    });

    expect(result.success).toBe(false);
  });

  it("calculates worked minutes only for valid complete intervals", () => {
    expect(attendanceDurationMinutes("2026-07-17T09:00:00.000Z", "2026-07-17T17:30:00.000Z")).toBe(
      510,
    );
    expect(attendanceDurationMinutes(null, "2026-07-17T17:30:00.000Z")).toBeNull();
    expect(
      attendanceDurationMinutes("2026-07-17T18:00:00.000Z", "2026-07-17T17:30:00.000Z"),
    ).toBeNull();
  });
});
