import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const migration = source("database/migrations/20260716002100_finance_document_delivery.sql");
const actions = source("src/modules/finance/actions/finance.ts");
const finance = source("src/modules/finance/server/finance.ts");
const snapshots = source("src/modules/finance/server/document-snapshots.ts");
const delivery = source("src/modules/finance/server/document-delivery.ts");
const resend = source("src/integrations/email/resend.ts");
const route = source("src/app/api/finance/documents/[snapshotId]/route.ts");
const workspace = source("src/components/finance/finance-workspace.tsx");

describe("finance document delivery contracts", () => {
  it("stores generated PDFs as immutable tenant-bound private files", () => {
    expect(migration).toContain("create table public.finance_document_snapshots");
    expect(migration).toContain("finance_document_snapshots_prevent_update");
    expect(migration).toContain("finance_document_snapshots_prevent_delete");
    expect(migration).toContain("v_file.entity_id <> new.id");
    expect(snapshots).toContain("PRIVATE_FILE_CLEAN_BUCKET");
    expect(snapshots).toContain("status = 'available'");
    expect(snapshots).toContain("finance-pdf-integrity-mismatch");
    expect(snapshots).toContain("putMinioObject");
    expect(snapshots).toContain("readMinioObject");
    expect(snapshots).not.toContain(".storage.from(");
  });

  it("uses one conversion and one delivery attempt per idempotency key", () => {
    expect(migration).toContain("finance_invoices_source_estimate_unique");
    expect(migration).toContain("unique (organization_id, request_token)");
    expect(actions).toContain("for update");
    expect(actions).toContain("on conflict (organization_id, request_token) do nothing");
    expect(delivery).toContain("sendEmailWithResend");
    expect(resend).toContain('"idempotency-key"');
  });

  it("requires underlying entity permissions and records download evidence", () => {
    expect(actions).toContain("documentViewPermission(parsed.data.entityType)");
    expect(route).toContain("financePermissionKeys.documentDownload");
    expect(route).toContain("financePermissionKeys.estimateView");
    expect(route).toContain("financePermissionKeys.invoiceView");
    expect(route).toContain('eventType: "file.downloaded"');
    expect(route).toContain('"cache-control": "private, no-store, max-age=0"');
    expect(finance).toContain("on private_event.file_id = private_file.id");
    expect(finance).not.toContain("private_event.private_file_id");
  });

  it("keeps delivery and attachment controls inline without exposing provider credentials", () => {
    expect(workspace).toContain("EstimateClientDecisionForm");
    expect(workspace).toContain("EstimateConversionForm");
    expect(workspace).toContain("DocumentControls");
    expect(workspace).toContain("InvoiceFinancialHistory");
    expect(workspace).toContain("InvoiceAttachmentControls");
    expect(workspace).not.toContain("RESEND_API_KEY");
    expect(workspace).not.toContain("MINIO_SECRET_KEY");
  });
});
