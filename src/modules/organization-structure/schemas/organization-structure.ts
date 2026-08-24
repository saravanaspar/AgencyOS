import { z } from "zod";

function emptyStringToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const entityId = z.uuid("Select a valid record.");
const entityName = z.string().trim().min(2, "Enter at least 2 characters.").max(100);

export const departmentCreateSchema = z.object({
  name: entityName,
  code: z.preprocess(
    emptyStringToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "Use at least 2 characters.")
      .max(12, "Use no more than 12 characters.")
      .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, hyphens, or underscores.")
      .nullable(),
  ),
});

export const departmentUpdateSchema = departmentCreateSchema.extend({
  departmentId: entityId,
});

export const departmentStatusSchema = z.object({
  departmentId: entityId,
  status: z.enum(["active", "inactive"]),
});

export const departmentDeleteSchema = z.object({
  departmentId: entityId,
});

export const teamCreateSchema = z.object({
  name: entityName,
  description: z.preprocess(
    emptyStringToNull,
    z.string().trim().max(500, "Use no more than 500 characters.").nullable(),
  ),
});

export const teamUpdateSchema = teamCreateSchema.extend({
  teamId: entityId,
});

export const teamStatusSchema = z.object({
  teamId: entityId,
  status: z.enum(["active", "inactive"]),
});

export const teamDeleteSchema = z.object({
  teamId: entityId,
});

export const memberStructureSchema = z
  .object({
    membershipId: entityId,
    departmentId: z.preprocess(emptyStringToNull, entityId.nullable()),
    managerMembershipId: z.preprocess(emptyStringToNull, entityId.nullable()),
  })
  .refine((value) => value.membershipId !== value.managerMembershipId, {
    path: ["managerMembershipId"],
    message: "A member cannot report to themselves.",
  });

export const teamMemberAssignmentSchema = z.object({
  teamId: entityId,
  membershipId: entityId,
  isLead: z.preprocess(
    (value) => value === "on" || value === "true" || value === true,
    z.boolean(),
  ),
});

export const teamMemberRemovalSchema = z.object({
  teamId: entityId,
  membershipId: entityId,
});

export interface OrganizationStructureActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;
