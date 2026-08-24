import { describe, expect, it } from "vitest";

import {
  legalComplianceRecordTypeLabels,
  legalComplianceRecordTypes,
  legalComplianceTimingState,
} from "@/modules/legal/compliance";
import { legalComplianceRecordSchema } from "@/modules/legal/schemas/compliance";

const base = {
  recordId: null,
  internalReference: "COMP-2026-001",
  title: "GST registration certificate",
  recordType: "gst_record",
  responsibleOwnerMembershipId: "11111111-1111-4111-8111-111111111111",
  departmentId: null,
  issuingAuthority: "Government authority",
  jurisdiction: "India",
  identifierLastFour: "A123",
  issueDate: "2026-01-01",
  effectiveDate: "2026-01-01",
  expiryDate: "2027-01-01",
  renewalDate: "2026-12-01",
  reviewDate: "2026-10-01",
  responseDueDate: null,
  confidentialityLevel: "restricted",
  legalPrivilege: false,
  documentId: "22222222-2222-4222-8222-222222222222",
  documentVersionId: "33333333-3333-4333-8333-333333333333",
  summary: "Corporate tax registration evidence.",
} as const;

describe("legal compliance records", () => {
  it("defines every planned compliance-record category", () => {
    expect(legalComplianceRecordTypes).toHaveLength(11);
    for (const type of legalComplianceRecordTypes) {
      expect(legalComplianceRecordTypeLabels[type]).toBeTruthy();
    }
  });

  it("classifies terminal, expired, response, review, renewal, and current timing states", () => {
    expect(
      legalComplianceTimingState({
        status: "archived",
        expiryDate: null,
        renewalDate: null,
        reviewDate: null,
        responseDueDate: null,
      }),
    ).toBe("archived");
    expect(
      legalComplianceTimingState({
        status: "active",
        expiryDate: "2026-07-16",
        renewalDate: null,
        reviewDate: null,
        responseDueDate: null,
        today: "2026-07-17",
      }),
    ).toBe("expired");
    expect(
      legalComplianceTimingState({
        status: "active",
        expiryDate: null,
        renewalDate: null,
        reviewDate: "2026-07-01",
        responseDueDate: "2026-07-17",
        today: "2026-07-17",
      }),
    ).toBe("response_due");
    expect(
      legalComplianceTimingState({
        status: "active",
        expiryDate: null,
        renewalDate: null,
        reviewDate: "2026-07-17",
        responseDueDate: null,
        today: "2026-07-17",
      }),
    ).toBe("review_due");
    expect(
      legalComplianceTimingState({
        status: "active",
        expiryDate: null,
        renewalDate: "2026-07-17",
        reviewDate: null,
        responseDueDate: null,
        today: "2026-07-17",
      }),
    ).toBe("renewal_due");
  });

  it("validates masked identifiers and date order", () => {
    expect(legalComplianceRecordSchema.safeParse(base).success).toBe(true);
    expect(
      legalComplianceRecordSchema.safeParse({ ...base, identifierLastFour: "FULL-123456" }).success,
    ).toBe(false);
    expect(
      legalComplianceRecordSchema.safeParse({ ...base, expiryDate: "2025-12-31" }).success,
    ).toBe(false);
  });
});
