import { describe, expect, it } from "vitest";

import {
  calculateLeadQualificationScore,
  leadQualificationLabel,
  normalizeCrmCompanyName,
  normalizeCrmEmail,
  normalizeCrmPhone,
  normalizeCrmPipelineSlug,
} from "@/modules/crm/crm";
import {
  activityCreateSchema,
  companyCreateSchema,
  crmFiltersSchema,
  leadCreateSchema,
} from "@/modules/crm/schemas/crm";

describe("CRM normalization and qualification", () => {
  it("normalizes duplicate-detection fields", () => {
    expect(normalizeCrmEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    expect(normalizeCrmPhone("+1 (555) 010-0200")).toBe("+15550100200");
    expect(normalizeCrmCompanyName("  Acme   Holdings  ")).toBe("acme holdings");
  });

  it("creates safe pipeline slugs", () => {
    expect(normalizeCrmPipelineSlug("  Proposal & Review  ")).toBe("proposal-review");
    expect(normalizeCrmPipelineSlug("Crème Brûlée")).toBe("creme-brulee");
    expect(normalizeCrmPipelineSlug("!!!")).toBeNull();
  });

  it("calculates deterministic qualification scores", () => {
    const score = calculateLeadQualificationScore({
      hasEmail: true,
      hasPhone: true,
      hasEstimatedValue: true,
      hasExpectedCloseDate: false,
      hasOwner: true,
      hasCompanyName: false,
    });

    expect(score).toBe(75);
    expect(leadQualificationLabel(score)).toBe("qualified");
    expect(leadQualificationLabel(55)).toBe("warm");
    expect(leadQualificationLabel(20)).toBe("cold");
  });
});

describe("CRM schemas", () => {
  it("normalizes company currency and nullable fields", () => {
    const parsed = companyCreateSchema.parse({
      legalName: "Acme Ltd",
      displayName: "",
      website: "",
      email: "SALES@EXAMPLE.COM",
      ownerMembershipId: "",
      currency: "usd",
      paymentTermsDays: "45",
      notes: "",
    });

    expect(parsed.currency).toBe("USD");
    expect(parsed.displayName).toBeNull();
    expect(parsed.ownerMembershipId).toBeNull();
    expect(parsed.paymentTermsDays).toBe(45);
  });

  it("requires a valid stage and bounded probability for leads", () => {
    const parsed = leadCreateSchema.safeParse({
      name: "Website redesign",
      leadType: "company",
      stageId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
      estimatedValue: "15000",
      currency: "eur",
      probability: "55",
      ownerMembershipId: "",
      expectedCloseDate: "",
      followUpAt: "",
      email: "buyer@example.com",
      phone: "",
      companyName: "Acme",
      source: "Referral",
      notes: "",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.estimatedValue).toBe(15000);
      expect(parsed.data.currency).toBe("EUR");
      expect(parsed.data.probability).toBe(55);
    }
  });

  it("requires exactly one activity target at the action boundary", () => {
    const parsed = activityCreateSchema.parse({
      leadId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
      companyId: "",
      contactId: "",
      activityType: "follow_up",
      subject: "Call next week",
      details: "",
      dueAt: "2026-08-20T09:00",
    });

    expect(parsed.leadId).toBe("9f322b97-81dd-4bf2-9ca8-e5bca462e0cc");
    expect(parsed.companyId).toBeNull();
  });

  it("requires a due time for explicit follow-up activity", () => {
    expect(
      activityCreateSchema.safeParse({
        leadId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
        companyId: "",
        contactId: "",
        activityType: "follow_up",
        subject: "Call next week",
        details: "",
        dueAt: "",
      }).success,
    ).toBe(false);
  });

  it("parses search, scope filters and pagination safely", () => {
    expect(
      crmFiltersSchema.parse({ q: "  acme ", stage: "", owner: "", status: "", page: "2" }),
    ).toEqual({
      q: "acme",
      stage: null,
      owner: null,
      status: null,
      currency: null,
      scope: null,
      page: 2,
    });
  });
});
