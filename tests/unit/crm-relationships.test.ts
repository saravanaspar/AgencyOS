import { describe, expect, it } from "vitest";

import { companyPrimaryContactSchema } from "@/modules/crm/schemas/crm";

describe("CRM primary-contact input", () => {
  it("accepts a visible contact identifier", () => {
    expect(
      companyPrimaryContactSchema.parse({
        companyId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
        primaryContactId: "b4c9627b-d265-4213-b2eb-e95d4c87b550",
      }),
    ).toEqual({
      companyId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
      primaryContactId: "b4c9627b-d265-4213-b2eb-e95d4c87b550",
    });
  });

  it("normalizes an empty selection to null", () => {
    expect(
      companyPrimaryContactSchema.parse({
        companyId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
        primaryContactId: "",
      }),
    ).toEqual({
      companyId: "9f322b97-81dd-4bf2-9ca8-e5bca462e0cc",
      primaryContactId: null,
    });
  });

  it("rejects malformed identifiers", () => {
    expect(
      companyPrimaryContactSchema.safeParse({
        companyId: "company-1",
        primaryContactId: "contact-1",
      }).success,
    ).toBe(false);
  });
});
