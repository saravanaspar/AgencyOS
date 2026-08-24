import { z } from "zod";

import { permissionScopes } from "@/modules/permissions/permission-scopes";

const entityId = z.uuid("Choose a valid record.");
const roleName = z.string().trim().min(2, "Use at least 2 characters.").max(80);
const description = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(500).nullable(),
);

export const roleCreateSchema = z.object({ name: roleName, description });
export const roleUpdateSchema = roleCreateSchema.extend({ roleId: entityId });
export const roleStatusSchema = z.object({
  roleId: entityId,
  status: z.enum(["active", "inactive"]),
});
export const roleDeleteSchema = z.object({ roleId: entityId });

const grantSchema = z.object({
  permissionId: entityId,
  scope: z.enum(permissionScopes),
});

export const rolePermissionUpdateSchema = z.object({
  roleId: entityId,
  grants: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }, z.array(grantSchema).max(500)),
});

export const memberOverrideSchema = z.object({
  membershipId: entityId,
  permissionId: entityId,
  effect: z.enum(["allow", "deny"]),
  scope: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.enum(permissionScopes).nullable(),
  ),
  reason: z.string().trim().min(3, "Explain why this override is required.").max(300),
  expiresAt: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.iso.datetime({ local: true }).nullable(),
  ),
});

export const memberOverrideDeleteSchema = z.object({
  membershipId: entityId,
  permissionId: entityId,
});

export interface RoleEditorActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}
