#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match)
    throw new Error(
      `${label} must be an exact stable semver (x.y.z); received ${JSON.stringify(value)}.`,
    );
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const [packageJson, packageLock, baseline] = await Promise.all([
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("package-lock.json", "utf8").then(JSON.parse),
  readFile("security/framework-baseline.json", "utf8").then(JSON.parse),
]);

const declared = packageJson.dependencies?.next;
const locked = packageLock.packages?.["node_modules/next"]?.version;
const minimum = baseline.next?.minimumVersion;
if (!declared || !locked || !minimum)
  throw new Error("Next.js dependency/baseline metadata is incomplete.");

const declaredVersion = parseVersion(declared, "package.json dependencies.next");
const lockedVersion = parseVersion(locked, "package-lock node_modules/next.version");
const minimumVersion = parseVersion(minimum, "framework baseline minimumVersion");

if (compareVersions(declaredVersion, lockedVersion) !== 0) {
  throw new Error(`Next.js must be exact-pinned: package.json=${declared}, lockfile=${locked}.`);
}
if (compareVersions(lockedVersion, minimumVersion) < 0) {
  throw new Error(
    `Next.js ${locked} is below the reviewed security floor ${minimum}. Upgrade before merging/releasing.`,
  );
}

console.log(
  `Framework security floor OK: Next.js ${locked} (minimum ${minimum}, reviewed ${baseline.next.reviewedAt}).`,
);
