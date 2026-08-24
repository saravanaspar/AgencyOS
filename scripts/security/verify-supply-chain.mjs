#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const failures = [];
const workflowDirectory = resolve(process.cwd(), ".github/workflows");
for (const entry of await readdir(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
  const text = await readFile(resolve(workflowDirectory, entry.name), "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/\buses:\s*([^\s#]+)@([^\s#]+)/);
    if (!match || match[1].startsWith("./")) return;
    if (!/^[0-9a-f]{40}$/i.test(match[2])) {
      failures.push(
        `.github/workflows/${entry.name}:${index + 1}: ${match[1]} is not pinned to a 40-character commit SHA`,
      );
    }
  });
}

const verifyWorkflow = await readFile(".github/workflows/react-doctor.yml", "utf8");
for (const expected of ["postgres:17.10-bookworm@sha256:", "redis:7.4.10-alpine@sha256:"]) {
  if (!verifyWorkflow.includes(expected)) {
    failures.push(
      `.github/workflows/react-doctor.yml: CI service image must be digest-pinned (${expected})`,
    );
  }
}

const [dockerfile, nodeVersion, packageJson] = await Promise.all([
  readFile("Dockerfile", "utf8"),
  readFile(".node-version", "utf8").then((value) => value.trim()),
  readFile("package.json", "utf8").then(JSON.parse),
]);
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
  failures.push(".node-version must be an exact Node.js patch version");
}
if (!dockerfile.includes(`node:${nodeVersion}-bookworm-slim@sha256:`)) {
  failures.push(
    `Dockerfile must use the exact .node-version runtime (${nodeVersion}) with a digest pin`,
  );
}
if (!String(packageJson.engines?.node ?? "").startsWith(`>=${nodeVersion}`)) {
  failures.push(`package.json engines.node must enforce the .node-version floor (${nodeVersion})`);
}
for (const [index, line] of dockerfile.split(/\r?\n/).entries()) {
  const match = line.match(/^FROM\s+([^\s]+)(?:\s+AS\s+\S+)?$/i);
  if (match && !match[1].includes("@sha256:"))
    failures.push(`Dockerfile:${index + 1}: base image is not digest-pinned`);
}

const compose = await readFile("compose.production.yaml", "utf8");
if (!/AGENCYOS_IMAGE:\?Set AGENCYOS_IMAGE to an immutable application digest/.test(compose)) {
  failures.push(
    "compose.production.yaml: AGENCYOS_IMAGE must explicitly require an immutable digest",
  );
}
const gateway = compose.match(/gateway:[\s\S]*?\n\s+image:\s*([^\s]+)/)?.[1];
if (!gateway?.includes("@sha256:"))
  failures.push("compose.production.yaml: gateway image must be digest-pinned");
for (const control of ["pids_limit:", "mem_limit:", "cpus:"]) {
  if (!compose.includes(control))
    failures.push(`compose.production.yaml: missing runtime resource control ${control}`);
}

if (failures.length) {
  console.error(
    "Supply-chain verification failed:\n" + failures.map((failure) => ` - ${failure}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  "Supply-chain verification OK: workflow actions and production/base images are immutable pins.",
);
