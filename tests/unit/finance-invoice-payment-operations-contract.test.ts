import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const migration = read("database/migrations/20260716002400_finance_invoice_payment_operations.sql");
const actions = read("src/modules/finance/actions/finance.ts");
const workspace = read("src/components/finance/finance-workspace.tsx");
const snapshots = read("src/modules/finance/server/document-snapshots.ts");
const overdueWorker = read("src/modules/finance/server/overdue-worker.ts");
const workerRegistry = read("src/modules/workers/server/worker-registry.ts");
const workerRoute = read("src/app/api/internal/workers/run/route.ts");
const attachmentUpload = read("src/app/api/finance/invoices/[invoiceId]/attachments/route.ts");
const attachmentDownload = read("src/app/api/finance/attachments/[attachmentId]/route.ts");
const delivery = read("src/modules/finance/server/document-delivery.ts");

describe("finance invoice and payment operations contracts", () => {
  it("stores invoice attachments through the existing quarantined MinIO private-file path", () => {
    expect(migration).toContain("create table public.finance_invoice_attachments");
    expect(migration).toContain("Attachments on an issued invoice are immutable");
    expect(attachmentUpload).toContain("createQuarantinedPrivateFile");
    expect(attachmentUpload).toContain('moduleKey: "finance"');
    expect(attachmentDownload).toContain("readMinioObject");
    expect(attachmentDownload).toContain('createHash("sha256")');
    expect(workspace).toContain("InvoiceAttachmentControls");
  });

  it("records viewed and disputed evidence and schedules overdue transitions idempotently", () => {
    expect(actions).toContain("updateInvoiceStatusAction");
    expect(actions).toContain("dispute_resolved");
    expect(overdueWorker).toContain("for update of invoice skip locked");
    expect(overdueWorker).toContain(
      "invoice.status in ('issued', 'sent', 'viewed', 'partially_paid')",
    );
    expect(overdueWorker).toContain("finance.invoice.overdue");
    expect(workerRegistry).toContain('key === "finance-overdue"');
    expect(workerRegistry).toContain('leaseName: "finance-overdue"');
    expect(workerRegistry).toContain("runFinanceOverdueWorker");
    expect(workerRoute).toContain("INTERNAL_WORKER_SECRET");
  });

  it("freezes exchange-rate evidence when an invoice is issued", () => {
    expect(migration).toContain("finance_invoices_exchange_rate_positive");
    expect(migration).toContain("prevent_issued_invoice_exchange_rate_mutation");
    expect(actions).toContain("'exchangeRate', invoice.exchange_rate");
    expect(snapshots).toContain("exchangeRate: row.exchange_rate");
    expect(workspace).toContain('name="exchangeRate"');
  });

  it("creates immutable payment receipts and bounded refunds", () => {
    expect(migration).toContain("create table public.finance_payment_refunds");
    expect(migration).toContain("Refund exceeds the original payment amount");
    expect(migration).toContain("Payment refunds are immutable");
    expect(migration).toContain("'payment_receipt'");
    expect(actions).toContain("recordPaymentRefundAction");
    expect(snapshots).toContain('documentType: "Payment Receipt"');
    expect(snapshots).not.toContain("refundedMinor");
    expect(snapshots).not.toContain("refundState");
    expect(workspace).toContain("PaymentReceiptControls");
    expect(workspace).toContain("PaymentRefundForm");
  });

  it("uses one reusable calculated email template for finance documents", () => {
    expect(delivery).toContain("buildFinanceDocumentEmailTemplate");
    expect(delivery).toContain("formatMinorMoney");
    expect(actions).toContain("loadFinanceEmailTemplate");
    expect(actions).toContain("messageText: message.text");
    expect(actions).toContain("messageHtml: message.html");
  });
});
