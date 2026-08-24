export const attendanceStatuses = ["present", "work_from_home", "half_day", "absent"] as const;

export const attendanceSources = ["self", "manual", "correction"] as const;

export const attendanceCorrectionStatuses = [
  "pending",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
  "expired",
  "invalidated",
] as const;

export type AttendanceStatus = (typeof attendanceStatuses)[number];
export type AttendanceSource = (typeof attendanceSources)[number];
export type AttendanceCorrectionStatus = (typeof attendanceCorrectionStatuses)[number];

export function attendanceDurationMinutes(
  checkInAt: string | null,
  checkOutAt: string | null,
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const minutes = Math.round((Date.parse(checkOutAt) - Date.parse(checkInAt)) / 60000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}
