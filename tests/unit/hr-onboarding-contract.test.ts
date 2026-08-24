import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("HR onboarding contracts", () => {
  it("creates tenant-isolated plans and seeded checklist items", () => {
    const migration = source("database/migrations/20260717003700_hr_onboarding.sql");
    expect(migration).toContain("create table public.hr_onboarding_plans");
    expect(migration).toContain("create table public.hr_onboarding_items");
    expect(migration).toContain("private.seed_hr_onboarding_items");
    expect(migration).toContain("unique (organization_id, membership_id, cycle_number)");
    expect(migration).toContain("hr_onboarding_plans_active_unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("private.crm_scope_allows_membership");
  });

  it("restricts employee writes to their own policy acknowledgement", () => {
    const migration = source("database/migrations/20260717003700_hr_onboarding.sql");
    expect(migration).toContain("private.enforce_hr_onboarding_item_employee_update");
    expect(migration).toContain(
      "Employees may only accept their own offer or acknowledge their own onboarding policies",
    );
    expect(migration).toContain("item_key in ('offer_accepted', 'policies_acknowledged')");
    expect(migration).toContain("hr.onboarding.update_own");
  });

  it("derives existing facts instead of copying identity, structure, or document state", () => {
    const server = source("src/modules/hr/server/onboarding.ts");
    expect(server).toContain("synchronizeHrOnboardingEvidence");
    expect(server).toContain("membership.department_id is not null");
    expect(server).toContain("membership.manager_membership_id is not null");
    expect(server).not.toContain("create table");
  });

  it("reuses audit and notifications while keeping server authorization explicit", () => {
    const actions = source("src/modules/hr/actions/onboarding.ts");
    expect(actions).toContain("authorizeCurrentUser");
    expect(actions).toContain("writeAuditEvent");
    expect(actions).toContain("enqueueNotification");
    expect(actions).toContain("requireManagedOnboardingEmployee");
    expect(actions).toContain("else completion_source");
  });

  it("ships accessible scoped workflow controls and progress", () => {
    const component = source("src/components/hr/hr-onboarding.tsx");
    expect(component).toContain("Create onboarding plan");
    expect(component).toContain("Accept offer");
    expect(component).toContain("Acknowledge policies");
    expect(component).toContain("Refresh evidence");
    expect(component).toContain("aria-label={`${plan.progress.percent}% complete`}");
  });
});
