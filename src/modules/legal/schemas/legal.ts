import { z } from "zod";

import {
  legalContractStatuses,
  legalContractTypes,
  legalSignatureStatuses,
  legalVersionKinds,
} from "@/modules/legal/legal";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );
const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.uuid().nullable(),
);
const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.iso.date().nullable(),
);
const optionalInteger = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
  z.number().int().nonnegative().nullable(),
);

export const legalContractSchema = z
  .object({
    contractId: optionalUuid,
    internalReference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._/-]{2,39}$/),
    title: z.string().trim().min(2).max(180),
    contractType: z.enum(legalContractTypes),
    counterpartyName: z.string().trim().min(2).max(180),
    counterpartyCompanyId: optionalUuid,
    responsibleOwnerMembershipId: z.uuid(),
    departmentId: optionalUuid,
    templateId: optionalUuid,
    effectiveDate: optionalDate,
    endDate: optionalDate,
    renewalDate: optionalDate,
    noticePeriodDays: optionalInteger.refine((value) => value === null || value <= 3650),
    jurisdiction: optionalText(120),
    governingLaw: optionalText(160),
    contractValueMinor: optionalInteger,
    currency: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
    ),
    financeReviewRequired: z.preprocess((value) => value === "true" || value === "on", z.boolean()),
    ownerApprovalRequired: z.preprocess((value) => value === "true" || value === "on", z.boolean()),
  })
  .refine(
    (value) => !value.endDate || !value.effectiveDate || value.endDate >= value.effectiveDate,
    {
      path: ["endDate"],
      message: "End date must be on or after the effective date.",
    },
  )
  .refine((value) => (value.contractValueMinor === null) === (value.currency === null), {
    path: ["currency"],
    message: "Provide both contract value and currency, or leave both blank.",
  });

export const legalTemplateSchema = z.object({
  templateId: optionalUuid,
  name: z.string().trim().min(2).max(140),
  contractType: z.enum(legalContractTypes),
  description: optionalText(1000),
  sourceDocumentId: z.uuid(),
  sourceVersionId: z.uuid(),
  status: z.enum(["active", "inactive"]),
});

export const legalContractVersionSchema = z.object({
  contractId: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  versionKind: z.enum(legalVersionKinds),
  note: optionalText(500),
});

export const legalContractIdSchema = z.uuid();

export const legalSignatureSchema = z.object({
  contractId: z.uuid(),
  signatureStatus: z.enum(legalSignatureStatuses),
});

export const legalLifecycleSchema = z.object({
  contractId: z.uuid(),
  action: z.enum(["await_signature", "activate", "terminate", "expire", "cancel"]),
  reason: optionalText(1000),
});

export const legalWorkspaceFilterSchema = z.object({
  query: z.string().trim().max(100).optional().default(""),
  status: z
    .enum([...legalContractStatuses, "all"])
    .optional()
    .default("all"),
});

export type LegalActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};
