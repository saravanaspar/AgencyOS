import { describe, expect, it } from "vitest";
import { bootstrapOrganizationSchema } from "@/modules/organizations/schemas/organization";
import { inviteMembershipSchema } from "@/modules/identity/schemas/membership";
import {
  permissionGrantSchema,
  permissionKeySchema,
} from "@/modules/permissions/schemas/permission";

const userId = "3ea3a245-4c3d-4c77-a708-b6dd28a8cd4f";
const organizationId = "5af9bc2b-529d-424a-997a-b9a5a4310c93";
const roleId = "441669d7-2c76-4ab4-870a-6d8192884704";

describe("organization validation", () => {
  it("normalizes country and currency codes", () => {
    const result = bootstrapOrganizationSchema.parse({
      userId,
      legalName: "Northwind Agency Ltd",
      slug: "northwind-agency",
      countryCode: "in",
      defaultCurrency: "inr",
    });

    expect(result.countryCode).toBe("IN");
    expect(result.defaultCurrency).toBe("INR");
    expect(result.timezone).toBe("UTC");
  });

  it("rejects unsafe slugs", () => {
    expect(() =>
      bootstrapOrganizationSchema.parse({
        userId,
        legalName: "Northwind Agency Ltd",
        slug: "Northwind Agency",
      }),
    ).toThrow();
  });
});

describe("membership validation", () => {
  it("normalizes invited email addresses", () => {
    const result = inviteMembershipSchema.parse({
      organizationId,
      email: "USER@EXAMPLE.COM",
      roleIds: [roleId],
    });

    expect(result.email).toBe("user@example.com");
    expect(result.expiresInHours).toBe(72);
  });

  it("requires at least one role", () => {
    expect(() =>
      inviteMembershipSchema.parse({
        organizationId,
        email: "user@example.com",
        roleIds: [],
      }),
    ).toThrow();
  });
});

describe("permission validation", () => {
  it("accepts module.resource.action keys and scoped grants", () => {
    expect(permissionKeySchema.parse("settings.user.manage_access")).toBe(
      "settings.user.manage_access",
    );

    expect(
      permissionGrantSchema.parse({
        permissionKey: "projects.task.update",
        scope: "assigned_or_created",
      }),
    ).toEqual({
      permissionKey: "projects.task.update",
      scope: "assigned_or_created",
      conditions: {},
    });
  });

  it("rejects the old resource.action.scope format when it contains invalid segments", () => {
    expect(() => permissionKeySchema.parse("project.update.entire-organization")).toThrow();
  });
});
