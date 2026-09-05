#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boundedInteger } from "./config.mjs";

export function evaluateBackupHealth({
  success,
  maintenance,
  failure,
  maintenanceFailure,
  requireMaintenance = false,
  now = Date.now(),
  maxAgeHours = 30,
}) {
  const completedAt = Date.parse(success?.completedAt ?? "");
  if (success?.status !== "succeeded" || !Number.isFinite(completedAt)) {
    return { healthy: false, reason: "no-valid-success-record" };
  }
  if (now - completedAt > maxAgeHours * 3_600_000) {
    return { healthy: false, reason: "last-success-is-stale" };
  }
  if (completedAt > now + 300_000) return { healthy: false, reason: "success-clock-is-in-future" };
  if (Date.parse(failure?.failedAt || "") > completedAt)
    return { healthy: false, reason: "latest-backup-failed" };
  if (requireMaintenance && !maintenance)
    return { healthy: false, reason: "no-maintenance-record" };
  if (maintenance) {
    const checkedAt = Date.parse(maintenance.checkedAt ?? "");
    if (
      maintenance.status !== "succeeded" ||
      !Number.isFinite(checkedAt) ||
      now - checkedAt > 8 * 24 * 3_600_000 ||
      Date.parse(maintenanceFailure?.failedAt || "") > checkedAt
    ) {
      return { healthy: false, reason: "repository-check-is-stale-or-failed" };
    }
  }
  return { healthy: true, reason: "ok", snapshotId: success.snapshotId };
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const stateDirectory = resolve(process.env.AGENCYOS_BACKUP_STATE_DIR?.trim() || "/state");
  const includeMaintenance = process.argv.includes("--maintenance");
  const result = evaluateBackupHealth({
    success: await optionalJson(join(stateDirectory, "last-success.json")),
    maintenance: includeMaintenance
      ? await optionalJson(join(stateDirectory, "last-maintenance.json"))
      : null,
    failure: await optionalJson(join(stateDirectory, "last-failure.json")),
    maintenanceFailure: await optionalJson(join(stateDirectory, "last-maintenance-failure.json")),
    requireMaintenance: includeMaintenance,
    maxAgeHours: boundedInteger("BACKUP_MAX_AGE_HOURS", 30, 1, 168),
  });
  console.log(JSON.stringify(result));
  if (!result.healthy) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
