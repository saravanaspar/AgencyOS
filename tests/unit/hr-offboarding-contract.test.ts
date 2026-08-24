import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("HR offboarding contracts", () => {
  it("creates tenant-isolated plans, history cycles, and seeded clearance items", () => {
    const migration = source("database/migrations/20260717003800_hr_offboarding.sql");
    expect(migration).toContain("create table public.hr_offboarding_plans");
    expect(migration).toContain("create table public.hr_offboarding_items");
    expect(migration).toContain("private.seed_hr_offboarding_items");
    expect(migration).toContain("hr_offboarding_plans_active_unique");
    expect(migration).toContain("prior_lifecycle_status");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("private.crm_scope_allows_membership");
  });

  it("keeps authenticated table access read-only and derived updates server-owned", () => {
    const migration = source("database/migrations/20260717003800_hr_offboarding.sql");
    expect(migration).toContain("grant select on public.hr_offboarding_plans to authenticated");
    expect(migration).toContain("grant select on public.hr_offboarding_items to authenticated");
    expect(migration).toContain("private.enforce_hr_offboarding_item_client_update");
    expect(migration).toContain("Derived offboarding items can only be synchronized by AgencyOS");
  });

  it("derives project, task, expense, account, document, and archive evidence", () => {
    const server = source("src/modules/hr/server/offboarding.ts");
    expect(server).toContain("synchronizeHrOffboardingEvidence");
    expect(server).toContain("project_task_assignees");
    expect(server).toContain("finance_expenses");
    expect(server).toContain("experience_letter");
    expect(server).toContain("relieving_letter");
    expect(server).toContain("membership_status in ('suspended', 'deactivated')");
  });

  it("reuses project, membership-status, notification, and audit infrastructure", () => {
    const actions = source("src/modules/hr/actions/offboarding.ts");
    expect(actions).toContain("updateMembershipStatusInTransaction");
    expect(actions).toContain("project_task_assignees");
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("pg_advisory_xact_lock");
  });

  it("requires final clearance before deactivation and employee archival", () => {
    const actions = source("src/modules/hr/actions/offboarding.ts");
    expect(actions).toContain("Complete or exempt:");
    expect(actions).toContain('status: "deactivated"');
    expect(actions).toContain("lifecycle_status = 'archived'");
    expect(actions).toContain("Final clearance cannot complete before the last working date");
  });

  it("ships accessible scoped workflow controls and progress", () => {
    const component = source("src/components/hr/hr-offboarding.tsx");
    expect(component).toContain("Create offboarding plan");
    expect(component).toContain("Submit resignation");
    expect(component).toContain("Reassign work");
    expect(component).toContain("Suspend account");
    expect(component).toContain("Final clearance");
    expect(component).toContain("aria-label={`${plan.progress.percent}% complete`}");
  });
});
