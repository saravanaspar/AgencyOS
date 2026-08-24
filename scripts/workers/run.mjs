import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  createAuditPipelineAlertController,
  readAuditPipelineAlertConfiguration,
} from "./audit-pipeline-alert.mjs";

const jobDefinitions = [
  { key: "notifications", intervalMs: 60_000 },
  { key: "automation", intervalMs: 60_000 },
  { key: "private-files", intervalMs: 60_000 },
  { key: "approvals", intervalMs: 5 * 60_000 },
  { key: "crm-sync", intervalMs: 5 * 60_000 },
  { key: "finance-overdue", intervalMs: 5 * 60_000 },
  { key: "project-reminders", intervalMs: 5 * 60_000 },
  { key: "legal-access-reviews", intervalMs: 6 * 60 * 60_000 },
  { key: "audit-pipeline", intervalMs: 5 * 60_000 },
  { key: "reports", intervalMs: 5 * 60_000 },
];

const startedAt = Date.now();
const jobs = jobDefinitions.map((job, index) => ({
  ...job,
  nextRunAt: startedAt + index * 5_000,
  running: false,
}));

const runOnce = process.argv.includes("--once");
const secret = process.env.INTERNAL_WORKER_SECRET?.trim() ?? "";
const internalAppUrl = process.env.INTERNAL_APP_URL?.trim() ?? "";
const configuredAppUrl =
  internalAppUrl ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://127.0.0.1:3000";
const appUrl = configuredAppUrl.replace(/\/$/, "");
const configuredConcurrency = Number.parseInt(process.env.WORKER_MAX_CONCURRENCY ?? "3", 10);
const maxConcurrency = Number.isSafeInteger(configuredConcurrency)
  ? Math.max(1, Math.min(configuredConcurrency, 8))
  : 3;
let auditPipelineAlertConfiguration = null;

function log(level, event, fields = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "agencyos-worker",
    event,
    ...fields,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

function validateConfiguration() {
  if (process.env.NODE_ENV === "production" && !internalAppUrl) {
    throw new Error("INTERNAL_APP_URL is required for the production worker process.");
  }
  if (secret.length < 32) {
    throw new Error("INTERNAL_WORKER_SECRET must contain at least 32 characters.");
  }
  let parsed;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("INTERNAL_APP_URL/APP_URL must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Worker application URL must use HTTP(S) and must not contain credentials.");
  }
  auditPipelineAlertConfiguration = readAuditPipelineAlertConfiguration(process.env);
}

validateConfiguration();
const auditPipelineAlerts = createAuditPipelineAlertController(auditPipelineAlertConfiguration);

let stopping = false;
const inFlight = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    log("info", "worker.shutdown.requested", { signal, inFlight: inFlight.size });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function advanceSchedule(job, now = Date.now()) {
  do job.nextRunAt += job.intervalMs;
  while (job.nextRunAt <= now);
}

async function runJob(job) {
  const requestId = randomUUID();
  const body = JSON.stringify({ job: job.key });
  const started = Date.now();
  log("info", "worker.job.started", { job: job.key, requestId });
  try {
    const response = await fetch(`${appUrl}/api/internal/workers/run`, {
      method: "POST",
      signal: AbortSignal.timeout(70_000),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body, "utf8")),
        "x-request-id": requestId,
      },
      body,
    });
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }
    if (!response.ok) {
      const message =
        result && typeof result.message === "string" ? result.message : response.statusText;
      if (
        response.status === 503 &&
        message === "The malware scanner provider is not configured."
      ) {
        log("warn", "worker.job.skipped", {
          job: job.key,
          requestId,
          durationMs: Date.now() - started,
          reason: "scanner_not_configured",
        });
        return true;
      }
      throw new Error(`${response.status} ${message}`.trim());
    }
    if (
      job.key === "audit-pipeline" &&
      !result?.skipped &&
      result?.summary?.canariesWritten !== 1
    ) {
      throw new Error("Audit-pipeline health response was invalid.");
    }
    if (job.key === "audit-pipeline" && !result?.skipped) {
      const alertOutcome = await auditPipelineAlerts.recordSuccess();
      if (alertOutcome === "sent") {
        log("info", "worker.audit_pipeline.recovery_sent");
      } else if (alertOutcome === "delivery_failed") {
        log("warn", "worker.audit_pipeline.recovery_delivery_failed");
      }
    }
    log("info", "worker.job.succeeded", {
      job: job.key,
      requestId,
      durationMs: Date.now() - started,
      skipped: result?.skipped ?? null,
      coordination: result?.coordination ?? null,
    });
    return true;
  } catch (error) {
    log("error", "worker.job.failed", {
      job: job.key,
      requestId,
      durationMs: Date.now() - started,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 500) }
          : "unknown",
    });
    if (job.key === "audit-pipeline") {
      const alertOutcome = await auditPipelineAlerts.recordFailure();
      if (alertOutcome === "sent") {
        log("error", "worker.audit_pipeline.failure_alert_sent");
      } else if (alertOutcome === "delivery_failed") {
        log("warn", "worker.audit_pipeline.failure_alert_delivery_failed");
      }
    }
    return false;
  }
}

function launch(job) {
  job.running = true;
  advanceSchedule(job);
  const promise = runJob(job).finally(() => {
    job.running = false;
    inFlight.delete(promise);
  });
  inFlight.add(promise);
}

async function runWithConcurrency(items) {
  const pending = [...items];
  const active = new Set();
  let auditPipelineFailed = false;
  while (pending.length || active.size) {
    while (pending.length && active.size < maxConcurrency) {
      const job = pending.shift();
      const promise = runJob(job)
        .then((succeeded) => {
          if (job.key === "audit-pipeline" && !succeeded) auditPipelineFailed = true;
        })
        .finally(() => active.delete(promise));
      active.add(promise);
    }
    if (active.size) await Promise.race(active);
  }
  return { auditPipelineFailed };
}

async function main() {
  log("info", "worker.started", { appUrl, maxConcurrency, runOnce });
  if (runOnce) {
    const result = await runWithConcurrency(jobs);
    if (result.auditPipelineFailed) {
      log("error", "worker.audit_pipeline.one_shot_failed");
      process.exitCode = 1;
    }
    return;
  }

  while (!stopping) {
    const now = Date.now();
    const availableSlots = Math.max(0, maxConcurrency - inFlight.size);
    const due = jobs
      .filter((job) => !job.running && job.nextRunAt <= now)
      .sort((left, right) => left.nextRunAt - right.nextRunAt)
      .slice(0, availableSlots);

    for (const job of due) launch(job);
    if (stopping) break;

    if (inFlight.size >= maxConcurrency) {
      await Promise.race(inFlight);
      continue;
    }

    const runnable = jobs.filter((job) => !job.running);
    const nextRunAt = runnable.length
      ? Math.min(...runnable.map((job) => job.nextRunAt))
      : now + 1_000;
    const delay = Math.max(100, Math.min(1_000, nextRunAt - Date.now()));
    if (inFlight.size) await Promise.race([sleep(delay), ...inFlight]);
    else await sleep(delay);
  }

  await Promise.allSettled([...inFlight]);
  log("info", "worker.stopped");
}

await main();
