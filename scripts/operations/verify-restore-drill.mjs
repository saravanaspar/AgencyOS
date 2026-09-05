#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runDeploymentVerification } from "./verify-deployment.mjs";
import { runOperationalCommand, sha256Json, writePrivateJson } from "./operational-command.mjs";

function parseArguments(argv) {
  const options = {
    appUrl: process.env.AGENCYOS_DEPLOYMENT_APP_URL ?? "",
    output: "restore-drill-verification-summary.json",
    skipPgtap: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--app-url") options.appUrl = argv[++index] ?? "";
    else if (value === "--output") options.output = argv[++index] ?? options.output;
    else if (value === "--skip-pgtap") options.skipPgtap = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function assertRestoreDrillEnvironment() {
  if (process.env.AGENCYOS_RESTORE_DRILL !== "1") {
    throw new Error("Set AGENCYOS_RESTORE_DRILL=1 only inside the isolated restored environment.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Restore-drill verification refuses to run with NODE_ENV=production.");
  }
  const backupSetId = process.env.RESTORE_DRILL_BACKUP_SET_ID?.trim();
  const targetId = process.env.RESTORE_DRILL_TARGET_ID?.trim();
  if (!backupSetId || !/^[A-Za-z0-9._:-]{1,120}$/.test(backupSetId)) {
    throw new Error("RESTORE_DRILL_BACKUP_SET_ID must identify the restored backup set.");
  }
  if (!targetId || !/^[A-Za-z0-9._:-]{1,120}$/.test(targetId)) {
    throw new Error("RESTORE_DRILL_TARGET_ID must identify the isolated restore target.");
  }
  return { backupSetId, targetId };
}

function commandEvidence(name, result, summary) {
  return {
    name,
    status: result.status,
    durationMs: result.durationMs,
    evidenceSha256: sha256Json({
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutSha256: result.stdoutSha256,
      stderrSha256: result.stderrSha256,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
    }),
    summary:
      result.status === "passed"
        ? summary
        : `${name} failed: ${result.diagnostic || "unknown error"}`,
  };
}

export async function runRestoreDrillVerification(options, root = process.cwd()) {
  const identity = assertRestoreDrillEnvironment();
  if (!options.appUrl) throw new Error("--app-url or AGENCYOS_DEPLOYMENT_APP_URL is required.");
  const startedAt = new Date();

  const deployment = await runDeploymentVerification(
    {
      appUrl: options.appUrl,
      output: "unused-by-library-call.json",
      skipPgtap: options.skipPgtap,
      skipHttp: false,
      httpOnly: false,
    },
    root,
  );

  const fixedChecks = [
    {
      name: "restored-object-storage",
      command: process.execPath,
      args: ["scripts/storage/check-object-storage.mjs"],
      timeoutMs: 120_000,
      summary: "Restored object-storage credentials and read/write access are healthy.",
    },
    {
      name: "malware-scanner-connectivity",
      command: process.execPath,
      args: ["scripts/scanner/check-clamav.mjs"],
      timeoutMs: 120_000,
      summary: "Restored scanner configuration is healthy.",
    },
    {
      name: "restored-worker-once",
      command: process.execPath,
      args: ["scripts/workers/run.mjs", "--once"],
      timeoutMs: 300_000,
      summary: "A worker cycle completed against the restored environment.",
    },
  ];

  const operationalChecks = [];
  for (const check of fixedChecks) {
    const result = await runOperationalCommand({
      command: check.command,
      args: check.args,
      cwd: root,
      timeoutMs: check.timeoutMs,
    });
    operationalChecks.push(commandEvidence(check.name, result, check.summary));
  }

  const completedAt = new Date();
  const checks = [
    ...deployment.checks.map((check) => ({ ...check, group: "deployment" })),
    ...operationalChecks.map((check) => ({ ...check, group: "restored-services" })),
  ];
  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
  const evidence = {
    schemaVersion: 1,
    status,
    backupSetId: identity.backupSetId,
    targetId: identity.targetId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    appUrlHost: new URL(options.appUrl).host,
    expectedMigration: deployment.expectedMigration,
    localMigrationCount: deployment.localMigrationCount,
    checks,
    note: "This verifies an already-restored isolated environment. Preserve separate provider evidence that PostgreSQL, object storage, configuration, DNS/TLS, and secret-manager data were restored from the named backup set.",
  };
  return { ...evidence, manifestSha256: sha256Json(evidence) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const summary = await runRestoreDrillVerification(options);
  const output = await writePrivateJson(options.output, summary);
  process.stdout.write(
    `Restore drill verification: ${summary.status}\nEvidence: ${output}\nManifest SHA-256: ${summary.manifestSha256}\n`,
  );
  if (summary.status !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
