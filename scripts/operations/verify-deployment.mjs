#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runOperationalCommand, sha256Json, writePrivateJson } from "./operational-command.mjs";

const migrationFilePattern = /^(\d{14})_[a-z0-9_]+\.sql$/i;
const allowedUnauthorizedStatuses = new Set([301, 302, 303, 307, 308, 401, 403, 405]);

export function parseDatabaseStatusOutput(output) {
  const values = {};
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s*(Applied|Local migrations|Pending|Checksum drift):\s*(\d+)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = Number(match[2]);
  }
  return {
    applied: values.Applied ?? null,
    local: values["Local migrations"] ?? null,
    pending: values.Pending ?? null,
    drift: values["Checksum drift"] ?? null,
  };
}

export function databaseStatusIsCurrent(status) {
  return (
    Number.isSafeInteger(status.applied) &&
    Number.isSafeInteger(status.local) &&
    status.applied === status.local &&
    status.pending === 0 &&
    status.drift === 0
  );
}

async function localMigrationVersions(root) {
  const entries = await readdir(resolve(root, "database/migrations"));
  return entries
    .map((entry) => entry.match(migrationFilePattern)?.[1])
    .filter(Boolean)
    .sort();
}

function parseArguments(argv) {
  const result = {
    output: "deployment-verification-summary.json",
    skipPgtap: false,
    skipHttp: false,
    httpOnly: false,
    appUrl: process.env.AGENCYOS_DEPLOYMENT_APP_URL ?? "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") result.output = argv[++index];
    else if (value === "--app-url") result.appUrl = argv[++index];
    else if (value === "--skip-pgtap") result.skipPgtap = true;
    else if (value === "--skip-http") result.skipHttp = true;
    else if (value === "--http-only") result.httpOnly = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function validateAppUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Deployment HTTP verification requires HTTPS except for localhost.");
  }
  return url;
}

async function httpCheck(name, url, expectation, init = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  timer.unref();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "AgencyOS-Deployment-Verification/1.0",
        ...(init.headers ?? {}),
      },
    });
    const headers = Object.fromEntries(
      [...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
    );
    const result = expectation(response.status, headers, new URL(url));
    return {
      name,
      status: result.ok ? "passed" : "failed",
      durationMs: Date.now() - startedAt,
      evidenceSha256: sha256Json({ status: response.status, headers }),
      summary: result.summary,
    };
  } catch (error) {
    return {
      name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      evidenceSha256: sha256Json({ error: error instanceof Error ? error.name : "unknown" }),
      summary: error instanceof Error ? error.message : "HTTP verification failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyHttpDeployment(appUrl) {
  const base = validateAppUrl(appUrl);
  const checks = [];
  checks.push(
    await httpCheck(
      "public-login-security-headers",
      new URL("/login", base),
      (status, headers, url) => {
        const required = [
          "content-security-policy",
          "x-content-type-options",
          "x-frame-options",
          "referrer-policy",
          "permissions-policy",
        ];
        const missing = required.filter((header) => !headers[header]);
        if (url.protocol === "https:" && !headers["strict-transport-security"]) {
          missing.push("strict-transport-security");
        }
        return {
          ok:
            status < 500 && missing.length === 0 && headers["x-content-type-options"] === "nosniff",
          summary:
            missing.length === 0
              ? `Login surface returned ${status} with required security headers.`
              : `Missing security headers: ${missing.join(", ")}.`,
        };
      },
    ),
  );
  for (const [name, path] of [
    ["search-auth-boundary", "/api/search?q=health"],
    ["report-export-auth-boundary", "/api/reports/export?section=finance"],
  ]) {
    checks.push(
      await httpCheck(name, new URL(path, base), (status, headers) => ({
        ok:
          allowedUnauthorizedStatuses.has(status) &&
          /(?:private|no-store)/i.test(headers["cache-control"] ?? ""),
        summary: `Protected surface returned ${status} without an authenticated session.`,
      })),
    );
  }
  checks.push(
    await httpCheck(
      "mcp-auth-boundary",
      new URL("/api/mcp", base),
      (status, headers) => ({
        ok:
          [401, 403].includes(status) &&
          /(?:private|no-store)/i.test(headers["cache-control"] ?? ""),
        summary: `MCP POST returned ${status} without an authenticated session.`,
      }),
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: base.origin },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      },
    ),
  );
  return checks;
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
        : `${name} failed${result.timedOut ? " after timing out" : ""}${result.exitCode === null || result.exitCode === undefined ? "" : ` with exit code ${result.exitCode}`}.`,
  };
}

export async function runDeploymentVerification(options, root = process.cwd()) {
  const startedAt = new Date();
  const checks = [];
  const localVersions = await localMigrationVersions(root);
  const databaseOverride = process.env.AGENCYOS_DEPLOYMENT_DB_URL?.trim();
  const databaseEnv = databaseOverride
    ? { DATABASE_URL: databaseOverride, DATABASE_ADMIN_URL: databaseOverride }
    : {};

  if (!options.httpOnly) {
    const localCheck = await runOperationalCommand({
      command: process.execPath,
      args: ["scripts/database/validate-migrations.mjs"],
      cwd: root,
      timeoutMs: 120_000,
    });
    checks.push(
      commandEvidence("local-migration-validation", localCheck, "Local migrations validated."),
    );

    const statusResult = await runOperationalCommand({
      command: process.execPath,
      args: ["scripts/database/status.mjs"],
      cwd: root,
      env: databaseEnv,
      timeoutMs: 120_000,
    });
    const databaseStatus = parseDatabaseStatusOutput(statusResult.stdoutText);
    const current = statusResult.status === "passed" && databaseStatusIsCurrent(databaseStatus);
    checks.push({
      ...commandEvidence(
        "database-migration-parity",
        { ...statusResult, status: current ? "passed" : "failed" },
        `Database migration history matches ${localVersions.length} local migrations.`,
      ),
      summary: current
        ? `Database migration history matches ${localVersions.length} local migrations.`
        : `Database status is not current (applied=${databaseStatus.applied ?? "unknown"}, local=${databaseStatus.local ?? "unknown"}, pending=${databaseStatus.pending ?? "unknown"}, drift=${databaseStatus.drift ?? "unknown"}).`,
    });

    const doctor = await runOperationalCommand({
      command: process.execPath,
      args: ["scripts/database/doctor.mjs"],
      cwd: root,
      env: databaseEnv,
      timeoutMs: 120_000,
    });
    checks.push(
      commandEvidence(
        "database-provider-doctor",
        doctor,
        "Database provider, first-party identity, extensions, and compatibility cleanup are healthy.",
      ),
    );

    if (!options.skipPgtap) {
      const pgtap = await runOperationalCommand({
        command: process.execPath,
        args: ["scripts/database/test-portable.mjs"],
        cwd: root,
        env: databaseEnv,
        timeoutMs: 900_000,
      });
      checks.push(commandEvidence("database-pgtap", pgtap, "Provider-neutral pgTAP suite passed."));
    }
  }

  if (!options.skipHttp) {
    if (!options.appUrl) throw new Error("--app-url or AGENCYOS_DEPLOYMENT_APP_URL is required.");
    checks.push(...(await verifyHttpDeployment(options.appUrl)));
  }

  const completedAt = new Date();
  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
  const summary = {
    schemaVersion: 1,
    status,
    mode: options.httpOnly ? "http-only" : "postgresql",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    expectedMigration: localVersions.at(-1) ?? null,
    localMigrationCount: localVersions.length,
    checks,
  };
  return { ...summary, manifestSha256: sha256Json(summary) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const summary = await runDeploymentVerification(options);
  const output = await writePrivateJson(options.output, summary);
  process.stdout.write(
    `Deployment verification: ${summary.status}\nEvidence: ${output}\nManifest SHA-256: ${summary.manifestSha256}\n`,
  );
  if (summary.status !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    const failure = {
      schemaVersion: 1,
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      summary: error instanceof Error ? error.message : String(error),
    };
    try {
      const outputArgument = process.argv.findIndex((value) => value === "--output");
      const output =
        outputArgument >= 0
          ? process.argv[outputArgument + 1]
          : "deployment-verification-summary.json";
      await writePrivateJson(output, { ...failure, manifestSha256: sha256Json(failure) });
    } catch {
      // Preserve the original verification failure.
    }
    process.stderr.write(`${failure.summary}\n`);
    process.exitCode = 1;
  });
}
