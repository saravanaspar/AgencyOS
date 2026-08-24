import { z } from "zod";

import { hrOnboardingItemStatuses } from "@/modules/hr/onboarding";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid();
const nullableDate = z.preprocess(emptyToNull, z.iso.date().nullable());
const nullableDateTime = z.preprocess(emptyToNull, z.iso.datetime({ local: true }).nullable());
const nullableText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().min(1).max(max).nullable());

export const createHrOnboardingPlanSchema = z
  .object({
    membershipId: entityId,
    targetStartDate: z.iso.date(),
    firstDayMeetingAt: nullableDateTime,
    firstDayMeetingDetails: nullableText(500),
    probationReviewDate: nullableDate,
    notes: nullableText(2000),
  })
  .refine(
    (value) => !value.probationReviewDate || value.probationReviewDate >= value.targetStartDate,
    { path: ["probationReviewDate"], message: "Probation review cannot precede the start date." },
  );

export const updateHrOnboardingScheduleSchema = createHrOnboardingPlanSchema.extend({
  planId: entityId,
});

export const updateHrOnboardingItemSchema = z.object({
  itemId: entityId,
  status: z.enum(hrOnboardingItemStatuses),
  assignedMembershipId: z.preprocess(emptyToNull, entityId.nullable()),
  dueDate: nullableDate,
  notes: nullableText(1000),
});

export const completeHrOnboardingOwnItemSchema = z.object({ itemId: entityId });
export const hrOnboardingPlanIdSchema = z.object({ planId: entityId });
export const cancelHrOnboardingPlanSchema = hrOnboardingPlanIdSchema;
