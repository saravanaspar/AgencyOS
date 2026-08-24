export const leaveAccrualFrequencies = ["none", "monthly", "annual"] as const;
export const leaveDayParts = ["full_day", "morning", "afternoon"] as const;
export const leaveRequestStatuses = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "revision_requested",
  "cancelled",
  "expired",
  "invalidated",
] as const;

export type LeaveAccrualFrequency = (typeof leaveAccrualFrequencies)[number];
export type LeaveDayPart = (typeof leaveDayParts)[number];
export type LeaveRequestStatus = (typeof leaveRequestStatuses)[number];

export function countWeekdayLeaveDays(
  startDate: string,
  endDate: string,
  dayPart: LeaveDayPart,
): number {
  if (dayPart !== "full_day") return startDate === endDate ? 0.5 : 0;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let count = 0;
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function leaveBalanceAvailable(input: {
  openingDays: number;
  accruedDays: number;
  carriedForwardDays: number;
  adjustmentDays: number;
  reservedDays: number;
  usedDays: number;
}): number {
  return (
    input.openingDays +
    input.accruedDays +
    input.carriedForwardDays +
    input.adjustmentDays -
    input.reservedDays -
    input.usedDays
  );
}
