import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { connectionEnvironment, getAdminDatabaseUrl } from "./portable-database.mjs";

const databaseUrl = getAdminDatabaseUrl();
const testsDirectory = path.join(process.cwd(), "database", "tests");
const files = fs
  .readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.sql"))
  .sort();

const version = spawnSync("psql", ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(
    "psql is required for provider-neutral database tests. Install the PostgreSQL client tools.",
  );
  process.exit(1);
}

const databaseEnvironment = {
  ...process.env,
  ...connectionEnvironment(databaseUrl),
};

let failures = 0;
for (const fileName of files) {
  process.stdout.write(`db:test ${fileName} ... `);
  const result = spawnSync(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-f", path.join(testsDirectory, fileName)],
    {
      cwd: testsDirectory,
      env: databaseEnvironment,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const tapFailure = /(^|\n)not ok\b|Looks like you failed/i.test(output);
  if (result.status !== 0 || tapFailure) {
    failures += 1;
    console.log("FAILED");
    process.stdout.write(output);
  } else {
    console.log("ok");
  }
}

if (failures > 0) {
  console.error(`${failures} database test file${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`All ${files.length} provider-neutral database test files passed.`);
