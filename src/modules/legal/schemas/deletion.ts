import { z } from "zod";

import { legalDeletionTargetTypes } from "@/modules/legal/deletion";

const optionalBoolean = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

export const legalDeletionPolicySchema = z.object({
  secondApprovalRequired: optionalBoolean,
});

export const legalDeletionRequestSchema = z.object({
  targetType: z.enum(legalDeletionTargetTypes),
  targetId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
});

export const legalDeletionExecuteSchema = z.object({
  requestId: z.uuid(),
});

export type LegalDeletionActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};
