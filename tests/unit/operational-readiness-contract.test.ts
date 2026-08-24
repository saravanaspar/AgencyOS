import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("deployment operational contracts", () => {
  it("ships private, hash-only deployment verification", () => {
    const verifier = source("scripts/operations/verify-deployment.mjs");
    expect(verifier).toContain("database-migration-parity");
    expect(verifier).toContain("database-provider-doctor");
    expect(verifier).toContain("database-pgtap");
    expect(verifier).toContain("public-login-security-headers");
    expect(verifier).toContain("manifestSha256");
    expect(verifier).toContain("writePrivateJson");
    expect(verifier).not.toContain("response.text()");
  });

  it("documents deployment verification and practical recovery without JSON templates", () => {
    const operations = source("docs/OPERATIONS.md");
    const tasks = source("TASK.md");
    expect(operations).toContain("security:deployment:verify");
    expect(operations).toContain("Backup and recovery");
    expect(operations).toContain("Recovery does not require any repository template");
    expect(tasks).toContain("Deployment verification and recovery guidance");
  });

  it("keeps authentication redirects and MCP responses private", () => {
    const proxy = source("src/integrations/auth/proxy.ts");
    const mcp = source("src/app/api/mcp/route.ts");
    expect(proxy).toContain('redirectResponse.headers.set("Cache-Control", "private, no-store")');
    expect(mcp).toContain('const privateNoStoreHeaders = { "Cache-Control": "private, no-store" }');
  });

  it("exposes deployment verification through a package command", () => {
    const packageJson = JSON.parse(source("package.json"));
    expect(packageJson.scripts["security:deployment:verify"]).toContain("verify-deployment.mjs");
  });
});
