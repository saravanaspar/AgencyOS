import { z } from "zod";

import { attendanceStatuses } from "@/modules/hr/attendance";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid("Select a valid employee.");
const date = z.iso.date();
const time = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
);
const minutes = z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(1440).nullable());
const notes = z.preprocess(emptyToNull, z.string().trim().max(2000).nullable());

const attendanceValues = {
  membershipId: entityId,
  attendanceDate: date,
  checkInTime: time,
  checkOutTime: time,
  attendanceStatus: z.enum(attendanceStatuses),
  lateMinutes: minutes,
  earlyDepartureMinutes: minutes,
  overtimeMinutes: minutes,
  notes,
};

export const manualAttendanceSchema = z.object(attendanceValues).superRefine((value, context) => {
  if (value.checkInTime && value.checkOutTime && value.checkOutTime <= value.checkInTime) {
    context.addIssue({
      code: "custom",
      path: ["checkOutTime"],
      message: "Check-out must be later than check-in.",
    });
  }
});

export const attendanceCorrectionSchema = z
  .object({
    ...attendanceValues,
    reason: z.string().trim().min(5).max(2000),
  })
  .superRefine((value, context) => {
    if (value.checkInTime && value.checkOutTime && value.checkOutTime <= value.checkInTime) {
      context.addIssue({
        code: "custom",
        path: ["checkOutTime"],
        message: "Check-out must be later than check-in.",
      });
    }
  });

export const attendanceCheckSchema = z.object({ operation: z.enum(["check_in", "check_out"]) });
