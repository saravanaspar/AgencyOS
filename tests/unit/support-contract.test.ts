import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("support ticket contracts", () => {
  it("creates scoped ticket, message, watcher, event, and counter records with RLS", () => {
    const migration = source("database/migrations/20260717004400_support_ticket_foundation.sql");
    for (const table of [
      "support_ticket_counters",
      "support_ticket_categories",
      "support_tickets",
      "support_ticket_messages",
      "support_ticket_watchers",
      "support_ticket_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.support_ticket_membership_access_allowed");
    expect(migration).toContain("private.support_ticket_access_allowed");
    expect(migration).toContain("private.prevent_support_history_mutation");
    expect(migration).toContain(
      "p_permission_key in ('support.ticket.view', 'support.ticket.reply')",
    );
    expect(migration).toContain("grant select (id, organization_id, ticket_id, event_type");
    expect(migration).not.toContain(
      "grant select on public.support_ticket_events to authenticated",
    );
  });

  it("implements SLA timestamps, waiting-clock pause, immutable history, and safe lifecycle transitions", () => {
    const migration = source("database/migrations/20260717004400_support_ticket_foundation.sql");
    expect(migration).toContain("first_response_due_at timestamptz not null");
    expect(migration).toContain("resolution_due_at timestamptz not null");
    expect(migration).toContain("waiting_total_seconds bigint not null default 0");
    const actions = source("src/modules/support/actions/support.ts");
    expect(actions).toContain("first_response_due_at + (now() - waiting_started_at)");
    expect(actions).toContain("resolution_due_at + (now() - waiting_started_at)");
    expect(actions).toContain("waiting_total_seconds = waiting_total_seconds + case");
    expect(actions).toContain("const lifecyclePastTense");
    expect(actions).toContain('reopen: "reopened"');
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("enqueueNotification");
  });

  it("reuses CRM, Projects, Documents, and permission-scoped selectors", () => {
    const server = source("src/modules/support/server/support.ts");
    expect(server).toContain("private.crm_scope_allows_membership");
    expect(server).toContain("private.project_is_visible");
    expect(server).toContain('project.company_id as "companyId"');
    expect(server).not.toContain('project.crm_company_id as "companyId"');
    expect(server).toContain("private.document_membership_access_allowed");
    const actions = source("src/modules/support/actions/support.ts");
    expect(actions).toContain("requireDocumentEntityAccess");
    expect(actions).toContain("requireDocumentAccess");
    expect(actions).toContain("document_entity_links");
    const documents = source("src/modules/documents/documents.ts");
    expect(documents).toContain('"ticket"');
  });

  it("ships a responsive workspace and metadata-only MCP search", () => {
    expect(source("src/app/(workspace)/support/page.tsx")).toContain("getSupportWorkspaceData");
    const component = source("src/components/support/support-workspace.tsx");
    expect(component).toContain("Internal note — never shown to clients");
    expect(component).toContain("TicketLifecycle");
    expect(component).toContain("if (!ticket.canRate) return null");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    expect(mcp).toContain("agencyos.support.search_tickets");
    const tool = mcp.slice(mcp.indexOf("agencyos.support.search_tickets"));
    expect(tool.slice(0, 6000)).not.toMatch(/message\.body|satisfactionComment|watchers:/);
  });
});
