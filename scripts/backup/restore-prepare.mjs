#!/usr/bin/env node
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRestoreEnvironment, resolveWithin, resticEnvironment } from "./config.mjs";
import { atomicPrivateJson, checkedCommand, sha256File } from "./process.mjs";

async function directoryIsEmpty(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function findFiles(root, wanted) {
  const matches = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Restored snapshot contains a symlink.");
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && wanted.has(entry.name)) matches.push(child);
    }
  }
  await visit(root);
  return matches;
}

export async function prepareRestore({ environment = process.env } = {}) {
  const restore = assertRestoreEnvironment(environment);
  const destination = resolveWithin(
    restore.recoveryRoot,
    resolve(restore.recoveryRoot, restore.recoveryId, "prepared"),
  );
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (!(await directoryIsEmpty(destination))) {
    throw new Error("Recovery destination must be empty; refusing to merge restored data.");
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });

  await checkedCommand({
    command: "restic",
    args: ["restore", restore.snapshot, "--no-lock", "--verify", "--target", destination],
    env: resticEnvironment(environment, "restore"),
    timeoutMs: Number(environment.BACKUP_COMMAND_TIMEOUT_MS || 3_600_000),
  });
  const manifests = await findFiles(destination, new Set(["manifest.json"]));
  if (manifests.length !== 1) {
    throw new Error(`Expected one restored backup manifest; found ${manifests.length}.`);
  }
  const sourceRoot = dirname(manifests[0]);
  const manifest = JSON.parse(await readFile(manifests[0], "utf8"));
  if (
    ![1, 2].includes(manifest.schemaVersion) ||
    typeof manifest.runId !== "string" ||
    !manifest.runId
  ) {
    throw new Error("Restored backup manifest is invalid.");
  }
  for (const [name, expected] of [
    ["agencyos.dump", manifest.databases?.agencyos],
    ["vaultwarden.dump", manifest.databases?.vaultwarden],
  ]) {
    const path = join(sourceRoot, "databases", name);
    const metadata = await stat(path);
    if (
      !expected ||
      metadata.size !== expected.bytes ||
      (await sha256File(path)) !== expected.sha256
    ) {
      throw new Error(`Restored ${name} failed its size or SHA-256 check.`);
    }
    await checkedCommand({
      command: "pg_restore",
      args: ["--list", path],
      timeoutMs: 120_000,
    });
  }
  const evidence = {
    schemaVersion: 1,
    status: "prepared",
    recoveryId: restore.recoveryId,
    snapshotId: restore.snapshot,
    backupRunId: manifest.runId,
    preparedAt: new Date().toISOString(),
    sourceRoot,
    manifestSha256: await sha256File(manifests[0]),
  };
  await atomicPrivateJson(join(destination, "restore-prepared.json"), evidence);
  console.log(`Snapshot ${restore.snapshot} prepared in isolated recovery ${restore.recoveryId}.`);
  return evidence;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareRestore().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
