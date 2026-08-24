import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("founder operations contracts", () => {
  it("keeps scheduled report periods relative and delivery recipient-specific", () => {
    const migration = source("database/migrations/20260818005800_founder_operations.sql");
    const studio = source("src/modules/reports/server/report-studio.ts");
    const worker = source("src/modules/reports/server/delivery-worker.ts");
    expect(migration).toContain("period_mode");
    expect(migration).toContain("report_delivery_batches");
    expect(migration).toContain("report_delivery_recipients");
    expect(migration).toContain("partially_failed");
    expect(studio).toContain("resolveReportPeriod");
    expect(worker).toContain("resolveAudience");
    expect(worker).toContain("generateReportSnapshot(context");
    expect(worker).toContain("grace_seconds");
    expect(worker).toContain("partially_failed");
  });

  it("uses real PostgreSQL advisory locking when Redis coordination is unavailable", () => {
    const coordination = source("src/integrations/redis/coordination.ts");
    expect(coordination).toContain("pg_try_advisory_lock");
    expect(coordination).toContain("pg_advisory_unlock");
    expect(coordination).not.toContain(
      'coordination: "database-fallback",\n      value: await operation()',
    );
  });

  it("preserves CRM stage/conversion history and exposes forecast operating metrics", () => {
    const migration = source("database/migrations/20260818005800_founder_operations.sql");
    const forecast = source("src/modules/crm/server/forecast.ts");
    const actions = source("src/modules/crm/actions/crm.ts");
    for (const table of [
      "crm_lead_stage_history",
      "crm_lead_conversions",
      "crm_forecast_targets",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration).toContain("required_fields");
    expect(forecast).toContain("weightedPipeline");
    expect(forecast).toContain("forecastNext90Days");
    expect(forecast).toContain("pipelineCoverageRatio");
    expect(forecast).toContain("staleOpportunities");
    expect(forecast).toContain("overdueFollowUps");
    expect(actions).toContain("crm_client_billing_profiles");
    expect(actions).toContain("crm_lead_conversions");
    expect(actions).toContain("legal_contracts");
  });

  it("enforces project commercial truth and closure at the database boundary", () => {
    const migration = source("database/migrations/20260818005800_founder_operations.sql");
    const profitability = source("src/modules/projects/server/profitability.ts");
    expect(migration).toContain("billing_method");
    expect(migration).toContain("budget_minor");
    expect(migration).toContain("actual_completion_date");
    expect(migration).toContain("private.project_unbilled_minor");
    expect(migration).toContain("private.validate_project_closure_transition");
    expect(migration).toContain("Issue final billing before project closure");
    expect(profitability).toContain("grossContributionMinor");
    expect(profitability).toMatch(/aggregate\(\s*rows,\s*\"client\"/);
    expect(profitability).toMatch(/aggregate\(\s*rows,\s*\"project_manager\"/);
    expect(profitability).toMatch(/aggregate\(\s*rows,\s*\"department\"/);
    expect(profitability).toContain('dimension: "month"');
  });

  it("makes founder mode capability-based and installs founder report presets", () => {
    const dashboard = source("src/modules/dashboard/server/dashboard.ts");
    const packs = source("src/modules/reports/server/founder-packs.ts");
    expect(dashboard).toContain("reports.founder_pack.view");
    expect(dashboard).not.toContain('templateKey === "owner"');
    expect(dashboard).toContain("attention");
    expect(packs).toContain("founder.daily.v1");
    expect(packs).toContain("founder.weekly.v1");
    expect(packs).toContain("08:00");
    expect(packs).toContain("delivery_channels");
    expect(packs).toContain("grace_seconds");
  });
});
