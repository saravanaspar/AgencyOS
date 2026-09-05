#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const tag = process.argv[2]?.trim();
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error("Usage: npm run release:production -- vX.Y.Z");
  process.exit(1);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || `git ${args[0]} failed.`);
    process.exit(result.status ?? 1);
  }
  return result.stdout?.trim() || "";
}

if (git(["status", "--porcelain", "--untracked-files=all"])) {
  console.error(
    "Production releases require a clean worktree. Commit and review every file first.",
  );
  process.exit(1);
}
const head = git(["rev-parse", "HEAD"]);
const existing = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`], {
  encoding: "utf8",
});
if (existing.status === 0 && existing.stdout.trim() !== head) {
  console.error(`Tag ${tag} already points to another commit.`);
  process.exit(1);
}
if (existing.status !== 0) {
  git(["tag", "--annotate", tag, "--message", `AgencyOS production release ${tag}`]);
}
if (git(["rev-parse", `${tag}^{commit}`]) !== head) {
  console.error(`Tag ${tag} does not resolve to HEAD.`);
  process.exit(1);
}
git(["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { stdio: "inherit" });
console.log(
  `Pushed only ${tag}; the protected release workflow will build, verify, and deploy it.`,
);
