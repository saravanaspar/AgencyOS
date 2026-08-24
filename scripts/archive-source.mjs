#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

const output = resolve(process.argv[2] ?? "agencyos-source.zip");
const forbidden = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)test-results\//,
  /(^|\/)\.agents\//,
  /(^|\/)\.impeccable\//,
  /(^|\/)supabase\//,
  /(^|\/)makeowner\.txt$/,
  /(^|\/)tsconfig\.tsbuildinfo$/,
  /(^|\/)playwright-report\//,
  /(^|\/)deployment-verification-summary\.json$/,
  /(^|\/)(?:id_rsa|id_ed25519|.*\.pem|.*\.key)$/i,
];

const listed = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (listed.status !== 0) {
  console.error("Safe source archives require a Git worktree so ignored files cannot be included.");
  process.exit(1);
}
const files = listed.stdout.split("\0").filter(Boolean);
const unsafe = files.filter((file) => forbidden.some((pattern) => pattern.test(file)));
if (unsafe.length) {
  console.error(`Refusing to archive tracked sensitive or generated files:\n${unsafe.join("\n")}`);
  process.exit(1);
}
const archived = spawnSync("git", ["archive", "--format=zip", `--output=${output}`, "HEAD"], {
  stdio: "inherit",
});
if (archived.status !== 0) process.exit(archived.status ?? 1);
console.log(`Created ${basename(output)} from tracked files only.`);
