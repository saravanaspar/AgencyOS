import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "database/migrations/20260716002000_finance_foundation.sql"),
  "utf8",
);
const actions = readFileSync(path.join(root, "src/modules/finance/actions/finance.ts"), "utf8");
const workspace = readFileSync(
  path.join(root, "src/components/finance/finance-workspace.tsx"),
  "utf8",
);

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("finance security and workflow contracts", () => {
  it("allocates final document numbers transactionally instead of in browser code", () => {
    expect(migration).toContain("create or replace function private.next_finance_document_number");
    expect(migration).toContain("on conflict (organization_id, document_type, document_year)");
    expect(actions).toContain("select private.next_finance_document_number(");
    expect(workspace).not.toContain("Math.random");
  });

  it("stores duplicate hashes for open estimates and invoice drafts", () => {
    expect(migration).toContain("finance_estimates_draft_content_unique");
    expect(migration).toContain("finance_invoices_draft_content_unique");
    expect(count(actions, "and content_hash = ${hash}")).toBeGreaterThanOrEqual(2);
  });

  it("freezes all financial issue snapshots and rejects issued line mutations", () => {
    expect(actions).toContain("seller_snapshot =");
    expect(actions).toContain("client_snapshot =");
    expect(actions).toContain("calculation_snapshot =");
    expect(actions).toContain("payment_snapshot =");
    expect(migration).toContain("private.prevent_issued_invoice_mutation");
    expect(migration).toContain("private.prevent_issued_invoice_line_mutation");
    expect(migration).toContain("finance_invoice_lines_prevent_issued_mutation");
  });

  it("locks invoices before payment allocation and validates exact allocation totals", () => {
    expect(actions).toContain("for update");
    expect(actions).toContain("The payment amount must equal the invoice allocations.");
    expect(actions).toContain("All allocations must use the selected client and currency.");
  });

  it("routes invoice attachments through the bounded private-file API without credential fields", () => {
    expect(workspace).toContain('type="file"');
    expect(workspace).toContain("/api/finance/invoices/${invoice.id}/attachments");
    expect(workspace).not.toContain("MINIO_SECRET_KEY");
    expect(workspace).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workspace).not.toContain("credential");
  });
});
