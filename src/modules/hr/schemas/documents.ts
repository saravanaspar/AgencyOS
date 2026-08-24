import { z } from "zod";

import { hrDocumentTypes } from "@/modules/hr/documents";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid("Select a valid record.");
const nullableDate = z.preprocess(emptyToNull, z.iso.date().nullable());

export const hrDocumentGenerationSchema = z.object({
  membershipId: entityId,
  documentType: z.enum(hrDocumentTypes),
  templateSelection: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(180),
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(80)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/),
  effectiveDate: z.iso.date(),
  expiryDate: nullableDate,
  signatoryName: z.string().trim().min(2).max(180),
  signatoryTitle: z.string().trim().min(2).max(160),
  customFields: z.string().max(50_000),
});

export const hrDocumentIdSchema = z.object({ documentId: entityId });

export const hrDocumentTemplateDefaultSchema = z.object({
  documentType: z.enum(hrDocumentTypes),
  templateSelection: z.string().trim().min(1).max(120),
});

export const hrDocumentTemplateStatusSchema = z.object({
  templateId: entityId,
  status: z.enum(["active", "inactive"]),
});
