import { describe, expect, it } from "vitest";

import {
  changeMemberRoleSchema,
  changeMemberStatusSchema,
  grantUserAccessSchema,
} from "@/modules/identity/schemas/access-management";

const membershipId = "3ea3a245-4c3d-4c77-a708-b6dd28a8cd4f";
const roleId = "441669d7-2c76-4ab4-870a-6d8192884704";

describe("access management validation", () => {
  it("normalizes exact-email access grants", () => {
    const result = grantUserAccessSchema.parse({
      email: "  USER@EXAMPLE.COM ",
      roleId,
    });

    expect(result).toEqual({ email: "user@example.com", roleId });
  });

  it("accepts managed membership statuses", () => {
    expect(changeMemberStatusSchema.parse({ membershipId, status: "suspended" })).toEqual({
      membershipId,
      status: "suspended",
    });
  });

  it("rejects invalid roles, memberships, and unsupported statuses", () => {
    expect(() => grantUserAccessSchema.parse({ email: "invalid", roleId: "invalid" })).toThrow();
    expect(() => changeMemberRoleSchema.parse({ membershipId, roleId: "invalid" })).toThrow();
    expect(() => changeMemberStatusSchema.parse({ membershipId, status: "invited" })).toThrow();
  });
});
