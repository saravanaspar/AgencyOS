import { describe, expect, it } from "vitest";

import { hrSupportingDocumentUploadSchema } from "@/modules/hr/schemas/supporting-documents";
import {
  getHrSupportingDocumentCategoryDefinition,
  hrSupportingDocumentCategories,
  buildHrSupportingDocumentReference,
  containsLikelyFullIdentifier,
  maskHrSupportingDocumentIdentifier,
} from "@/modules/hr/supporting-documents";

const validUpload = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  category: "identification" as const,
  title: "Passport",
  issuer: "Government authority",
  identifierSuffix: "A123",
  issuedDate: "2025-01-01",
  expiryDate: "2035-01-01",
  employeeVisible: true,
};

describe("HR supporting documents", () => {
  it("registers each private supporting-document category once", () => {
    expect(hrSupportingDocumentCategories).toEqual([
      "identification",
      "education",
      "certificate",
      "visa_work_permit",
      "background_check",
      "exit_document",
    ]);
    expect(new Set(hrSupportingDocumentCategories).size).toBe(6);
  });

  it("limits employee self uploads to appropriate categories", () => {
    expect(getHrSupportingDocumentCategoryDefinition("identification").selfUploadAllowed).toBe(
      true,
    );
    expect(getHrSupportingDocumentCategoryDefinition("visa_work_permit").selfUploadAllowed).toBe(
      true,
    );
    expect(getHrSupportingDocumentCategoryDefinition("background_check").selfUploadAllowed).toBe(
      false,
    );
    expect(getHrSupportingDocumentCategoryDefinition("exit_document").selfUploadAllowed).toBe(
      false,
    );
  });

  it("accepts bounded metadata and masks identifier suffixes", () => {
    expect(hrSupportingDocumentUploadSchema.parse(validUpload)).toEqual(validUpload);
    expect(maskHrSupportingDocumentIdentifier("A123")).toBe("•••• A123");
    expect(maskHrSupportingDocumentIdentifier(null)).toBe("Not recorded");
    expect(buildHrSupportingDocumentReference("identification", "Passport")).toMatch(
      /^SUP-IDE-[A-F0-9]{8}$/,
    );
  });

  it("rejects full identifiers and invalid date ranges", () => {
    expect(containsLikelyFullIdentifier("Passport A12345678")).toBe(true);
    expect(
      hrSupportingDocumentUploadSchema.safeParse({
        ...validUpload,
        title: "Passport A12345678",
      }).success,
    ).toBe(false);
    expect(
      hrSupportingDocumentUploadSchema.safeParse({
        ...validUpload,
        identifierSuffix: "FULL-PASSPORT-NUMBER",
      }).success,
    ).toBe(false);
    expect(
      hrSupportingDocumentUploadSchema.safeParse({
        ...validUpload,
        issuedDate: "2030-01-01",
        expiryDate: "2029-12-31",
      }).success,
    ).toBe(false);
  });
});
