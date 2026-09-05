#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boundedInteger, resticEnvironment } from "./config.mjs";
import { localRepository } from "./repository.mjs";
import { atomicPrivateJson, checkedCommand, redactDiagnostic, withFlock } from "./process.mjs";

function retention(environment) {
  const daily = boundedInteger("BACKUP_KEEP_DAILY", 35, 35, 3650, environment);
  const weekly = boundedInteger("BACKUP_KEEP_WEEKLY", 8, 8, 520, environment);
  const monthly = boundedInteger("BACKUP_KEEP_MONTHLY", 12, 12, 240, environment);
  const yearly = boundedInteger("BACKUP_KEEP_YEARLY", 3, 1, 100, environment);
  return { daily, weekly, monthly, yearly };
}

export async function runMaintenance({ environment = process.env, mode = "weekly" } = {}) {
  if (!["weekly", "monthly"].includes(mode)) throw new Error("Maintenance mode is invalid.");
  const stateDirectory = resolve(environment.AGENCYOS_BACKUP_STATE_DIR?.trim() || "/state");
  const timeoutMs = boundedInteger(
    "BACKUP_COMMAND_TIMEOUT_MS",
    3_600_000,
    10_000,
    7_200_000,
    environment,
  );
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const restic = resticEnvironment(environment, "maintenance");
  const startedAt = new Date();
  const checkArguments =
    mode === "monthly" ? ["check", "--no-lock", "--read-data-subset=10%"] : ["check", "--no-lock"];
  try {
    await checkedCommand({ command: "restic", args: checkArguments, env: restic, timeoutMs });
    const values = retention(environment);
    if (mode === "monthly") {
      await checkedCommand({
        command: "restic",
        args: [
          "forget",
          "--keep-within",
          "35d",
          "--group-by",
          "host",
          "--keep-daily",
          String(values.daily),
          "--keep-weekly",
          String(values.weekly),
          "--keep-monthly",
          String(values.monthly),
          "--keep-yearly",
          String(values.yearly),
        ],
        env: { ...restic, RESTIC_REPOSITORY: localRepository(environment) },
        timeoutMs,
      });
      if (environment.BACKUP_PRUNE_ENABLED?.trim() === "1") {
        throw new Error(
          "Automatic pruning is disabled: immutable B2 snapshots may still reference old packs. Use a separately validated off-host repository rotation/GC procedure.",
        );
      }
    }
    const completedAt = new Date();
    const status = {
      schemaVersion: 1,
      status: "succeeded",
      mode,
      checkedAt: completedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      retention: values,
      pruneAttempted: mode === "monthly" && environment.BACKUP_PRUNE_ENABLED?.trim() === "1",
    };
    await atomicPrivateJson(join(stateDirectory, "last-maintenance.json"), status);
    console.log(`Restic ${mode} maintenance completed.`);
    return status;
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      status: "failed",
      mode,
      failedAt: new Date().toISOString(),
      diagnostic: redactDiagnostic(error instanceof Error ? error.message : error),
    };
    await atomicPrivateJson(join(stateDirectory, "last-maintenance-failure.json"), failure);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--monthly") ? "monthly" : "weekly";
  if (!args.includes("--lock-held")) {
    const stateDirectory = resolve(process.env.AGENCYOS_BACKUP_STATE_DIR?.trim() || "/state");
    await withFlock({
      lockPath: join(stateDirectory, "repository.lock"),
      scriptPath: fileURLToPath(import.meta.url),
      args: mode === "monthly" ? ["--monthly"] : ["--weekly"],
      timeoutMs: boundedInteger("BACKUP_COMMAND_TIMEOUT_MS", 3_600_000, 10_000, 7_200_000),
    });
    return;
  }
  await runMaintenance({ mode });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Backup maintenance failed: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
    );
    process.exitCode = 1;
  });
}
