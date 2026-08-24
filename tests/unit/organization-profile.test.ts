import { describe, expect, it } from "vitest";

import {
  getChangedOrganizationProfileFields,
  isOrganizationProfileVersionCurrent,
  organizationProfileAuditSnapshot,
  type OrganizationProfileValues,
} from "@/modules/organizations/organization-profile";
import { organizationProfileUpdateSchema } from "@/modules/organizations/schemas/organization-profile";

const baseProfile: OrganizationProfileValues = {
  legalName: "AgencyOS LLC",
  displayName: "AgencyOS",
  countryCode: "US",
  timezone: "America/New_York",
  defaultCurrency: "USD",
  financialYearStartMonth: 1,
};

describe("organization profile validation", () => {
  it("normalizes editable organization fields", () => {
    const result = organizationProfileUpdateSchema.parse({
      legalName: "  AgencyOS India Pvt Ltd  ",
      displayName: "  AgencyOS India ",
      countryCode: "in",
      timezone: "Asia/Kolkata",
      defaultCurrency: "inr",
      financialYearStartMonth: "4",
      expectedUpdatedAt: "2026-07-13T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      legalName: "AgencyOS India Pvt Ltd",
      displayName: "AgencyOS India",
      countryCode: "IN",
      timezone: "Asia/Kolkata",
      defaultCurrency: "INR",
      financialYearStartMonth: 4,
    });
  });

  it("converts optional empty values to null", () => {
    const result = organizationProfileUpdateSchema.parse({
      ...baseProfile,
      displayName: " ",
      countryCode: "",
      expectedUpdatedAt: "2026-07-13T12:00:00.000Z",
    });

    expect(result.displayName).toBeNull();
    expect(result.countryCode).toBeNull();
  });

  it("rejects invalid regional identifiers", () => {
    const result = organizationProfileUpdateSchema.safeParse({
      ...baseProfile,
      countryCode: "India",
      timezone: "Mars/Olympus",
      defaultCurrency: "Rupees",
      expectedUpdatedAt: "2026-07-13T12:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("organization profile change tracking", () => {
  it("returns only fields that changed", () => {
    const changed = getChangedOrganizationProfileFields(baseProfile, {
      ...baseProfile,
      displayName: "AgencyOS Global",
      timezone: "UTC",
    });

    expect(changed).toEqual(["displayName", "timezone"]);
  });

  it("creates an audit-safe snapshot", () => {
    expect(organizationProfileAuditSnapshot(baseProfile)).toEqual(baseProfile);
  });

  it("detects stale optimistic concurrency tokens", () => {
    const current = new Date("2026-07-13T12:01:00.000Z");

    expect(isOrganizationProfileVersionCurrent("2026-07-13T12:01:00.000Z", current)).toBe(true);
    expect(isOrganizationProfileVersionCurrent("2026-07-13T12:00:00.000Z", current)).toBe(false);
  });
});
