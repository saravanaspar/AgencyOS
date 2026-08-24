import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "database/migrations/20260716002300_finance_credit_notes_corrections.sql"),
  "utf8",
);
const actions = readFileSync(path.join(root, "src/modules/finance/actions/finance.ts"), "utf8");
const snapshots = readFileSync(
  path.join(root, "src/modules/finance/server/document-snapshots.ts"),
  "utf8",
);
const workspace = readFileSync(
  path.join(root, "src/components/finance/finance-workspace.tsx"),
  "utf8",
);
const tools = readFileSync(path.join(root, "src/modules/mcp/tool-registry.ts"), "utf8");

describe("finance credit-note and correction contracts", () => {
  it("requires every revised invoice and credit note to reference an issued original invoice", () => {
    expect(migration).toContain("correction_of_invoice_id uuid references public.finance_invoices");
    expect(migration).toContain("private.validate_invoice_correction_tenant");
    expect(migration).toContain("original_invoice_id uuid not null");
    expect(migration).toContain("private.validate_credit_note_tenant");
    expect(actions).toContain("correctionOfInvoiceId: original.id");
    expect(actions).toContain("originalInvoiceId: invoice.id");
  });

  it("serializes credit application and rejects over-crediting", () => {
    expect(migration).toContain("for update;");
    expect(migration).toContain("Issued credit notes cannot exceed the original invoice total.");
    expect(migration).toContain("credited_minor = total_credit");
    expect(migration).toContain(
      "balance_minor = greatest(total_minor - amount_paid_minor - total_credit, 0)",
    );
    expect(actions).toContain("Credit note total exceeds the remaining uncredited invoice amount.");
  });

  it("freezes issued credit-note financial fields, lines, and snapshots", () => {
    expect(migration).toContain("private.prevent_issued_credit_note_mutation");
    expect(migration).toContain("private.prevent_issued_credit_note_line_mutation");
    expect(migration).toContain("seller_snapshot");
    expect(migration).toContain("original_invoice_snapshot");
    expect(actions).toContain('ensureFinanceDocumentSnapshot(context, "credit_note"');
    expect(snapshots).toContain('documentType: "Credit Note"');
    expect(snapshots).toContain("Original invoice");
  });

  it("reuses the existing private MinIO PDF and idempotent delivery paths", () => {
    expect(snapshots).toContain("putMinioObject");
    expect(snapshots).toContain("PRIVATE_FILE_CLEAN_BUCKET");
    expect(actions).toContain("on conflict (organization_id, request_token) do nothing");
    expect(actions).toContain("insert into public.finance_credit_note_events");
    expect(workspace).toContain('entityType="credit_note"');
  });

  it("exposes credit-note operations only through explicit permissions and MCP tools", () => {
    expect(migration).toContain("finance.credit_note.view");
    expect(migration).toContain("finance.credit_note.issue");
    expect(tools).toContain("agencyos.finance.create_credit_note");
    expect(tools).toContain("agencyos.finance.issue_credit_note");
    expect(tools).toContain("agencyos.finance.void_credit_note");
    expect(tools).toContain("financePermissionKeys.creditNoteIssue");
  });
});
