import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("AgencyOS internal worker runner", () => {
  it("registers exactly the eleven bounded background jobs", () => {
    const registry = source("src/modules/workers/server/worker-registry.ts");
    const expectedJobs = [
      "notifications",
      "automation",
      "private-files",
      "approvals",
      "crm-sync",
      "finance-overdue",
      "finance-collections",
      "project-reminders",
      "legal-access-reviews",
      "audit-pipeline",
      "reports",
    ];
    for (const job of expectedJobs) {
      expect(registry).toContain(`"${job}"`);
    }
    for (const worker of [
      "runNotificationDeliveryWorker",
      "runAutomationDispatchWorker",
      "runPrivateFileScanWorker",
      "runApprovalTimerWorker",
      "runDueCrmConnectionSyncs",
      "runFinanceOverdueWorker",
      "runFinanceCollectionsWorker",
      "runProjectReminderWorker",
      "runLegalAccessReviewWorker",
      "runAuditPipelineHealthWorker",
      "runReportDeliveryWorker",
    ]) {
      expect(registry).toContain(worker);
    }

    const keyBlock = registry.match(/internalWorkerJobKeys = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    const registeredJobs = [...keyBlock.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(registeredJobs).toEqual(expectedJobs);
  });

  it("accepts only a fixed job enum through one bounded authenticated endpoint", () => {
    const route = source("src/app/api/internal/workers/run/route.ts");
    expect(route).toContain("z.enum(internalWorkerJobKeys)");
    expect(route).toContain("readBoundedRequestText(request, 2 * 1024");
    expect(route).toContain("requireContentLength: true");
    expect(route).toContain("INTERNAL_WORKER_SECRET");
    expect(route).toContain("runInternalWorkerRequest");
    expect(route).not.toContain("functionName");
    expect(route).not.toContain("eval(");
  });

  it("runs jobs with bounded concurrency, timeouts, staggering, and graceful shutdown", () => {
    const runner = source("scripts/workers/run.mjs");
    expect(runner).toContain("index * 5_000");
    expect(runner).toContain("AbortSignal.timeout(70_000)");
    expect(runner).toContain('for (const signal of ["SIGINT", "SIGTERM"])');
    expect(runner).toContain("for (const job of due)");
    expect(runner).toContain('WORKER_MAX_CONCURRENCY ?? "3"');
    expect(runner).toContain("Math.max(1, Math.min(configuredConcurrency, 8))");
    expect(runner).toContain("async function runWithConcurrency(items)");
    expect(runner).toContain("active.size < maxConcurrency");
    expect(runner).toContain("await Promise.allSettled([...inFlight])");
    expect(runner).toContain("INTERNAL_WORKER_SECRET must contain at least 32 characters");
  });

  it("schedules every registered job, including audit canaries, legal reviews, and project reminders", () => {
    const registry = source("src/modules/workers/server/worker-registry.ts");
    const runner = source("scripts/workers/run.mjs");
    const keyBlock = registry.match(/internalWorkerJobKeys = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    const registeredJobs = [...keyBlock.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    const definitionsBlock = runner.match(/const jobDefinitions = \[([\s\S]*?)\];/)?.[1] ?? "";
    const scheduledJobs = [...definitionsBlock.matchAll(/key: "([a-z-]+)"/g)].map(
      (match) => match[1],
    );

    expect(scheduledJobs).toEqual(registeredJobs);
    expect(runner).toContain('{ key: "project-reminders", intervalMs: 5 * 60_000 }');
    expect(runner).toContain('{ key: "legal-access-reviews", intervalMs: 6 * 60 * 60_000 }');
    expect(runner).toContain('{ key: "audit-pipeline", intervalMs: 5 * 60_000 }');
  });

  it("routes audit failure and recovery directly through the hardened alert controller", () => {
    const runner = source("scripts/workers/run.mjs");
    const alerts = source("scripts/workers/audit-pipeline-alert.mjs");
    expect(runner).toContain("auditPipelineAlerts.recordFailure()");
    expect(runner).toContain("auditPipelineAlerts.recordSuccess()");
    expect(runner).toContain("result?.summary?.canariesWritten !== 1");
    expect(runner).toContain("process.exitCode = 1");
    expect(alerts).toContain('redirect: "error"');
    expect(alerts).toContain("AbortSignal.timeout(AUDIT_PIPELINE_ALERT_TIMEOUT_MS)");
    expect(alerts).toContain("AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET");
    expect(alerts).toContain("AUDIT_PIPELINE_ALERT_MAX_PAYLOAD_BYTES");
    expect(alerts).not.toContain("console.");
  });

  it("accepts the one-shot flag through the canonical worker command", () => {
    const runner = source("scripts/workers/run.mjs");
    const packageJson = JSON.parse(source("package.json"));
    expect(packageJson.scripts.worker).toContain("scripts/workers/run.mjs");
    expect(runner).toContain('process.argv.includes("--once")');
    expect(packageJson.scripts).not.toHaveProperty("worker:once");
  });
});
