import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("closure workflow contracts", () => {
  it("creates tenant-scoped Support routing and Asset request records", () => {
    const migration = source("database/migrations/20260718005100_closure_workflows.sql");
    for (const table of [
      "support_ticket_routing_rules",
      "asset_requests",
      "asset_return_requests",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.apply_support_ticket_automatic_triage");
    expect(migration).toContain("support_tickets_automatic_triage");
    expect(migration).toContain("triage_explanation");
  });

  it("uses the shared Approval engine for Asset requests and Vendor bills", () => {
    const assets = source("src/modules/assets/actions/assets.ts");
    const vendors = source("src/modules/vendors/actions/vendors.ts");
    expect(assets).toContain('entityType: "asset_request"');
    expect(assets).toContain("submitApprovalForRecordAtomically");
    expect(vendors).toContain('entityType: "vendor_bill"');
    expect(vendors).toContain("submitVendorBillApprovalAction");
    expect(vendors).toContain(
      "The shared Approval workflow must approve this bill before payment.",
    );
  });

  it("creates return requests from offboarding and transfer records", () => {
    const migration = source("database/migrations/20260718005100_closure_workflows.sql");
    expect(migration).toContain("private.seed_offboarding_asset_return_requests");
    expect(migration).toContain("private.seed_transfer_asset_return_requests");
    expect(migration).toContain("private.sync_offboarding_asset_return_requests");
    expect(migration).toContain("hr_offboarding_asset_return_requests");
    expect(migration).toContain("hr_offboarding_sync_asset_return_requests");
    expect(migration).toContain("memberships_transfer_asset_return_requests");
    expect(migration).toContain("asset_return_requests_active_assignment_idx");
  });

  it("keeps Employee acknowledgement separate from return administration", () => {
    const migration = source("database/migrations/20260718005100_closure_workflows.sql");
    const domain = source("src/modules/assets/assets.ts");
    expect(migration).toContain("assets.return_request.acknowledge");
    expect(migration).toContain("assets.return_request.manage");
    expect(domain).toContain("returnRequestAcknowledge");
    expect(domain).toContain("returnRequestManage");
  });
});
