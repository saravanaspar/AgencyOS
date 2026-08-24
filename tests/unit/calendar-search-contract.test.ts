import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("calendar and global-search contracts", () => {
  it("creates tenant-scoped calendar records with permission-filtered RLS", () => {
    const migration = source(
      "database/migrations/20260718004700_calendar_global_search_foundation.sql",
    );
    for (const table of ["calendar_events", "calendar_event_attendees", "calendar_event_events"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.calendar_event_membership_access_allowed");
    expect(migration).toContain("private.calendar_event_access_allowed");
    expect(migration).toContain("private.calendar_event_management_allowed");
    expect(migration).toContain("private.prevent_calendar_history_mutation");
    expect(migration).toContain("Calendar history is append-only");
    expect(migration).toContain("calendar_events_scope_target_valid");
    expect(migration).toContain("where membership.id = new.membership_id");
    expect(migration).toContain("where membership.id = new.added_by_membership_id");
    expect(migration).not.toMatch(/\bend\s+then\b/i);
  });

  it("projects dates from source modules without copying them into calendar storage", () => {
    const server = source("src/modules/calendar/server/calendar.ts");
    for (const sourceTable of [
      "public.projects",
      "public.project_tasks",
      "public.project_milestones",
      "public.finance_invoices",
      "public.legal_contracts",
      "public.hr_leave_requests",
      "public.hr_onboarding_plans",
      "public.assets",
      "public.asset_assignments",
      "public.procurement_purchase_requests",
      "public.procurement_purchase_orders",
    ]) {
      expect(server).toContain(sourceTable);
    }
    expect(server).toContain("private.project_is_visible");
    expect(server).toContain("private.legal_contract_membership_access_allowed");
    expect(server).toContain("private.asset_membership_access_allowed");
    expect(server).toContain("private.purchase_request_membership_access_allowed");
    expect(server).toContain("private.purchase_order_membership_access_allowed");
  });

  it("ships month, week, day, and agenda views plus agency-created events", () => {
    expect(source("src/app/(workspace)/calendar/page.tsx")).toContain("getCalendarWorkspaceData");
    const workspace = source("src/components/calendar/calendar-workspace.tsx");
    expect(workspace).toContain("calendar-grid--");
    expect(workspace).toContain("Create agency event");
    expect(workspace).toContain("calendarViews.map");
    const actions = source("src/modules/calendar/actions/calendar.ts");
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("calendar_event_events");
  });

  it("filters global metadata search before display and excludes sensitive payloads", () => {
    const search = source("src/modules/search/server/search.ts");
    expect(search).toContain("globalSearchPermissionKey");
    for (const helper of [
      "private.crm_scope_allows_membership",
      "private.project_is_visible",
      "private.support_ticket_membership_access_allowed",
      "private.document_membership_access_allowed",
      "private.legal_contract_membership_access_allowed",
      "private.asset_membership_access_allowed",
      "private.vendor_membership_access_allowed",
      "private.purchase_request_membership_access_allowed",
      "private.purchase_order_membership_access_allowed",
      "private.calendar_event_membership_access_allowed",
    ]) {
      expect(search).toContain(helper);
    }
    expect(search).not.toMatch(
      /personal_email|personal_phone|date_of_birth|nationality|salary|bank_account|tax_identifier|payment_instructions|document\.content|contract\.notes|ticket\.description/,
    );
    expect(source("src/app/api/search/route.ts")).toContain('"Cache-Control": "private, no-store"');
    expect(source("src/components/shell/command-palette.tsx")).toContain("/api/search");
    expect(source("src/app/(workspace)/search/page.tsx")).toContain("searchAuthorizedRecords");
  });
});
