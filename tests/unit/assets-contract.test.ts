import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("asset management contracts", () => {
  it("creates tenant-scoped register, assignment, condition, maintenance, and event records with RLS", () => {
    const migration = source("database/migrations/20260718004500_asset_management_foundation.sql");
    for (const table of [
      "asset_categories",
      "assets",
      "asset_assignments",
      "asset_condition_events",
      "asset_maintenance_records",
      "asset_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.asset_membership_access_allowed");
    expect(migration).toContain("private.asset_access_allowed");
    expect(migration).toContain("private.prevent_asset_history_mutation");
    expect(migration).toContain("create unique index asset_assignments_active_asset_idx");
    expect(migration).toContain("grant select (id, organization_id, asset_id, event_type");
    expect(migration).not.toContain("grant select on public.asset_events to authenticated");
  });

  it("records custody, acknowledgement, return, maintenance, disposal, notifications, and audits", () => {
    const actions = source("src/modules/assets/actions/assets.ts");
    for (const action of [
      "assets.asset_registered",
      "assets.asset_assigned",
      "assets.assignment_acknowledged",
      "assets.asset_returned",
      "assets.${parsed.data.eventType}_recorded",
      "assets.maintenance_started",
      "assets.maintenance_completed",
      "assets.asset_disposed",
      "assets.document_linked",
    ]) {
      expect(actions).toContain(action);
    }
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("requireAssetAccess");
    expect(actions).toContain("for update");
  });

  it("extends Documents with permission-scoped asset relationships", () => {
    const migration = source("database/migrations/20260718004500_asset_management_foundation.sql");
    expect(migration).toContain("'ticket', 'asset'");
    expect(migration).toContain("when 'asset' then select exists");
    const documents = source("src/modules/documents/documents.ts");
    expect(documents).toContain('"asset"');
    const server = source("src/modules/documents/server/documents.ts");
    expect(server).toContain("private.asset_membership_access_allowed");
    expect(server).toContain("when 'asset' then");
  });

  it("ships a responsive workspace and metadata-only MCP search", () => {
    expect(source("src/app/(workspace)/assets/page.tsx")).toContain("getAssetWorkspaceData");
    const component = source("src/components/assets/assets-workspace.tsx");
    expect(component).toContain("Assignment and return");
    expect(component).toContain("Condition and incidents");
    expect(component).toContain("Immutable history");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(mcp).toContain("agencyos.assets.search_assets");
    const tool = mcp.slice(mcp.indexOf("agencyos.assets.search_assets"));
    const boundedTool = tool.slice(0, tool.indexOf("agencyos.support.search_tickets"));
    expect(boundedTool).not.toMatch(
      /asset\.notes|record\.details|record\.outcome|disposalReason|events:/,
    );
  });
});
