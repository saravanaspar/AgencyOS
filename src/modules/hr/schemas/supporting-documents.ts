import { z } from "zod";

import {
  containsLikelyFullIdentifier,
  hrSupportingDocumentCategories,
} from "@/modules/hr/supporting-documents";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid("Select a valid employee.");
const nullableDate = z.preprocess(emptyToNull, z.iso.date().nullable());
const nullableShortText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().min(1).max(max).nullable());

export const hrSupportingDocumentUploadSchema = z
  .object({
    membershipId: entityId,
    category: z.enum(hrSupportingDocumentCategories),
    title: z
      .string()
      .trim()
      .min(2)
      .max(180)
      .refine((value) => !containsLikelyFullIdentifier(value), {
        message: "Use a descriptive title, not a complete identifier number.",
      }),
    issuer: nullableShortText(180),
    identifierSuffix: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{1,4}$/)
        .nullable(),
    ),
    issuedDate: nullableDate,
    expiryDate: nullableDate,
    employeeVisible: z.boolean(),
  })
  .refine(
    (value) => !value.issuedDate || !value.expiryDate || value.expiryDate >= value.issuedDate,
    { path: ["expiryDate"], message: "Expiry date cannot be before the issue date." },
  );

export const hrSupportingDocumentReviewSchema = z.object({
  documentId: entityId,
  reviewStatus: z.enum(["verified", "rejected"]),
});

export const hrSupportingDocumentVisibilitySchema = z.object({
  documentId: entityId,
  employeeVisible: z.boolean(),
});
