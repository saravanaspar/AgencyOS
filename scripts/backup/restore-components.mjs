#!/usr/bin/env node
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRestoreEnvironment,
  parsePostgresConnection,
  postgresEnvironment,
  requiredEnvironment,
  resolveWithin,
} from "./config.mjs";
import { atomicPrivateJson, checkedCommand } from "./process.mjs";

function assertDistinctDatabase(recoveryUrl, productionUrl, recoveryId, label, environment) {
  const recovery = parsePostgresConnection(recoveryUrl, label);
  const production = parsePostgresConnection(productionUrl, `production ${label}`);
  if (
    recovery.host === production.host &&
    recovery.port === production.port &&
    recovery.database === production.database
  ) {
    throw new Error(`${label} must not target the production database.`);
  }
  if (["postgres", "agencyos-postgres"].includes(recovery.host.toLowerCase())) {
    throw new Error(`${label} must use an isolated recovery PostgreSQL service.`);
  }
  if (!recovery.database.toLowerCase().includes("recovery")) {
    throw new Error(`${label} database name must contain recovery.`);
  }
  if (environment.RECOVERY_TARGET_CONFIRM !== recoveryId) {
    throw new Error("RECOVERY_TARGET_CONFIRM must exactly match AGENCYOS_RECOVERY_ID.");
  }
}

async function assertEmptyDatabase(url, label) {
  const result = await checkedCommand({
    command: "psql",
    args: [
      "--no-psqlrc",
      "--tuples-only",
      "--command",
      "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');",
    ],
    env: postgresEnvironment(url, label),
    timeoutMs: 60_000,
  });
  if (Number(result.stdoutText.trim()) !== 0) {
    throw new Error(`${label} is not empty; refusing to overwrite existing data.`);
  }
}

function recoveryMinioEnvironment(environment) {
  const endpoint = new URL(requiredEnvironment("RECOVERY_MINIO_ENDPOINT", environment));
  const production = new URL(requiredEnvironment("MINIO_ENDPOINT", environment));
  if (endpoint.href === production.href || endpoint.hostname === "minio") {
    throw new Error("RECOVERY_MINIO_ENDPOINT must target an isolated recovery service.");
  }
  const user = encodeURIComponent(requiredEnvironment("RECOVERY_MINIO_ACCESS_KEY", environment));
  const password = encodeURIComponent(
    requiredEnvironment("RECOVERY_MINIO_SECRET_KEY", environment),
  );
  return { MC_HOST_recovery: `${endpoint.protocol}//${user}:${password}@${endpoint.host}` };
}

async function restoreDatabase(url, label, dump) {
  await assertEmptyDatabase(url, label);
  await checkedCommand({
    command: "psql",
    args: [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN; END IF; END $$;",
    ],
    env: postgresEnvironment(url, label),
    timeoutMs: 60_000,
  });
  await checkedCommand({
    command: "pg_restore",
    args: [
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      parsePostgresConnection(url, label).database,
      dump,
    ],
    env: postgresEnvironment(url, label),
    timeoutMs: Number(process.env.BACKUP_COMMAND_TIMEOUT_MS || 3_600_000),
  });
}

async function restoreMinio(sourceRoot, recoveryId, environment) {
  const minioEnvironment = recoveryMinioEnvironment(environment);
  for (const sourceBucket of await readdir(join(sourceRoot, "minio"), { withFileTypes: true })) {
    if (!sourceBucket.isDirectory()) continue;
    // The isolated server keeps canonical bucket names required by AgencyOS.
    const targetBucket = sourceBucket.name;
    await checkedCommand({
      command: "mc",
      args: ["mb", "--ignore-existing", `recovery/${targetBucket}`],
      env: minioEnvironment,
      timeoutMs: 60_000,
    });
    const existing = await checkedCommand({
      command: "mc",
      args: ["ls", "--recursive", "--json", `recovery/${targetBucket}`],
      env: minioEnvironment,
      timeoutMs: 60_000,
    });
    if (existing.stdoutText.trim()) {
      throw new Error(`Recovery bucket ${targetBucket} is not empty.`);
    }
    await checkedCommand({
      command: "mc",
      args: ["mirror", join(sourceRoot, "minio", sourceBucket.name), `recovery/${targetBucket}`],
      env: minioEnvironment,
      timeoutMs: Number(environment.BACKUP_COMMAND_TIMEOUT_MS || 3_600_000),
    });
  }
}

export async function restoreComponents({ environment = process.env } = {}) {
  const restore = assertRestoreEnvironment(environment);
  const preparedRoot = resolveWithin(
    restore.recoveryRoot,
    resolve(restore.recoveryRoot, restore.recoveryId, "prepared"),
  );
  const preparedEvidence = JSON.parse(
    await readFile(join(preparedRoot, "restore-prepared.json"), "utf8"),
  );
  if (preparedEvidence.recoveryId !== restore.recoveryId) {
    throw new Error("Prepared restore evidence belongs to another recovery ID.");
  }
  const sourceRoot = resolveWithin(preparedRoot, preparedEvidence.sourceRoot);
  const agencyRecoveryUrl = requiredEnvironment("RECOVERY_DATABASE_ADMIN_URL", environment);
  const vaultwardenRecoveryUrl = requiredEnvironment(
    "RECOVERY_VAULTWARDEN_DATABASE_URL",
    environment,
  );
  assertDistinctDatabase(
    agencyRecoveryUrl,
    requiredEnvironment("DATABASE_ADMIN_URL", environment),
    restore.recoveryId,
    "RECOVERY_DATABASE_ADMIN_URL",
    environment,
  );
  assertDistinctDatabase(
    vaultwardenRecoveryUrl,
    requiredEnvironment("VAULTWARDEN_DATABASE_URL", environment),
    restore.recoveryId,
    "RECOVERY_VAULTWARDEN_DATABASE_URL",
    environment,
  );
  await restoreDatabase(
    agencyRecoveryUrl,
    "RECOVERY_DATABASE_ADMIN_URL",
    join(sourceRoot, "databases", "agencyos.dump"),
  );
  await restoreDatabase(
    vaultwardenRecoveryUrl,
    "RECOVERY_VAULTWARDEN_DATABASE_URL",
    join(sourceRoot, "databases", "vaultwarden.dump"),
  );
  await restoreMinio(sourceRoot, restore.recoveryId, environment);

  const vaultwardenDestination = resolveWithin(
    restore.recoveryRoot,
    resolve(requiredEnvironment("RECOVERY_VAULTWARDEN_DATA_DIR", environment)),
  );
  await mkdir(dirname(vaultwardenDestination), { recursive: true, mode: 0o700 });
  try {
    if ((await readdir(vaultwardenDestination)).length > 0) {
      throw new Error("Recovery Vaultwarden data directory must be empty.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await cp(join(sourceRoot, "vaultwarden-data"), vaultwardenDestination, {
    recursive: true,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  const result = {
    schemaVersion: 1,
    status: "components-restored",
    recoveryId: restore.recoveryId,
    snapshotId: restore.snapshot,
    completedAt: new Date().toISOString(),
  };
  await atomicPrivateJson(join(preparedRoot, "restore-components.json"), result);
  console.log("Components restored only to explicitly isolated recovery targets.");
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  restoreComponents().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
