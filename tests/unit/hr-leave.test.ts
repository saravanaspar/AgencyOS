import { describe, expect, it } from "vitest";

import { countWeekdayLeaveDays, leaveBalanceAvailable } from "@/modules/hr/leave";
import {
  leaveBalanceAdjustmentSchema,
  leaveDraftSchema,
  leaveTypeSchema,
} from "@/modules/hr/schemas/leave";

const leaveTypeId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";

describe("HR leave validation and calculations", () => {
  it("counts weekdays and supports single-date half days", () => {
    expect(countWeekdayLeaveDays("2026-07-17", "2026-07-20", "full_day")).toBe(2);
    expect(countWeekdayLeaveDays("2026-07-18", "2026-07-19", "full_day")).toBe(0);
    expect(countWeekdayLeaveDays("2026-07-17", "2026-07-17", "morning")).toBe(0.5);
    expect(countWeekdayLeaveDays("2026-07-17", "2026-07-18", "afternoon")).toBe(0);
  });

  it("rejects reversed, cross-year, and multi-date half-day leave", () => {
    expect(
      leaveDraftSchema.safeParse({
        leaveTypeId,
        startDate: "2026-07-20",
        endDate: "2026-07-17",
        dayPart: "full_day",
        reason: "Family appointment",
      }).success,
    ).toBe(false);
    expect(
      leaveDraftSchema.safeParse({
        leaveTypeId,
        startDate: "2026-12-31",
        endDate: "2027-01-02",
        dayPart: "full_day",
        reason: "Year-end leave",
      }).success,
    ).toBe(false);
    expect(
      leaveDraftSchema.safeParse({
        leaveTypeId,
        startDate: "2026-07-17",
        endDate: "2026-07-20",
        dayPart: "morning",
        reason: "Family appointment",
      }).success,
    ).toBe(false);
  });

  it("requires a usable accrual amount for monthly and annual policies", () => {
    const base = {
      leaveTypeId: "",
      name: "Annual leave",
      code: "AL",
      description: "Standard paid leave",
      isPaid: true,
      balanceRequired: true,
      annualAllowanceDays: "0",
      accrualRateDays: "0",
      carryForwardLimitDays: "5",
      attachmentRequiredAfterDays: "",
      requiresHrApproval: false,
    };

    expect(leaveTypeSchema.safeParse({ ...base, accrualFrequency: "monthly" }).success).toBe(false);
    expect(leaveTypeSchema.safeParse({ ...base, accrualFrequency: "annual" }).success).toBe(false);
    expect(
      leaveTypeSchema.safeParse({
        ...base,
        accrualFrequency: "monthly",
        accrualRateDays: "1.5",
      }).success,
    ).toBe(true);
  });

  it("calculates availability after reservations and usage", () => {
    expect(
      leaveBalanceAvailable({
        openingDays: 2,
        accruedDays: 12,
        carriedForwardDays: 3,
        adjustmentDays: -1,
        reservedDays: 2.5,
        usedDays: 4,
      }),
    ).toBe(9.5);
  });

  it("normalizes bounded audited balance adjustments", () => {
    expect(
      leaveBalanceAdjustmentSchema.parse({
        membershipId,
        leaveTypeId,
        balanceYear: "2026",
        adjustmentDays: "1.25",
        reason: "Opening balance correction",
      }),
    ).toEqual({
      membershipId,
      leaveTypeId,
      balanceYear: 2026,
      adjustmentDays: 1.25,
      reason: "Opening balance correction",
    });
    expect(
      leaveBalanceAdjustmentSchema.safeParse({
        membershipId,
        leaveTypeId,
        balanceYear: "2026",
        adjustmentDays: "0",
        reason: "No change",
      }).success,
    ).toBe(false);
  });
});
