import { z } from "zod";

import {
  legalComplianceConfidentialityLevels,
  legalComplianceRecordTypes,
} from "@/modules/legal/compliance";
import type { LegalActionState } from "@/modules/legal/schemas/legal";

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

export const legalComplianceRecordSchema = z
  .object({
    recordId: optionalUuid,
    internalReference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._/-]{2,39}$/),
    title: z.string().trim().min(2).max(180),
    recordType: z.enum(legalComplianceRecordTypes),
    responsibleOwnerMembershipId: z.uuid(),
    departmentId: optionalUuid,
    issuingAuthority: optionalText(180),
    jurisdiction: optionalText(120),
    identifierLastFour: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{2,4}$/)
        .nullable(),
    ),
    issueDate: optionalDate,
    effectiveDate: optionalDate,
    expiryDate: optionalDate,
    renewalDate: optionalDate,
    reviewDate: optionalDate,
    responseDueDate: optionalDate,
    confidentialityLevel: z.enum(legalComplianceConfidentialityLevels),
    legalPrivilege: z.preprocess((value) => value === "true" || value === "on", z.boolean()),
    documentId: z.uuid(),
    documentVersionId: z.uuid(),
    summary: optionalText(2000),
  })
  .refine(
    (value) =>
      !value.expiryDate ||
      (!value.effectiveDate && !value.issueDate) ||
      value.expiryDate >= (value.effectiveDate ?? value.issueDate ?? value.expiryDate),
    { path: ["expiryDate"], message: "Expiry date cannot be before the issue/effective date." },
  )
  .refine(
    (value) =>
      !value.renewalDate || !value.effectiveDate || value.renewalDate >= value.effectiveDate,
    { path: ["renewalDate"], message: "Renewal date cannot be before the effective date." },
  );

export const legalComplianceLifecycleSchema = z.object({
  recordId: z.uuid(),
  action: z.enum(["close", "archive", "restore"]),
  reason: optionalText(1000),
});

export const legalComplianceFilterSchema = z.object({
  query: z.string().trim().max(100).optional().default(""),
  type: z
    .enum([...legalComplianceRecordTypes, "all"])
    .optional()
    .default("all"),
  status: z.enum(["active", "closed", "archived", "all"]).optional().default("all"),
});

export type LegalComplianceActionState = LegalActionState;
