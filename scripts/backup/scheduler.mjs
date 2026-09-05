#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scheduleConfiguration } from "./config.mjs";
import { checkedCommand, redactDiagnostic } from "./process.mjs";

export function nextScheduledRun({ now = new Date(), hourUtc, jitterMinutes = 0 }) {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const deterministicJitter = jitterMinutes
    ? Math.abs(
        (now.getUTCFullYear() * 372 + now.getUTCMonth() * 31 + now.getUTCDate()) % jitterMinutes,
      )
    : 0;
  next.setUTCMinutes(next.getUTCMinutes() + deterministicJitter);
  return next;
}

export function backupIsStale(success, now = Date.now(), maxAgeHours = 30) {
  const completedAt = Date.parse(success?.completedAt ?? "");
  return !Number.isFinite(completedAt) || now - completedAt > maxAgeHours * 3_600_000;
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function waitUntil(timestamp, signal) {
  const milliseconds = Math.max(0, Math.min(timestamp - Date.now(), 2_147_000_000));
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolvePromise();
      },
      { once: true },
    );
  });
}

async function execute(script, args, timeoutMs) {
  const result = await checkedCommand({ command: "node", args: [script, ...args], timeoutMs });
  if (result.stdoutDiagnostic) process.stdout.write(result.stdoutDiagnostic);
}

export async function runScheduler({ environment = process.env, mode = "backup" } = {}) {
  const schedule = scheduleConfiguration(environment, mode);
  const stateDirectory = resolve(environment.AGENCYOS_BACKUP_STATE_DIR?.trim() || "/state");
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => controller.abort());
  }
  const runBackup = fileURLToPath(new URL("./run-backup.mjs", import.meta.url));
  const runMaintenance = fileURLToPath(new URL("./run-maintenance.mjs", import.meta.url));
  const timeoutMs = Number(environment.BACKUP_COMMAND_TIMEOUT_MS || 3_600_000);

  if (mode === "backup") {
    const lastSuccess = await optionalJson(join(stateDirectory, "last-success.json"));
    if (backupIsStale(lastSuccess, Date.now(), schedule.maxAgeHours)) {
      await execute(runBackup, ["--reason=missed-schedule"], timeoutMs);
    }
  } else {
    const maintenance = await optionalJson(join(stateDirectory, "last-maintenance.json"));
    const checkedAt = Date.parse(maintenance?.checkedAt ?? "");
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 8 * 24 * 3_600_000) {
      await execute(runMaintenance, ["--weekly"], timeoutMs);
    }
  }

  while (!controller.signal.aborted) {
    const next = nextScheduledRun({
      hourUtc: schedule.hourUtc,
      jitterMinutes: schedule.jitterMinutes,
    });
    if (mode === "maintenance") {
      while (next.getUTCDay() !== 0) next.setUTCDate(next.getUTCDate() + 1);
    }
    console.log(`${mode} scheduler next run: ${next.toISOString()}`);
    await waitUntil(next.getTime(), controller.signal);
    if (controller.signal.aborted) break;
    if (mode === "backup") {
      await execute(runBackup, ["--reason=scheduled"], timeoutMs);
    } else {
      const monthly = new Date().getUTCDate() <= 7;
      await execute(runMaintenance, [monthly ? "--monthly" : "--weekly"], timeoutMs);
    }
    // Avoid a duplicate run if the clock moves backwards around the scheduled minute.
    await waitUntil(Date.now() + 60_000, controller.signal);
  }
}

async function main() {
  const mode = process.argv.includes("--maintenance") ? "maintenance" : "backup";
  await runScheduler({ mode });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Backup scheduler stopped: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
    );
    process.exitCode = 1;
  });
}
