import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("vendor bill document workflow", () => {
  it("reuses the secure Documents upload route for direct vendor bill uploads", () => {
    const billForm = source("src/components/vendors/vendor-bill-form.tsx");
    expect(billForm).toContain('fetch("/api/documents/upload"');
    expect(billForm).toContain('uploadData.set("entityType", "purchase_order")');
    expect(billForm).toContain('uploadData.set("referenceCode", billReference)');
    expect(billForm).toContain('uploadData.set("documentDate", invoiceDate)');
    expect(billForm).toContain("recordVendorBillAction(initialState, billData)");
  });

  it("exposes the source document only when document download access allows it", () => {
    const server = source("src/modules/vendors/server/vendors.ts");
    const workspace = source("src/components/vendors/vendors-workspace.tsx");
    expect(server).toContain("source_document_current_version_id");
    expect(server).toContain("source_document_can_open");
    expect(server).toContain("private.document_membership_access_allowed");
    expect(workspace).toContain("bill.sourceDocumentCanOpen");
    expect(workspace).toContain("bill.sourceDocumentCurrentVersionId");
  });
});
