import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("HR employee foundation contract", () => {
  it("ships a dedicated permission-gated People route", () => {
    const page = read("src/app/(workspace)/hr/page.tsx");
    const server = read("src/modules/hr/server/hr.ts");

    expect(page).toContain("getHrWorkspaceData");
    expect(page).toContain("HrWorkspace");
    expect(server).toContain("hrPermissionKeys.workspace");
    expect(server).toContain("private.crm_scope_allows_membership");
  });

  it("reuses memberships, departments, managers, and designation records", () => {
    const server = read("src/modules/hr/server/hr.ts");
    const action = read("src/modules/hr/actions/hr.ts");

    expect(server).toContain("from public.memberships");
    expect(server).toContain("public.departments");
    expect(server).toContain("public.hr_designations");
    expect(action).toContain("update public.memberships");
    expect(action).toContain("on conflict (organization_id, membership_id) do update");
    expect(action).toContain("getMemberStructureAssignmentError");
    expect(action).toContain("Choose an active designation in this organization");
  });

  it("uses projected display-name aliases in PostgreSQL-compatible ordering", () => {
    for (const file of [
      "src/modules/hr/server/hr.ts",
      "src/modules/hr/server/attendance.ts",
      "src/modules/hr/server/leave.ts",
      "src/modules/hr/server/onboarding.ts",
      "src/modules/hr/server/offboarding.ts",
    ]) {
      const server = read(file);
      expect(server).not.toContain("lower(employee_name)");
      expect(server).not.toContain("lower(display_name)");
    }
  });

  it("keeps self-service and HR management as separate server actions", () => {
    const action = read("src/modules/hr/actions/hr.ts");

    expect(action).toContain("saveEmployeeProfileAction");
    expect(action).toContain("updateOwnEmployeeProfileAction");
    expect(action).toContain("hrPermissionKeys.employeeUpdateSelf");
    expect(action).toContain("You can update only your own employee profile");
  });

  it("enables RLS in the same migration as both HR tables", () => {
    const migration = read("database/migrations/20260717003000_hr_employee_foundation.sql");

    expect(migration).toContain("create table public.hr_designations");
    expect(migration).toContain("create table public.hr_employee_profiles");
    expect(migration).toContain("alter table public.hr_designations enable row level security");
    expect(migration).toContain(
      "alter table public.hr_employee_profiles enable row level security",
    );
    expect(migration).toContain("hr.employee.update_self");
    expect(migration).toContain("role_template.key in ('owner', 'hr_manager')");
  });
  it("shares reporting-line validation with organization settings", () => {
    const helper = read("src/modules/organization-structure/server/member-structure-validation.ts");
    const structureAction = read(
      "src/modules/organization-structure/actions/organization-structure.ts",
    );

    expect(helper).toContain("Choose an active department in this organization");
    expect(helper).toContain("Choose an active manager in this organization");
    expect(helper).toContain("That reporting line would create a manager cycle");
    expect(structureAction).toContain("getMemberStructureAssignmentError");
  });
});
