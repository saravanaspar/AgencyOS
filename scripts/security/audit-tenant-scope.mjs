#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const baselinePath = resolve(root, "security/tenant-scope-baseline.json");

async function walk(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path, extensions)));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}

async function tenantTables() {
  const migrationFiles = await walk(resolve(root, "database/migrations"), new Set([".sql"]));
  const tables = new Set();
  const createPattern =
    /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  for (const path of migrationFiles) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(createPattern)) {
      if (/\borganization_id\b/i.test(match[2])) tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

function signature(path, tables, sqlText) {
  return createHash("sha256")
    .update(`${path}\n${tables.join(",")}\n${normalize(sqlText)}`)
    .digest("hex");
}

const tenant = await tenantTables();
const sourceFiles = await walk(resolve(root, "src"), new Set([".ts", ".tsx"]));
const findings = [];
const tagPattern = /\b(?:sql|database|transaction)(?:\s*<[^`]*?>)?\s*`([\s\S]*?)`/g;
const relationPattern = /\b(?:from|join|update|into|delete\s+from)\s+public\.([a-z0-9_]+)/gi;

for (const absolutePath of sourceFiles) {
  const path = relative(root, absolutePath).replaceAll("\\", "/");
  const source = await readFile(absolutePath, "utf8");
  for (const match of source.matchAll(tagPattern)) {
    const sqlText = match[1];
    const referenced = [
      ...new Set(
        [...sqlText.matchAll(relationPattern)]
          .map((item) => item[1].toLowerCase())
          .filter((name) => tenant.has(name)),
      ),
    ].sort();
    if (referenced.length === 0 || /\borganization_id\b/i.test(sqlText)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    findings.push({
      signature: signature(path, referenced, sqlText),
      path,
      line,
      tables: referenced,
      preview: normalize(sqlText).slice(0, 180),
    });
  }
}
findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

if (process.argv.includes("--write-baseline")) {
  await writeFile(
    baselinePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        policy:
          "Tagged SQL touching organization-owned tables without an explicit organization_id predicate is review-required. Existing legacy query signatures are baselined for regression control; baseline inclusion is not a safety attestation, and any new or changed unscoped query fails CI.",
        tenantTableCount: tenant.size,
        legacyExceptions: findings,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Wrote ${findings.length} baselined tenant-scope exceptions across ${tenant.size} organization-owned tables.`,
  );
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const baselined = new Set((baseline.legacyExceptions ?? []).map((entry) => entry.signature));
const newFindings = findings.filter((entry) => !baselined.has(entry.signature));
if (newFindings.length) {
  console.error(
    "Tenant-scope audit failed. New/changed SQL touches tenant-owned tables without an explicit organization_id reference:",
  );
  for (const item of newFindings)
    console.error(` - ${item.path}:${item.line} [${item.tables.join(", ")}] ${item.preview}`);
  console.error(
    "Add explicit organization scoping or perform a security review before intentionally updating the baseline.",
  );
  process.exit(1);
}
console.log(
  `Tenant-scope audit OK: ${tenant.size} organization-owned tables; ${findings.length} baselined legacy exceptions; no new unscoped tagged SQL.`,
);
