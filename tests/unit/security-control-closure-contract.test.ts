import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const migration = read("database/migrations/20260824006400_security_control_closure.sql");
const financeActions = read("src/modules/finance/actions/finance.ts");
const expenseActions = read("src/modules/finance/actions/expenses.ts");
const financeApproval = read("src/modules/finance/server/approvals.ts");
const financeSchemas = read("src/modules/finance/schemas/finance.ts");
const approvalServer = read("src/modules/approvals/server/approvals.ts");
const exportRoute = read("src/app/api/reports/export/route.ts");
const reportSnapshots = read("src/modules/reports/server/report-snapshots.ts");
const sensitiveBoundary = read("scripts/security/check-sensitive-content-boundaries.mjs");
const restoreVerifier = read("scripts/operations/verify-restore-drill.mjs");
const packageJson = read("package.json");

describe("security control closure", () => {
  it("routes finance decisions through the shared approval engine with amount-aware policies", () => {
    expect(financeApproval).toContain("submitApprovalForRecordAtomically");
    expect(financeApproval).toContain("createApprovalDefinition");
    expect(financeApproval).toContain("financeApprovalAmountFromMinor");
    expect(approvalServer).toContain("conditions.minimumAmount");
    expect(approvalServer).toContain("conditions.maximumAmount");
    expect(financeActions).toContain("submitFinanceApprovalForRecord");
    expect(expenseActions).toContain("submitFinanceApprovalForRecord");
    expect(financeSchemas).toContain('decision: z.literal("submit")');
    expect(financeSchemas).not.toContain('decision: z.enum(["submit", "approve", "reject"])');
  });

  it("requires exact approved shared requests before finance issue or expense payment", () => {
    for (const table of [
      "finance_estimates",
      "finance_invoices",
      "finance_credit_notes",
      "finance_expenses",
    ]) {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).toContain("approval_request_id uuid references public.approval_requests");
    }
    expect(migration).toContain("Finance approval definitions cannot allow self-approval");
    expect(migration).toContain("private.validate_finance_approval_link()");
    expect(migration).toContain("private.apply_finance_approval_result()");
    expect(migration).toContain(
      "Finance documents cannot be issued without completed shared approval",
    );
    expect(migration).toContain("Expense payment processing requires completed shared approval");
    expect(financeActions).toContain('invoice.approval_status !== "approved"');
    expect(financeActions).toContain('note.approval_status !== "approved"');
    expect(expenseActions).toContain('expense.approval_status !== "approved"');
  });

  it("adds a dedicated HR export permission on top of the shared export gate", () => {
    expect(migration).toContain("'hr',\n  'report',\n  'export'");
    expect(migration).toContain("role_template.key in ('owner', 'hr_manager')");
    expect(exportRoute).toContain("reportsPermissionKeys.export");
    expect(exportRoute).toContain("hrPermissionKeys.reportExport");
    expect(exportRoute).toContain("hr-export-permission-required");
    expect(reportSnapshots).toContain("hrPermissionKeys.reportExport");
  });

  it("keeps rich HTML allowlisted and blocks silent medical fields in general HR data", () => {
    expect(sensitiveBoundary).toContain("dangerouslySetInnerHTML");
    expect(sensitiveBoundary).toContain("allowedElements");
    expect(sensitiveBoundary).toContain("validateAndNormalizeHrTemplateHtml(decoded)");
    expect(sensitiveBoundary).toContain("src/modules/hr/medical");
    expect(sensitiveBoundary).toContain(
      "Dedicated HR medical data exists without hr.medical.* permissions",
    );
    expect(packageJson).toContain("security:sensitive-content");
  });

  it("provides a fail-safe post-restore verification harness without fabricating restore evidence", () => {
    expect(restoreVerifier).toContain("AGENCYOS_RESTORE_DRILL");
    expect(restoreVerifier).toContain("RESTORE_DRILL_BACKUP_SET_ID");
    expect(restoreVerifier).toContain("RESTORE_DRILL_TARGET_ID");
    expect(restoreVerifier).toContain("runDeploymentVerification");
    expect(restoreVerifier).toContain("scripts/storage/check-object-storage.mjs");
    expect(restoreVerifier).toContain("scripts/scanner/check-clamav.mjs");
    expect(restoreVerifier).toContain("scripts/workers/run.mjs");
    expect(restoreVerifier).toContain("already-restored isolated environment");
    expect(packageJson).toContain("security:restore-drill:verify");
  });
});
