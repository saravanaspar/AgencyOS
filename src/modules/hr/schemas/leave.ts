import { z } from "zod";

import { leaveAccrualFrequencies, leaveDayParts } from "@/modules/hr/leave";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid("Select a valid record.");
const nullableText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const days = (maximum = 366) => z.coerce.number().min(0).max(maximum).multipleOf(0.25);

export const leaveTypeSchema = z
  .object({
    leaveTypeId: z.preprocess(emptyToNull, entityId.nullable()),
    name: z.string().trim().min(2).max(120),
    code: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .toUpperCase()
        .max(24)
        .regex(/^[A-Z0-9_-]+$/)
        .nullable(),
    ),
    description: nullableText(1000),
    isPaid: z.coerce.boolean(),
    balanceRequired: z.coerce.boolean(),
    accrualFrequency: z.enum(leaveAccrualFrequencies),
    annualAllowanceDays: days(),
    accrualRateDays: days(31),
    carryForwardLimitDays: days(),
    attachmentRequiredAfterDays: z.preprocess(
      emptyToNull,
      z.coerce.number().min(0.5).max(366).multipleOf(0.5).nullable(),
    ),
    requiresHrApproval: z.coerce.boolean(),
  })
  .superRefine((value, context) => {
    if (value.accrualFrequency === "monthly" && value.accrualRateDays <= 0) {
      context.addIssue({
        code: "custom",
        path: ["accrualRateDays"],
        message: "Monthly accrual needs a positive monthly rate.",
      });
    }
    if (value.accrualFrequency === "annual" && value.annualAllowanceDays <= 0) {
      context.addIssue({
        code: "custom",
        path: ["annualAllowanceDays"],
        message: "Annual accrual needs a positive annual allowance.",
      });
    }
  });

export const leaveTypeStatusSchema = z.object({
  leaveTypeId: entityId,
  status: z.enum(["active", "inactive"]),
});

export const leaveDraftSchema = z
  .object({
    leaveTypeId: entityId,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    dayPart: z.enum(leaveDayParts),
    reason: z.string().trim().min(5).max(2000),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date is before start date.",
      });
    }
    if (value.startDate.slice(0, 4) !== value.endDate.slice(0, 4)) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Leave must stay inside one calendar year.",
      });
    }
    if (value.dayPart !== "full_day" && value.startDate !== value.endDate) {
      context.addIssue({
        code: "custom",
        path: ["dayPart"],
        message: "Half-day leave must use one date.",
      });
    }
  });

export const leaveRequestIdSchema = z.object({ leaveRequestId: entityId });

export const leaveCancellationSchema = z.object({
  leaveRequestId: entityId,
  reason: z.string().trim().min(3).max(1000),
});

export const leaveBalanceAdjustmentSchema = z.object({
  membershipId: entityId,
  leaveTypeId: entityId,
  balanceYear: z.coerce.number().int().min(2000).max(2200),
  adjustmentDays: z.coerce
    .number()
    .min(-366)
    .max(366)
    .multipleOf(0.25)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(1000),
});
