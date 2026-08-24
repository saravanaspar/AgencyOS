import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const migration = read("database/migrations/20260716002900_finance_expenses.sql");
const actions = read("src/modules/finance/actions/expenses.ts");
const loader = read("src/modules/finance/server/expenses.ts");
const workspace = read("src/components/finance/finance-workspace.tsx");
const expenseSection = read("src/components/finance/expenses-section.tsx");
const receiptUpload = read("src/app/api/finance/expenses/[expenseId]/receipt/route.ts");
const receiptRoute = read("src/app/api/finance/expense-receipts/[receiptId]/route.ts");
const mcp = read("src/modules/mcp/tool-registry.ts");

const expenseTables = [
  "finance_expense_categories",
  "finance_expenses",
  "finance_expense_project_allocations",
  "finance_expense_receipts",
  "finance_expense_events",
];

describe("finance expense contracts", () => {
  it("stores all expense capabilities in tenant-isolated tables", () => {
    for (const table of expenseTables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("expense_type in ('employee', 'project', 'vendor')");
    expect(migration).toContain("amount_minor bigint not null");
    expect(migration).toContain("tax_minor bigint not null default 0");
    expect(migration).toContain("is_billable boolean not null default false");
    expect(migration).toContain("is_reimbursable boolean not null default false");
  });

  it("enforces project allocation, approval, payment, and immutable history rules", () => {
    expect(migration).toContain("Project expenses must be fully allocated to active projects.");
    expect(migration).toContain("Expense project allocations cannot exceed the expense total.");
    expect(migration).toContain(
      "approval_status in ('not_required', 'pending', 'approved', 'rejected')",
    );
    expect(migration).toContain(
      "payment_status in ('unpaid', 'scheduled', 'paid', 'reimbursed', 'waived')",
    );
    expect(migration).toContain("Finance expense event history is immutable.");
    expect(actions).toContain("decideExpenseApprovalAction");
    expect(actions).toContain("updateExpensePaymentStateAction");
  });

  it("reuses private-file quarantine and MinIO integrity checks for receipts", () => {
    expect(migration).toContain("private_file_id uuid not null references public.private_files");
    expect(receiptUpload).toContain("createQuarantinedPrivateFile");
    expect(receiptUpload).toContain('moduleKey: "finance"');
    expect(receiptRoute).toContain("readMinioObject");
    expect(receiptRoute).toContain('createHash("sha256")');
    expect(receiptRoute).toContain("softDeletePrivateFile");
    expect(receiptRoute).toContain("purgePrivateFileObjects");
  });

  it("loads only permission-scoped expense records and summary data", () => {
    expect(loader).toContain('filters.tab !== "expenses"');
    expect(loader).toContain("private.crm_scope_allows_membership");
    expect(loader).toContain("expenseSummary");
    expect(loader).toContain("pending_approval_minor");
    expect(loader).toContain("reimbursable_minor");
    expect(loader).toContain("downloadHref");
  });

  it("adds a responsive expenses workspace and permission-filtered MCP access", () => {
    expect(workspace).toContain('key: "expenses"');
    expect(workspace).toContain('label: "Expenses"');
    expect(workspace).toContain("visible: data.capabilities.canViewExpenses");
    expect(workspace).toContain("<ExpensesSection data={data} />");
    expect(expenseSection).toContain("Record expense");
    expect(expenseSection).toContain("Project allocation");
    expect(expenseSection).toContain("Upload receipt");
    expect(mcp).toContain('"expenses"');
    expect(mcp).toContain("financePermissionKeys.expenseView");
  });
});
