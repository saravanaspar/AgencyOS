import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const reports = read("src/modules/finance/server/reports.ts");
const financeServer = read("src/modules/finance/server/finance.ts");
const reportUi = read("src/components/finance/finance-reports-section.tsx");
const workspace = read("src/components/finance/finance-workspace.tsx");
const schema = read("src/modules/finance/schemas/finance.ts");
const exportRoute = read("src/app/api/finance/reports/client-statement/route.ts");
const mcp = read("src/modules/mcp/tool-registry.ts");
const moduleAuthorization = read("database/tests/module_authorization.test.sql");
const task = read("TASK.md");

describe("finance report contracts", () => {
  it("derives each required report from issued and approved evidence", () => {
    expect(reports).toContain('filters.tab !== "reports"');
    expect(reports).toContain("revenueByMonth");
    expect(reports).toContain("revenueByClient");
    expect(reports).toContain("projectMargins");
    expect(reports).toContain("revenueByService");
    expect(reports).toContain("expenseByCategory");
    expect(reports).toContain("expenseByProject");
    expect(reports).toContain("paymentCollection");
    expect(reports).toContain("estimateConversion");
    expect(reports).toContain("taxSummary");
    expect(reports).toContain("invoice.issued_at is not null");
    expect(reports).toContain("credit.issued_at is not null");
    expect(reports).toContain("invoice.subtotal_minor - invoice.discount_minor");
    expect(reports).toContain("line.subtotal_minor - line.discount_minor");
    expect(reports).toContain("expense.approval_status = 'approved'");
  });

  it("keeps report values in the organization default currency", () => {
    expect(reports).toContain("invoice.currency = organization.default_currency");
    expect(reports).toContain("credit.currency = organization.default_currency");
    expect(reports).toContain("expense.currency = organization.default_currency");
    expect(reportUi).toContain("foreign-currency records remain excluded until converted");
  });

  it("builds a bounded client statement with invoices, credits, payments, and refunds", () => {
    expect(reports).toContain("FinanceClientStatementEntry");
    expect(reports).toContain("'invoice'::text as entry_type");
    expect(reports).toContain("'credit_note'::text");
    expect(reports).toContain("'payment'::text");
    expect(reports).toContain("'refund'::text");
    expect(reports).toContain("limit 5000");
    expect(reports).toContain("count(*) over ()::bigint as total_entries");
    expect(reports).toContain("isTruncated");
    expect(reports).toContain("balance += debitMinor - creditMinor");
    expect(reports).toContain("entry_id");
    expect(reports).toContain("id: row.entry_id");
    expect(exportRoute).toContain("escapeCsvCell");
    expect(exportRoute).toContain('Cache-Control": "private, no-store"');
    expect(exportRoute).toContain("X-Content-Type-Options");
    expect(exportRoute).toContain("The statement exceeds 5,000 rows");
  });

  it("requires separate export access and audits each successful client-statement CSV", () => {
    expect(exportRoute).toContain("financePermissionKeys.reportView");
    expect(exportRoute).toContain("reportsPermissionKeys.export");
    expect(reports).toContain("permissions.has(financePermissionKeys.reportView)");
    expect(reports).toContain("permissions.has(reportsPermissionKeys.export)");
    expect(financeServer).toContain(
      "canExportReports: context.permissions.has(reportsPermissionKeys.export)",
    );
    expect(reportUi).toContain("data.capabilities.canExportReports");
    expect(reports).toContain('action: "reports.exported"');
    expect(reports).toContain('entityType: "finance_client_statement"');
    expect(reports).toContain('report: "client_statement"');
    expect(exportRoute).toContain("rowCount: rows.length");
    expect(exportRoute.lastIndexOf("auditFinanceClientStatementExport")).toBeLessThan(
      exportRoute.indexOf("return new Response(csv"),
    );
  });

  it("adds date filters, permission-aware navigation, and an accessible report workspace", () => {
    expect(schema).toContain("from: z.preprocess");
    expect(schema).toContain("to: z.preprocess");
    expect(workspace).toContain("finance-filter-form--reports");
    expect(workspace).toContain("visible: data.capabilities.canViewReports");
    expect(reportUi).toContain('aria-label="Revenue by month"');
    expect(reportUi).toContain('<table className="finance-report-table">');
    expect(reportUi).toContain('<table className="finance-statement-table">');
    expect(reportUi).toContain('<ol className="finance-ranked-list"');
    expect(reportUi).toContain('<caption className="sr-only">Project gross profit</caption>');
    expect(reportUi).toContain('<caption className="sr-only">Client statement entries</caption>');
    expect(reportUi).not.toContain('role="table"');
    expect(reportUi).not.toContain('role="list"');
    expect(reportUi).toContain("Download CSV");
  });

  it("exposes report dates through MCP without broadening employee access", () => {
    expect(mcp).toContain('format: "date"');
    expect(mcp).toContain("from: typeof input.from");
    expect(mcp).toContain("to: typeof input.to");
    expect(moduleAuthorization).toContain(
      "employee receives own-expense finance access without organization reports",
    );
    expect(moduleAuthorization).toContain("'finance.report.view'");
  });

  it("marks the Stage 7 report and statement backlog complete", () => {
    expect(task).toContain("### Feature 14 — Finance foundation — COMPLETE");
    expect(task).toContain("7. [x] Finance and invoicing.");
    expect(task).toContain("- [x] Client statement");
  });
});
