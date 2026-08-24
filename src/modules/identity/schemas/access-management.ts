import { z } from "zod";

export const managedMembershipStatuses = ["active", "suspended", "deactivated"] as const;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

export const grantUserAccessSchema = z.object({
  email: emailSchema,
  roleId: z.uuid("Choose a valid role."),
});

export const changeMemberRoleSchema = z.object({
  membershipId: z.uuid("Invalid membership."),
  roleId: z.uuid("Choose a valid role."),
});

export const changeMemberStatusSchema = z.object({
  membershipId: z.uuid("Invalid membership."),
  status: z.enum(managedMembershipStatuses),
});

export interface AccessManagementActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: {
    email?: string[];
    roleId?: string[];
    membershipId?: string[];
    status?: string[];
  };
}

export type GrantUserAccessInput = z.infer<typeof grantUserAccessSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
export type ChangeMemberStatusInput = z.infer<typeof changeMemberStatusSchema>;
export type ManagedMembershipStatus = (typeof managedMembershipStatuses)[number];
