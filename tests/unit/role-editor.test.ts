import { describe, expect, it } from "vitest";

import { normalizeRoleKey, normalizeRoleName } from "@/modules/permissions/role-editor-utils";
import {
  memberOverrideSchema,
  roleCreateSchema,
  rolePermissionUpdateSchema,
} from "@/modules/permissions/schemas/role-editor";

const roleId = "11111111-1111-4111-8111-111111111111";
const permissionId = "22222222-2222-4222-8222-222222222222";

describe("role editor validation", () => {
  it("normalizes custom role names and keys", () => {
    expect(normalizeRoleName("  Delivery   Coordinator ")).toBe("Delivery Coordinator");
    expect(normalizeRoleKey("Delivery Coordinator / APAC")).toBe("delivery_coordinator_apac");
  });

  it("accepts a custom role with an optional description", () => {
    expect(roleCreateSchema.parse({ name: "Delivery Coordinator", description: "" })).toEqual({
      name: "Delivery Coordinator",
      description: null,
    });
  });

  it("parses role permission JSON and scope", () => {
    expect(
      rolePermissionUpdateSchema.parse({
        roleId,
        grants: JSON.stringify([{ permissionId, scope: "department" }]),
      }),
    ).toEqual({
      roleId,
      grants: [{ permissionId, scope: "department" }],
    });
  });

  it("requires an override reason and accepts no expiry", () => {
    const result = memberOverrideSchema.safeParse({
      membershipId: roleId,
      permissionId,
      effect: "deny",
      scope: "",
      reason: "Temporary separation of duties",
      expiresAt: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBeNull();
      expect(result.data.expiresAt).toBeNull();
    }
  });
});
