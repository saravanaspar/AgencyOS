import { z } from "zod";

import {
  crmActivityTypes,
  crmLeadStatuses,
  crmLeadTypes,
  crmPipelineStates,
  crmStageRequiredFields,
} from "@/modules/crm/crm";

function emptyValueToNull(value: unknown): unknown {
  return value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;
}

function checkbox(value: unknown): unknown {
  return value === "on" || value === "true" || value === true;
}

const uuid = z.uuid("Select a valid record.");
const optionalUuid = z.preprocess(emptyValueToNull, uuid.nullable());
const optionalText = (max: number) =>
  z.preprocess(emptyValueToNull, z.string().trim().max(max).nullable());
const optionalEmail = z.preprocess(
  emptyValueToNull,
  z.string().trim().email("Enter a valid email address.").max(254).nullable(),
);
const optionalUrl = z.preprocess(
  emptyValueToNull,
  z.string().trim().url("Enter a valid website URL.").max(500).nullable(),
);
const optionalDate = z.preprocess(emptyValueToNull, z.iso.date().nullable());
const optionalDateTime = z.preprocess(emptyValueToNull, z.iso.datetime({ local: true }).nullable());
const money = z.preprocess(
  emptyValueToNull,
  z.coerce.number().min(0, "Value cannot be negative.").max(1_000_000_000).nullable(),
);

export const crmFiltersSchema = z.object({
  q: z.string().trim().max(120).catch(""),
  stage: z.preprocess(emptyValueToNull, uuid.nullable()).catch(null),
  owner: z.preprocess(emptyValueToNull, uuid.nullable()).catch(null),
  status: z.preprocess(emptyValueToNull, z.enum(crmLeadStatuses).nullable()).catch(null),
  currency: z.preprocess(
    emptyValueToNull,
    z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable(),
  ).catch(null),
  scope: z.preprocess(
    emptyValueToNull,
    z.enum(["open_opportunities"]).nullable(),
  ).catch(null),
  page: z.coerce.number().int().min(1).catch(1),
});

export const companyCreateSchema = z.object({
  legalName: z.string().trim().min(2, "Enter at least 2 characters.").max(180),
  displayName: optionalText(180),
  industry: optionalText(100),
  website: optionalUrl,
  email: optionalEmail,
  phone: optionalText(40),
  ownerMembershipId: optionalUuid,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: optionalText(4_000),
});

export const companyUpdateSchema = companyCreateSchema.extend({
  companyId: uuid,
});

export const companyPrimaryContactSchema = z.object({
  companyId: uuid,
  primaryContactId: optionalUuid,
});

export const contactCreateSchema = z.object({
  companyId: optionalUuid,
  firstName: z.string().trim().min(1, "Enter a first name.").max(100),
  lastName: z.string().trim().min(1, "Enter a last name.").max(100),
  jobTitle: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  preferredCommunication: z.enum(["email", "phone", "meeting", "none"]).default("email"),
  isBillingContact: z.preprocess(checkbox, z.boolean()).default(false),
  isDecisionMaker: z.preprocess(checkbox, z.boolean()).default(false),
  consentStatus: z.enum(["unknown", "granted", "revoked"]).default("unknown"),
  ownerMembershipId: optionalUuid,
  notes: optionalText(4_000),
});

export const contactUpdateSchema = contactCreateSchema.extend({
  contactId: uuid,
});

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(180),
  leadType: z.enum(crmLeadTypes).default("company"),
  source: optionalText(100),
  stageId: uuid,
  estimatedValue: money,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  expectedCloseDate: optionalDate,
  ownerMembershipId: optionalUuid,
  email: optionalEmail,
  phone: optionalText(40),
  companyName: optionalText(180),
  followUpAt: optionalDateTime,
  notes: optionalText(4_000),
});

export const leadUpdateSchema = leadCreateSchema
  .extend({
    leadId: uuid,
    status: z.enum(["new", "qualified", "unqualified", "lost"]),
    lostReason: optionalText(500),
  })
  .superRefine((value, context) => {
    if (value.status === "lost" && !value.lostReason) {
      context.addIssue({
        code: "custom",
        path: ["lostReason"],
        message: "Enter why the opportunity was lost.",
      });
    }
  });

export const leadStageUpdateSchema = z.object({
  leadId: uuid,
  stageId: uuid,
  lostReason: optionalText(500),
});

export const leadQualificationSchema = z.object({
  leadId: uuid,
  status: z.enum(["qualified", "unqualified"]),
  reason: optionalText(500),
});

export const leadDeleteSchema = z.object({ leadId: uuid });

export const leadConvertSchema = z.object({
  leadId: uuid,
  createContact: z.preprocess(checkbox, z.boolean()).default(true),
  createBillingProfile: z.preprocess(checkbox, z.boolean()).default(true),
  createContractRequest: z.preprocess(checkbox, z.boolean()).default(false),
});

export const activityCreateSchema = z
  .object({
    leadId: optionalUuid,
    companyId: optionalUuid,
    contactId: optionalUuid,
    activityType: z.enum(crmActivityTypes),
    subject: z.string().trim().min(2, "Enter a subject.").max(180),
    details: optionalText(4_000),
    dueAt: optionalDateTime,
  })
  .superRefine((value, context) => {
    if (value.activityType === "follow_up" && !value.dueAt) {
      context.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "Choose when this follow-up is due.",
      });
    }
  });

export const activityCompleteSchema = z.object({
  activityId: uuid,
});

export const pipelineStageCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  probability: z.coerce.number().int().min(0).max(100),
  state: z.enum(crmPipelineStates).default("open"),
  requiredFields: z
    .array(z.enum(crmStageRequiredFields))
    .max(crmStageRequiredFields.length)
    .default([]),
});

export const pipelineStageUpdateSchema = pipelineStageCreateSchema.extend({
  stageId: uuid,
  isActive: z.preprocess(checkbox, z.boolean()).default(true),
});

export const crmForecastTargetSchema = z.object({
  month: z.preprocess(
    (value) => (typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value),
    z.iso.date(),
  ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  targetValue: z.coerce.number().min(0).max(1_000_000_000_000),
});

export interface CrmActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  duplicateWarnings?: string[];
}

export type CrmFilters = z.infer<typeof crmFiltersSchema>;
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
