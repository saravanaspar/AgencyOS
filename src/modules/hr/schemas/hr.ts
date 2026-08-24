import { z } from "zod";

import { employeeLifecycleStatuses, employmentTypes, workModes } from "@/modules/hr/hr";

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const nullableText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const nullableDate = z.preprocess(emptyToNull, z.iso.date().nullable());
const entityId = z.uuid("Select a valid record.");

export const designationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .max(24)
      .regex(/^[A-Z0-9_-]+$/)
      .nullable(),
  ),
  description: nullableText(1000),
});

export const designationUpdateSchema = designationCreateSchema.extend({ designationId: entityId });
export const designationStatusSchema = z.object({
  designationId: entityId,
  status: z.enum(["active", "inactive"]),
});

export const employeeProfileSchema = z.object({
  membershipId: entityId,
  employeeNumber: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .regex(/^[A-Z0-9_-]+$/)
      .nullable(),
  ),
  designationId: z.preprocess(emptyToNull, entityId.nullable()),
  departmentId: z.preprocess(emptyToNull, entityId.nullable()),
  managerMembershipId: z.preprocess(emptyToNull, entityId.nullable()),
  legalName: nullableText(180),
  preferredName: nullableText(120),
  personalEmail: z.preprocess(emptyToNull, z.email().max(254).nullable()),
  personalPhone: nullableText(40),
  dateOfBirth: nullableDate,
  nationality: nullableText(100),
  joiningDate: nullableDate,
  employmentType: z.preprocess(emptyToNull, z.enum(employmentTypes).nullable()),
  workLocation: nullableText(160),
  workMode: z.preprocess(emptyToNull, z.enum(workModes).nullable()),
  lifecycleStatus: z.enum(employeeLifecycleStatuses),
  weeklyHours: z.preprocess(
    emptyToNull,
    z.coerce.number().min(0).max(168).multipleOf(0.25).nullable(),
  ),
});

export const ownEmployeeProfileSchema = z.object({
  membershipId: entityId,
  preferredName: nullableText(120),
  personalEmail: z.preprocess(emptyToNull, z.email().max(254).nullable()),
  personalPhone: nullableText(40),
});

export interface HrActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}
