#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { atomicPrivateJson, checkedCommand, redactDiagnostic } from "../backup/process.mjs";

async function migrationSetHash() {
  const directory = resolve("database/migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const hash = createHash("sha256");
  for (const name of names)
    hash
      .update(name)
      .update("\0")
      .update(await readFile(join(directory, name)));
  return hash.digest("hex");
}

async function main() {
  const statusDirectory = resolve(
    process.env.AGENCYOS_RELEASE_STATUS_DIR?.trim() || "/release-status",
  );
  await mkdir(statusDirectory, { recursive: true, mode: 0o700 });
  const startedAt = new Date();
  const commands = [
    "scripts/database/validate-migrations.mjs",
    "scripts/database/migrate.mjs",
    "scripts/database/status.mjs",
    "scripts/database/doctor.mjs",
  ];
  try {
    for (const script of commands) {
      await checkedCommand({
        command: "node",
        args: [script],
        timeoutMs: 900_000,
      });
    }
    await atomicPrivateJson(join(statusDirectory, "last-success.json"), {
      schemaVersion: 1,
      status: "succeeded",
      releaseId: process.env.AGENCYOS_RELEASE_ID?.trim() || "unknown",
      image: process.env.AGENCYOS_OPERATIONS_IMAGE?.trim() || "unknown",
      migrationSetSha256: await migrationSetHash(),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    });
    console.log("Release database gate passed.");
  } catch (error) {
    await atomicPrivateJson(join(statusDirectory, "last-failure.json"), {
      schemaVersion: 1,
      status: "failed",
      releaseId: process.env.AGENCYOS_RELEASE_ID?.trim() || "unknown",
      failedAt: new Date().toISOString(),
      diagnostic: redactDiagnostic(error instanceof Error ? error.message : error),
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(
    `Release gate failed: ${redactDiagnostic(error instanceof Error ? error.message : error)}`,
  );
  process.exitCode = 1;
});
