import { z } from "zod";

import { hrOffboardingItemStatuses, hrSeparationTypes } from "@/modules/hr/offboarding";

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value.trim() : ""))
    .pipe(z.string().max(max))
    .transform((value) => value || null);
const optionalUuid = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => (typeof value === "string" ? value.trim() : ""))
  .transform((value) => value || null)
  .pipe(z.uuid().nullable());
const isoDate = z.iso.date();

export const createHrOffboardingPlanSchema = z
  .object({
    membershipId: z.uuid(),
    separationType: z.enum(hrSeparationTypes),
    noticeDate: isoDate,
    lastWorkingDate: isoDate,
    reason: optionalText(2000),
    replacementMembershipId: optionalUuid,
    exitInterviewAt: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (typeof value === "string" ? value.trim() : ""))
      .transform((value) => value || null)
      .pipe(z.iso.datetime({ offset: true }).nullable()),
    exitInterviewDetails: optionalText(1000),
    notes: optionalText(2000),
  })
  .superRefine((value, context) => {
    if (value.lastWorkingDate < value.noticeDate) {
      context.addIssue({
        code: "custom",
        path: ["lastWorkingDate"],
        message: "Last working date cannot be before the notice date.",
      });
    }
  });

export const submitHrResignationSchema = z
  .object({
    noticeDate: isoDate,
    lastWorkingDate: isoDate,
    reason: optionalText(2000),
  })
  .superRefine((value, context) => {
    if (value.lastWorkingDate < value.noticeDate) {
      context.addIssue({
        code: "custom",
        path: ["lastWorkingDate"],
        message: "Last working date cannot be before the notice date.",
      });
    }
  });

export const updateHrOffboardingPlanSchema = createHrOffboardingPlanSchema.extend({
  planId: z.uuid(),
});

export const updateHrOffboardingItemSchema = z.object({
  itemId: z.uuid(),
  status: z.enum(hrOffboardingItemStatuses),
  assignedMembershipId: optionalUuid,
  dueDate: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value.trim() : ""))
    .transform((value) => value || null)
    .pipe(isoDate.nullable()),
  notes: optionalText(1000),
});

export const reassignHrOffboardingWorkSchema = z.object({
  planId: z.uuid(),
  replacementMembershipId: z.uuid(),
});

export const hrOffboardingPlanIdSchema = z.object({ planId: z.uuid() });
