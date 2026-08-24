import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("HR leave-management contract", () => {
  it("reuses shared approvals and atomically reserves balances", () => {
    const actions = read("src/modules/hr/actions/leave.ts");
    const approvals = read("src/modules/approvals/server/approvals.ts");

    expect(actions).toContain("ensureHrApprovalPolicy");
    expect(actions).toContain("submitApprovalForRecordAtomically");
    expect(actions).toContain('selectorType: "manager"');
    expect(actions).toContain('selectorType: "role"');
    expect(actions).toContain('selectorRoleKey: "hr_manager"');
    expect(actions).toContain("reserved_days = reserved_days +");
    expect(approvals).toContain("export async function submitApprovalForRecordAtomically");
    expect(approvals).toContain("const result = await database.begin");
  });

  it("creates tenant-isolated leave policies, balances, requests, evidence, and history", () => {
    const migration = read("database/migrations/20260717003200_hr_leave_management.sql");

    for (const table of [
      "hr_leave_types",
      "hr_leave_balances",
      "hr_leave_requests",
      "hr_leave_request_attachments",
      "hr_leave_balance_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.refresh_hr_leave_balance");
    expect(migration).toContain("- coalesce(previous.reserved_days, 0)");
    expect(migration).toContain("private.sync_hr_leave_request_from_approval");
    expect(migration).toContain("approval_requests_sync_hr_leave_request");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("team_conflict_count");
  });

  it("keeps evidence private and scanner-gated", () => {
    const upload = read("src/app/api/hr/leave-requests/[requestId]/attachment/route.ts");
    const attachment = read("src/app/api/hr/leave-attachments/[attachmentId]/route.ts");

    expect(upload).toContain("createQuarantinedPrivateFile");
    expect(upload).toContain('entityType: "hr_leave_request"');
    expect(upload).toContain('status: "quarantined"');
    expect(attachment).toContain('row.file_status !== "available"');
    expect(attachment).toContain('createHash("sha256")');
    expect(attachment).toContain("isAllowedApplicationOrigin");
  });

  it("ships policy, self-service, calendar, conflict, cancellation, and balance-history UI", () => {
    const component = read("src/components/hr/hr-leave.tsx");

    expect(component).toContain("saveLeaveTypeAction");
    expect(component).toContain("saveLeaveDraftAction");
    expect(component).toContain("submitLeaveRequestAction");
    expect(component).toContain("cancelLeaveRequestAction");
    expect(component).toContain("Team leave calendar");
    expect(component).toContain("Team conflicts");
    expect(component).toContain("Balance adjustment history");
    expect(component).toContain("Upload evidence");
  });

  it("audits every direct leave mutation and exposes aggregate-only MCP data", () => {
    const actions = read("src/modules/hr/actions/leave.ts");
    const registry = read("src/modules/mcp/tool-registry.ts");

    expect(actions).toContain('action: "hr.leave_type_created"');
    expect(actions).toContain('action: "hr.leave_type_status_changed"');
    expect(actions).toContain('action: "hr.leave_balances_refreshed"');
    expect(actions).toContain('action: "hr.leave_balance_adjusted"');
    expect(actions).toContain('action: "hr.leave_request_draft_created"');
    expect(actions).toContain('action: "hr.leave_request_submitted"');
    expect(registry).toContain("data.leave.summary");
    expect(registry).toContain("data.leave.balances");
    expect(registry).not.toContain("leaveReason");
  });
});
