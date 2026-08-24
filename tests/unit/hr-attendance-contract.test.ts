import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("HR attendance contract", () => {
  it("reuses the shared approval engine for corrections", () => {
    const actions = read("src/modules/hr/actions/attendance.ts");

    const policyHelper = read("src/modules/hr/actions/approval-policies.ts");

    expect(actions).toContain("ensureHrApprovalPolicy");
    expect(actions).toContain("submitApprovalForRecord");
    expect(policyHelper).toContain("createApprovalDefinition");
    expect(actions).toContain('selectorType: "manager"');
    expect(actions).toContain('entityType: "attendance_correction"');
  });

  it("applies approval outcomes atomically in the database", () => {
    const migration = read("database/migrations/20260717003100_hr_attendance_corrections.sql");

    expect(migration).toContain("create table public.hr_attendance_records");
    expect(migration).toContain("create table public.hr_attendance_corrections");
    expect(migration).toContain("sync_hr_attendance_correction_from_approval");
    expect(migration).toContain("after update of status on public.approval_requests");
    expect(migration).toContain(
      "alter table public.hr_attendance_records enable row level security",
    );
    expect(migration).toContain(
      "alter table public.hr_attendance_corrections enable row level security",
    );
  });

  it("keeps attendance permission-scoped and timezone-aware", () => {
    const server = read("src/modules/hr/server/attendance.ts");
    const actions = read("src/modules/hr/actions/attendance.ts");

    expect(server).toContain("private.crm_scope_allows_membership");
    expect(server).toContain("timezone(organization.timezone, now())");
    expect(actions).toContain("hrPermissionKeys.attendanceManage");
    expect(actions).toContain("You can request a correction only for your own attendance");
  });

  it("ships self-service, manual management, summaries, and correction UI", () => {
    const component = read("src/components/hr/hr-attendance.tsx");

    expect(component).toContain("attendanceCheckAction");
    expect(component).toContain("saveManualAttendanceAction");
    expect(component).toContain("requestAttendanceCorrectionAction");
    expect(component).toContain("Correction requests");
    expect(component).toContain("Recorded days");
  });
});
