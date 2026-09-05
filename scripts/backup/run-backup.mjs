#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { backupConfiguration, postgresEnvironment } from "./config.mjs";
import { prepareLocalRepository, publishRepository } from "./repository.mjs";
import {
  atomicPrivateJson,
  checkedCommand,
  redactDiagnostic,
  removePrivateTree,
  sha256File,
  withFlock,
} from "./process.mjs";

const SOURCE_BUCKETS = [
  "private-file-quarantine",
  "private-files",
  "project-attachments",
  "document-templates",
];

function parseReason(args) {
  const entry = args.find((argument) => argument.startsWith("--reason="));
  const value = entry?.slice("--reason=".length) || "scheduled";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(value)) throw new Error("Invalid backup reason.");
  return value;
}

function minioEnvironment(configuration) {
  const endpoint = new URL(configuration.minioEndpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("MINIO_ENDPOINT must be a credential-free HTTP or HTTPS URL.");
  }
  const username = encodeURIComponent(configuration.minioRootUser);
  const password = encodeURIComponent(configuration.minioRootPassword);
  return {
    MC_HOST_agencyos: `${endpoint.protocol}//${username}:${password}@${endpoint.host}`,
  };
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function inventoryDirectory(root) {
  const entries = [];
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error("Backup source contains an unsupported symlink.");
      if (child.isDirectory()) await visit(path);
      else if (child.isFile()) {
        const metadata = await stat(path);
        entries.push({
          path: path.slice(root.length + 1),
          bytes: metadata.size,
          sha256: await sha256File(path),
        });
      }
    }
  }
  await visit(root);
  return entries;
}

async function notify(url, secret, body) {
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Backup notification URLs must use HTTPS without credentials or fragments.");
  }
  const response = await fetch(parsed, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Backup notification failed with HTTP ${response.status}.`);
}

async function captureDatabase(url, label, target, timeoutMs) {
  await checkedCommand({
    command: "pg_dump",
    args: ["--format=custom", "--compress=0", "--no-owner", "--no-acl", "--file", target],
    env: postgresEnvironment(url, label),
    timeoutMs,
  });
  const metadata = await stat(target);
  if (metadata.size < 1) throw new Error(`${label} dump is empty.`);
  return { bytes: metadata.size, sha256: await sha256File(target) };
}

async function captureMinio(configuration, target) {
  const environment = minioEnvironment(configuration);
  await checkedCommand({
    command: "mc",
    args: ["ready", "agencyos"],
    env: environment,
    timeoutMs: 60_000,
  });
  const inventory = [];
  for (const bucket of SOURCE_BUCKETS) {
    const bucketTarget = join(target, bucket);
    await mkdir(bucketTarget, { recursive: true, mode: 0o700 });
    await checkedCommand({
      command: "mc",
      args: ["mirror", "--preserve", `agencyos/${bucket}`, bucketTarget],
      env: environment,
      timeoutMs: configuration.commandTimeoutMs,
    });
    const listing = await checkedCommand({
      command: "mc",
      args: ["ls", "--recursive", "--versions", "--json", `agencyos/${bucket}`],
      env: environment,
      timeoutMs: configuration.commandTimeoutMs,
    });
    for (const item of parseJsonLines(listing.stdoutText)) {
      if (item.status === "success" && item.type !== "folder") {
        inventory.push({
          bucket,
          key: String(item.key ?? ""),
          versionId: item.versionId ? String(item.versionId) : null,
          etag: item.etag ? String(item.etag) : null,
          size: Number(item.size ?? 0),
        });
      }
    }
  }
  inventory.sort((left, right) =>
    `${left.bucket}/${left.key}/${left.versionId}`.localeCompare(
      `${right.bucket}/${right.key}/${right.versionId}`,
    ),
  );
  await writeFile(join(target, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, {
    mode: 0o600,
  });
  return inventory;
}

async function captureVaultwarden(configuration, target) {
  const sourceMetadata = await lstat(configuration.vaultwardenData);
  if (!sourceMetadata.isDirectory())
    throw new Error("Vaultwarden backup source is not a directory.");
  try {
    await lstat(join(configuration.vaultwardenData, "db.sqlite3"));
    throw new Error(
      "Refusing a live Vaultwarden SQLite copy; production must use VAULTWARDEN_DATABASE_URL.",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await cp(configuration.vaultwardenData, target, {
    recursive: true,
    preserveTimestamps: true,
    dereference: false,
    errorOnExist: true,
  });
  return inventoryDirectory(target);
}

function latestSnapshot(stdoutText) {
  const parsed = JSON.parse(stdoutText || "[]");
  const snapshots = Array.isArray(parsed) ? parsed : [];
  const latest = snapshots.at(-1);
  if (!latest?.id) throw new Error("Restic did not return a latest snapshot identifier.");
  return String(latest.id);
}

export async function runBackup({ environment = process.env, reason = "scheduled" } = {}) {
  const configuration = backupConfiguration(environment);
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  await mkdir(configuration.stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(configuration.stageRoot, { recursive: true, mode: 0o700 });
  const runDirectory = join(configuration.stageRoot, "current");
  await removePrivateTree(runDirectory);
  await mkdir(runDirectory, { mode: 0o700 });
  await mkdir(join(runDirectory, "databases"), { mode: 0o700 });
  await mkdir(join(runDirectory, "minio"), { mode: 0o700 });

  try {
    const localRestic = await prepareLocalRepository(configuration, environment);
    const agencyDatabase = await captureDatabase(
      configuration.agencyDatabaseUrl,
      "DATABASE_ADMIN_URL",
      join(runDirectory, "databases", "agencyos.dump"),
      configuration.commandTimeoutMs,
    );
    const vaultwardenDatabase = await captureDatabase(
      configuration.vaultwardenDatabaseUrl,
      "VAULTWARDEN_DATABASE_URL",
      join(runDirectory, "databases", "vaultwarden.dump"),
      configuration.commandTimeoutMs,
    );
    const minioInventory = await captureMinio(configuration, join(runDirectory, "minio"));
    const vaultwardenInventory = await captureVaultwarden(
      configuration,
      join(runDirectory, "vaultwarden-data"),
    );
    const sourceBoundaryEndedAt = new Date();
    const inventoryHash = createHash("sha256")
      .update(JSON.stringify({ minioInventory, vaultwardenInventory }))
      .digest("hex");
    const manifest = {
      schemaVersion: 1,
      runId,
      reason,
      releaseId: configuration.releaseId,
      sourceBoundaryStartedAt: startedAt.toISOString(),
      sourceBoundaryEndedAt: sourceBoundaryEndedAt.toISOString(),
      consistency: "component-consistent; no cross-store transaction is claimed",
      databases: { agencyos: agencyDatabase, vaultwarden: vaultwardenDatabase },
      minio: { objects: minioInventory.length },
      vaultwardenData: { files: vaultwardenInventory.length },
      inventorySha256: inventoryHash,
    };
    await writeFile(join(runDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });

    await checkedCommand({
      command: "restic",
      args: [
        "backup",
        "--json",
        "--skip-if-unchanged",
        "--host",
        configuration.host,
        "--tag",
        `agencyos-${reason}`,
        runDirectory,
      ],
      env: localRestic,
      timeoutMs: configuration.commandTimeoutMs,
    });
    const snapshots = await checkedCommand({
      command: "restic",
      args: [
        "snapshots",
        "--json",
        "--latest",
        "1",
        "--host",
        configuration.host,
        "--path",
        runDirectory,
      ],
      env: localRestic,
      timeoutMs: configuration.commandTimeoutMs,
    });
    const snapshotId = latestSnapshot(snapshots.stdoutText);
    await publishRepository(configuration, environment, snapshotId);
    const completedAt = new Date();
    const status = {
      schemaVersion: 1,
      status: "succeeded",
      runId,
      reason,
      snapshotId,
      releaseId: configuration.releaseId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      inventorySha256: inventoryHash,
      minioObjectCount: minioInventory.length,
      vaultwardenFileCount: vaultwardenInventory.length,
    };
    await notify(environment.BACKUP_SUCCESS_HEARTBEAT_URL?.trim(), "", {
      status: "succeeded",
      runId,
      snapshotId: status.snapshotId,
    });
    await atomicPrivateJson(join(configuration.stateDirectory, "last-success.json"), status);
    console.log(`Backup ${runId} completed as restic snapshot ${status.snapshotId}.`);
    return status;
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      status: "failed",
      runId,
      reason,
      failedAt: new Date().toISOString(),
      failureClass: error instanceof Error ? error.constructor.name : "UnknownError",
      diagnostic: redactDiagnostic(error instanceof Error ? error.message : error),
    };
    await atomicPrivateJson(join(configuration.stateDirectory, "last-failure.json"), failure);
    await notify(
      environment.BACKUP_FAILURE_WEBHOOK_URL?.trim(),
      environment.BACKUP_FAILURE_WEBHOOK_SECRET?.trim(),
      failure,
    ).catch((notificationError) =>
      console.error(
        `Backup failure notification also failed: ${redactDiagnostic(notificationError)}`,
      ),
    );
    throw error;
  } finally {
    await removePrivateTree(runDirectory);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reason = parseReason(args);
  if (!args.includes("--lock-held")) {
    const configuration = backupConfiguration();
    await withFlock({
      lockPath: join(configuration.stateDirectory, "repository.lock"),
      scriptPath: fileURLToPath(import.meta.url),
      args: [`--reason=${reason}`],
      timeoutMs: configuration.commandTimeoutMs,
    });
    return;
  }
  await runBackup({ reason });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Backup failed: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
    );
    process.exitCode = 1;
  });
}
