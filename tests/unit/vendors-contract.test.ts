import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("vendor and procurement contracts", () => {
  it("creates tenant-scoped supplier and order-to-pay records with RLS", () => {
    const migration = source(
      "database/migrations/20260718004600_vendor_procurement_foundation.sql",
    );
    for (const table of [
      "vendors",
      "vendor_financial_profiles",
      "vendor_contacts",
      "vendor_notes",
      "procurement_purchase_requests",
      "procurement_vendor_quotations",
      "procurement_purchase_orders",
      "procurement_goods_receipts",
      "procurement_vendor_bills",
      "vendor_events",
      "procurement_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.vendor_membership_access_allowed");
    expect(migration).toContain("private.purchase_request_membership_access_allowed");
    expect(migration).toContain("private.purchase_order_membership_access_allowed");
    expect(migration).toContain("private.prevent_vendor_history_mutation");
    expect(migration).toContain(
      "private.vendor_access_allowed(vendor_id, 'vendors.vendor.view_sensitive')",
    );
  });

  it("reuses shared approvals, documents, legal contracts, notifications, and audits", () => {
    const actions = source("src/modules/vendors/actions/vendors.ts");
    expect(actions).toContain("submitApprovalForRecordAtomically");
    expect(actions).toContain("createApprovalDefinition");
    expect(actions).toContain("requireDocumentAccess");
    expect(actions).toContain("requireLegalContractAccess");
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("for update");
    const migration = source(
      "database/migrations/20260718004600_vendor_procurement_foundation.sql",
    );
    expect(migration).toContain("private.apply_procurement_approval_result");
    expect(migration).toContain("apply_procurement_approval_result");
  });

  it("completes Vendor and Purchase order document links and Asset vendor linkage", () => {
    const migration = source(
      "database/migrations/20260718004600_vendor_procurement_foundation.sql",
    );
    expect(migration).toContain("add column vendor_id uuid");
    expect(migration).toContain("'vendor', 'purchase_order'");
    expect(migration).toContain("when 'vendor' then select exists");
    expect(migration).toContain("when 'purchase_order' then select exists");
    const documents = source("src/modules/documents/documents.ts");
    expect(documents).toContain('"vendor"');
    expect(documents).toContain('"purchase_order"');
    const documentServer = source("src/modules/documents/server/documents.ts");
    expect(documentServer).toContain("private.vendor_membership_access_allowed");
    expect(documentServer).toContain("private.purchase_order_membership_access_allowed");
    const assets = source("src/modules/assets/actions/assets.ts");
    expect(assets).toContain("vendor_id = ${parsed.data.vendorId}::uuid");
  });

  it("ships a responsive workspace and excludes sensitive procurement data from MCP", () => {
    expect(source("src/app/(workspace)/vendors/page.tsx")).toContain("getVendorWorkspaceData");
    const component = source("src/components/vendors/vendors-workspace.tsx");
    expect(component).toContain("Vendor register");
    expect(component).toContain("Purchase requests");
    expect(component).toContain("Purchase orders");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(mcp).toContain("agencyos.vendors.search_procurement");
    const tool = mcp.slice(mcp.indexOf("agencyos.vendors.search_procurement"));
    const boundedTool = tool.slice(0, tool.indexOf("agencyos.support.search_tickets"));
    expect(boundedTool).not.toMatch(
      /taxIdentifier|bankName|bankAccount|paymentInstructions|note\.content|quote\.notes|receipt\.notes|events:/,
    );
  });
});
