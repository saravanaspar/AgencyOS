import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("reports and management-dashboard contracts", () => {
  it("adds a separate sensitive export permission without duplicating operational ledgers", () => {
    const migration = source(
      "database/migrations/20260718004800_reports_management_dashboards.sql",
    );
    expect(migration).toContain("'reports',\n  'export',\n  'create'");
    expect(migration).toContain("true");
    expect(migration).toContain("reports.export.create");
    expect(migration).toContain("no parallel summary tables");
    expect(migration).not.toContain("create table public.report");
    expect(migration).not.toContain("create materialized view");
  });

  it("uses source-module visibility helpers before aggregating reports", () => {
    const reports = source("src/modules/reports/server/reports.ts");
    for (const helper of [
      "private.crm_scope_allows_membership",
      "private.project_is_visible",
      "private.support_ticket_membership_access_allowed",
      "private.legal_contract_membership_access_allowed",
      "private.legal_compliance_record_membership_access_allowed",
    ]) {
      expect(reports).toContain(helper);
    }
    expect(reports).toContain("financePermissionKeys.reportView");
    expect(reports).not.toMatch(
      /personal_email|personal_phone|date_of_birth|nationality|salary_amount|bank_account|tax_identifiers|payment_instructions|ticket\.description|document\.description/,
    );
  });

  it("ships role-aware dashboards and replaces static demo arrays", () => {
    const page = source("src/app/(workspace)/dashboard/page.tsx");
    const server = source("src/modules/dashboard/server/dashboard.ts");
    const domain = source("src/modules/dashboard/dashboard.ts");
    expect(page).toContain("getDashboardWorkspaceData");
    expect(page).not.toContain("const summary =");
    expect(domain).toContain('export type DashboardMode = "owner" | "manager" | "employee"');
    expect(server).toContain("ownerDashboard");
    expect(server).toContain("managerDashboard");
    expect(server).toContain("employeeDashboard");
    expect(server).toContain("private.document_membership_access_allowed");
    expect(server).toContain("private.asset_membership_access_allowed");
  });

  it("keeps CSV exports permission-gated, formula-safe, no-store, and audited", () => {
    const route = source("src/app/api/reports/export/route.ts");
    const csv = source("src/modules/reports/csv.ts");
    const server = source("src/modules/reports/server/reports.ts");
    expect(route).toContain("reportsPermissionKeys.export");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(csv).toContain("escapeCsvCell");
    expect(server).toContain('action: "reports.exported"');
    expect(server).toContain("rowCount");
  });
});
