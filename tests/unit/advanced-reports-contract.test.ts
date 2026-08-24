import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("advanced reports contracts", () => {
  it("adds personal saved views, schedules, snapshots, immutable runs, and narrow permissions", () => {
    const migration = source("database/migrations/20260718005200_advanced_reports.sql");
    for (const table of [
      "report_saved_views",
      "report_schedules",
      "report_snapshots",
      "report_schedule_runs",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("owner_membership_id = private.current_membership_id");
    expect(migration).toContain("report_schedule_runs_append_only");
    expect(migration).toContain("reports.schedule.manage");
    expect(migration).toContain("reports.snapshot.download");
    expect(migration).toContain("execute function private.set_updated_at()");
    expect(migration).not.toContain("execute function public.set_updated_at()");
  });

  it("uses bounded predefined widgets instead of dynamic SQL or arbitrary field names", () => {
    const builder = source("src/modules/reports/report-builder.ts");
    const document = source("src/modules/reports/report-document.ts");
    expect(builder).toContain("reportWidgetCatalog");
    expect(builder).toContain("slice(0, 12)");
    expect(document).toContain("blockForWidget");
    expect(document).not.toContain("eval(");
    expect(document).not.toContain("new Function");
  });

  it("stores generated snapshots as private files and verifies bytes before download", () => {
    const snapshots = source("src/modules/reports/server/report-snapshots.ts");
    const route = source("src/app/api/reports/snapshots/[snapshotId]/route.ts");
    expect(snapshots).toContain("renderHtmlToPdf");
    expect(snapshots).toContain("PRIVATE_FILE_CLEAN_BUCKET");
    expect(snapshots).toContain("report-snapshot-integrity-mismatch");
    expect(snapshots).toContain("classification, original_file_name");
    expect(route).toContain("reportsPermissionKeys.snapshotDownload");
    expect(route).toContain('"cache-control": "private, no-store');
  });

  it("claims due delivery schedules with database locks and rechecks current permissions", () => {
    const worker = source("src/modules/reports/server/delivery-worker.ts");
    const registry = source("src/modules/workers/server/worker-registry.ts");
    const route = source("src/app/api/internal/workers/run/route.ts");
    expect(worker).toContain("for update of schedule skip locked");
    expect(worker).toContain("MAX_SCHEDULES_PER_RUN = 12");
    expect(worker).toContain("getEffectivePermissionGrants");
    expect(worker).toContain("report-schedule-permission-revoked");
    expect(registry).toContain('leaseName: "reports-delivery"');
    expect(registry).toContain("runReportDeliveryWorker");
    expect(route).toContain("INTERNAL_WORKER_SECRET");
    expect(route).toContain("runInternalWorkerRequest");
  });

  it("delivers shared reports through recipient-specific snapshots without persisting raw recipient email", () => {
    const baseMigration = source("database/migrations/20260718005200_advanced_reports.sql");
    const founderMigration = source("database/migrations/20260818005800_founder_operations.sql");
    const worker = source("src/modules/reports/server/delivery-worker.ts");
    expect(baseMigration).toContain("owner_membership_id");
    expect(founderMigration).toContain("report_delivery_recipients");
    expect(founderMigration).toContain("view_access");
    expect(founderMigration).toContain("section_access");
    expect(worker).toContain("resolveAudience");
    expect(worker).toContain("generateReportSnapshot(context");
    expect(worker).toContain("context.user.email");
    expect(worker).toContain("enqueueNotification");
    expect(founderMigration).not.toContain("recipient_email");
  });

  it("exposes inline saved-view and delivery controls without introducing a nested modal", () => {
    const studio = source("src/components/reports/report-studio.tsx");
    expect(studio).toContain("<details");
    expect(studio).toContain("Included report blocks");
    expect(studio).toContain("Schedule delivery");
    expect(studio).not.toContain("<dialog");
  });
});
