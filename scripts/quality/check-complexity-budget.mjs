#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const baselinePath = resolve(root, "quality/complexity-baseline.json");
const limits = { ".ts": 1200, ".tsx": 1200, ".css": 4000 };

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (limits[extname(entry.name)]) result.push(path);
  }
  return result;
}

async function lineCount(path) {
  const text = await readFile(path, "utf8");
  return text === "" ? 0 : text.split(/\r?\n/).length;
}

const files = await walk(resolve(root, "src"));
const current = [];
for (const path of files) {
  const extension = extname(path);
  const lines = await lineCount(path);
  if (lines > limits[extension]) {
    current.push({
      path: relative(root, path).replaceAll("\\", "/"),
      lines,
      defaultLimit: limits[extension],
    });
  }
}
current.sort((a, b) => a.path.localeCompare(b.path));

if (process.argv.includes("--write-baseline")) {
  await writeFile(
    baselinePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        policy:
          "Files already above the default budget may shrink but may not grow; new files may not exceed the default budget.",
        limits,
        exceptions: Object.fromEntries(current.map((entry) => [entry.path, entry.lines])),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${current.length} complexity exceptions to quality/complexity-baseline.json.`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const failures = [];
for (const entry of current) {
  const ceiling = baseline.exceptions?.[entry.path];
  if (ceiling === undefined) {
    failures.push(
      `${entry.path}: ${entry.lines} lines exceeds new-file budget ${entry.defaultLimit}`,
    );
  } else if (entry.lines > ceiling) {
    failures.push(`${entry.path}: grew to ${entry.lines} lines (grandfathered ceiling ${ceiling})`);
  }
}

if (failures.length) {
  console.error("Complexity budget failed:\n" + failures.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}
console.log(
  `Complexity budget OK: ${files.length} source files checked; ${current.length} grandfathered oversized files did not grow.`,
);
