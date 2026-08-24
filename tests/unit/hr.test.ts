import { describe, expect, it } from "vitest";

import { humanizeHrValue } from "@/modules/hr/hr";
import {
  designationCreateSchema,
  employeeProfileSchema,
  ownEmployeeProfileSchema,
} from "@/modules/hr/schemas/hr";

const membershipId = "11111111-1111-4111-8111-111111111111";

describe("HR employee validation", () => {
  it("normalizes optional employee and designation fields", () => {
    expect(
      designationCreateSchema.parse({
        name: "  Senior Designer  ",
        code: " sd ",
        description: " ",
      }),
    ).toEqual({ name: "Senior Designer", code: "SD", description: null });

    const employee = employeeProfileSchema.parse({
      membershipId,
      employeeNumber: " emp-001 ",
      designationId: "",
      departmentId: "",
      managerMembershipId: "",
      legalName: "  Ada Lovelace ",
      preferredName: " Ada ",
      personalEmail: "ada@example.test",
      personalPhone: " ",
      dateOfBirth: "1815-12-10",
      nationality: " British ",
      joiningDate: "2026-07-17",
      employmentType: "full_time",
      workLocation: " London ",
      workMode: "hybrid",
      lifecycleStatus: "active",
      weeklyHours: "40",
    });

    expect(employee).toMatchObject({
      employeeNumber: "EMP-001",
      designationId: null,
      legalName: "Ada Lovelace",
      preferredName: "Ada",
      personalPhone: null,
      weeklyHours: 40,
    });
  });

  it("rejects invalid employment boundaries", () => {
    const result = employeeProfileSchema.safeParse({
      membershipId,
      employeeNumber: "EMP 001",
      designationId: "",
      departmentId: "",
      managerMembershipId: "",
      legalName: "Ada",
      preferredName: "",
      personalEmail: "not-an-email",
      personalPhone: "",
      dateOfBirth: "",
      nationality: "",
      joiningDate: "",
      employmentType: "permanent",
      workLocation: "",
      workMode: "home",
      lifecycleStatus: "active",
      weeklyHours: "200",
    });

    expect(result.success).toBe(false);
  });

  it("keeps employee self-service limited to personal contact fields", () => {
    const parsed = ownEmployeeProfileSchema.parse({
      membershipId,
      preferredName: "Ada",
      personalEmail: "ada@example.test",
      personalPhone: "+44 20 0000 0000",
    });

    expect(Object.keys(parsed).sort()).toEqual([
      "membershipId",
      "personalEmail",
      "personalPhone",
      "preferredName",
    ]);
  });

  it("humanizes HR enum values", () => {
    expect(humanizeHrValue("notice_period")).toBe("Notice Period");
    expect(humanizeHrValue(null)).toBe("Not set");
  });
});
