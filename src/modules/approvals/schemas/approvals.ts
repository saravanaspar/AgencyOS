import { z } from "zod";

import { approvalStatuses, type ApprovalDefinitionStepInput } from "@/modules/approvals/approvals";

const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const optionalUuid = z.uuid().nullable();
const optionalPositiveInteger = z.number().int().min(1).max(8_760).nullable();
const moduleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(80);
const policyKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,79}$/)
  .max(80);
const safeDeepLinkSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\") &&
        !/[\u0000-\u001f\u007f]/.test(value)),
    { message: "Use a safe internal AgencyOS path beginning with one slash." },
  );

const approvalStepSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    stageOrder: z.number().int().min(1).max(50),
    sortOrder: z.number().int().min(1).max(50),
    selectorType: z.enum(["manager", "role", "membership"]),
    selectorRoleKey: z.string().trim().max(80).nullable(),
    selectorMembershipId: optionalUuid,
    decisionMode: z.enum(["any", "all"]),
    conditions: z.strictObject({
      minimumAmount: z.number().nonnegative().max(999_999_999_999).optional(),
      maximumAmount: z.number().nonnegative().max(999_999_999_999).optional(),
      departmentId: z.uuid().optional(),
    }),
    commentRequired: z.boolean(),
    reminderAfterHours: optionalPositiveInteger,
    escalationAfterHours: optionalPositiveInteger,
    expiresAfterHours: optionalPositiveInteger,
  })
  .superRefine((step, context) => {
    if (step.selectorType === "role" && !step.selectorRoleKey) {
      context.addIssue({ code: "custom", path: ["selectorRoleKey"], message: "Choose a role." });
    }
    if (step.selectorType === "membership" && !step.selectorMembershipId) {
      context.addIssue({
        code: "custom",
        path: ["selectorMembershipId"],
        message: "Choose a member.",
      });
    }
    if (step.selectorType !== "role" && step.selectorRoleKey) {
      context.addIssue({
        code: "custom",
        path: ["selectorRoleKey"],
        message: "Role selector is not valid for this step.",
      });
    }
    if (step.selectorType !== "membership" && step.selectorMembershipId) {
      context.addIssue({
        code: "custom",
        path: ["selectorMembershipId"],
        message: "Named member selector is not valid for this step.",
      });
    }
    if (
      step.conditions.minimumAmount !== undefined &&
      step.conditions.maximumAmount !== undefined &&
      step.conditions.minimumAmount > step.conditions.maximumAmount
    ) {
      context.addIssue({
        code: "custom",
        path: ["conditions", "maximumAmount"],
        message: "Maximum amount must be at least the minimum amount.",
      });
    }
    if (
      step.reminderAfterHours !== null &&
      step.escalationAfterHours !== null &&
      step.escalationAfterHours < step.reminderAfterHours
    ) {
      context.addIssue({
        code: "custom",
        path: ["escalationAfterHours"],
        message: "Escalation cannot occur before the first reminder.",
      });
    }
  });

export const approvalFiltersSchema = z.object({
  view: z.enum(["inbox", "submitted", "all"]).catch("inbox"),
  status: z.enum(["all", ...approvalStatuses]).catch("all"),
  q: z.preprocess(firstValue, z.string().trim().max(120).optional().default("")),
  page: z.preprocess(firstValue, z.coerce.number().int().min(1).max(10_000).catch(1)),
});

export const createApprovalDefinitionSchema = z.object({
  key: policyKeySchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).nullable(),
  sourceModule: moduleKeySchema,
  entityType: moduleKeySchema,
  allowSelfApproval: z.boolean(),
  allowReassignment: z.boolean(),
  steps: z.array(approvalStepSchema).min(1).max(20),
});

export const createApprovalRequestSchema = z
  .object({
    definitionId: z.uuid(),
    title: z.string().trim().min(2).max(160),
    entityId: z.string().trim().max(200).nullable(),
    deepLink: safeDeepLinkSchema.transform((value) => value || null),
    departmentId: optionalUuid,
    amount: z.number().nonnegative().max(999_999_999_999).nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    snapshot: z.record(z.string(), z.unknown()),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((request, context) => {
    if (request.amount !== null && request.currency === null) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Currency is required when an amount is supplied.",
      });
    }
    if (request.amount === null && request.currency !== null) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Remove the currency when no amount is supplied.",
      });
    }
  });

export const approvalDecisionSchema = z.object({
  requestStepId: z.uuid(),
  decision: z.enum(["approved", "rejected", "revision_requested"]),
  comment: z.string().trim().max(2_000).nullable(),
});

export const reassignApprovalStepSchema = z.object({
  requestStepId: z.uuid(),
  approverMembershipId: z.uuid(),
  comment: z.string().trim().min(3).max(2_000),
});

export const cancelApprovalRequestSchema = z.object({
  requestId: z.uuid(),
  comment: z.string().trim().min(3).max(2_000),
});

export const retireApprovalDefinitionSchema = z.object({
  definitionId: z.uuid(),
});

export const createApprovalDelegationSchema = z
  .object({
    toMembershipId: z.uuid(),
    sourceModule: moduleKeySchema.nullable(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(500).nullable(),
  })
  .superRefine((delegation, context) => {
    const startsAt = new Date(delegation.startsAt);
    const endsAt = new Date(delegation.endsAt);
    if (endsAt <= startsAt) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Delegation end must be after its start.",
      });
    }
    if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 60 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "Delegation cannot exceed 366 days.",
      });
    }
  });

export const revokeApprovalDelegationSchema = z.object({
  delegationId: z.uuid(),
});

export const approvalRequestIntegrationSchema = z
  .object({
    definitionKey: policyKeySchema,
    title: z.string().trim().min(2).max(160),
    sourceModule: moduleKeySchema,
    entityType: moduleKeySchema,
    entityId: z.string().trim().max(200).nullable(),
    deepLink: safeDeepLinkSchema.transform((value) => value || null),
    departmentId: optionalUuid,
    amount: z.number().nonnegative().max(999_999_999_999).nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    snapshot: z.record(z.string(), z.unknown()),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((request, context) => {
    if ((request.amount === null) !== (request.currency === null)) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Amount and currency must be supplied together.",
      });
    }
  });

export type ApprovalFilters = z.infer<typeof approvalFiltersSchema>;
export type CreateApprovalDefinitionInput = z.infer<typeof createApprovalDefinitionSchema>;
export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type ReassignApprovalStepInput = z.infer<typeof reassignApprovalStepSchema>;
export type CreateApprovalDelegationInput = z.infer<typeof createApprovalDelegationSchema>;
export type ApprovalRequestIntegrationInput = z.infer<typeof approvalRequestIntegrationSchema>;

export interface ApprovalActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
  completionId?: string;
}

export function parseApprovalSteps(value: unknown): ApprovalDefinitionStepInput[] {
  const parsed = z.array(approvalStepSchema).min(1).max(20).parse(value);
  return parsed;
}
