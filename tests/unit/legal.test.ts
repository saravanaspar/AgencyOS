import { describe, expect, it } from "vitest";

import { legalContractTimingState } from "@/modules/legal/legal";
import { legalContractSchema } from "@/modules/legal/schemas/legal";

describe("legal contract domain", () => {
  it("classifies termination, expiry, notice, renewal, and current states", () => {
    expect(
      legalContractTimingState({
        status: "terminated",
        renewalDate: null,
        endDate: null,
        noticePeriodDays: null,
        today: "2026-07-17",
      }),
    ).toBe("terminated");
    expect(
      legalContractTimingState({
        status: "active",
        renewalDate: null,
        endDate: "2026-07-16",
        noticePeriodDays: null,
        today: "2026-07-17",
      }),
    ).toBe("expired");
    expect(
      legalContractTimingState({
        status: "active",
        renewalDate: null,
        endDate: "2026-08-15",
        noticePeriodDays: 30,
        today: "2026-07-17",
      }),
    ).toBe("notice_due");
    expect(
      legalContractTimingState({
        status: "active",
        renewalDate: "2026-07-17",
        endDate: null,
        noticePeriodDays: null,
        today: "2026-07-17",
      }),
    ).toBe("renewal_due");
    expect(
      legalContractTimingState({
        status: "active",
        renewalDate: "2027-07-17",
        endDate: null,
        noticePeriodDays: null,
        today: "2026-07-17",
      }),
    ).toBe("current");
  });

  it("requires value and currency together and validates date order", () => {
    const base = {
      contractId: null,
      internalReference: "CTR-2026-001",
      title: "Client services agreement",
      contractType: "client_contract",
      counterpartyName: "Acme Pvt Ltd",
      counterpartyCompanyId: null,
      responsibleOwnerMembershipId: "11111111-1111-4111-8111-111111111111",
      departmentId: null,
      templateId: null,
      effectiveDate: "2026-08-01",
      endDate: "2027-07-31",
      renewalDate: null,
      noticePeriodDays: 30,
      jurisdiction: "India",
      governingLaw: "Laws of India",
      contractValueMinor: 100000,
      currency: "INR",
      financeReviewRequired: true,
      ownerApprovalRequired: true,
    } as const;
    expect(legalContractSchema.safeParse(base).success).toBe(true);
    expect(legalContractSchema.safeParse({ ...base, currency: null }).success).toBe(false);
    expect(legalContractSchema.safeParse({ ...base, endDate: "2026-07-01" }).success).toBe(false);
  });
});
