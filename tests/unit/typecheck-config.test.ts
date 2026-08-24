import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  engines: { node: string };
};
const workflow = readFileSync(path.join(root, ".github/workflows/react-doctor.yml"), "utf8");
const nodeVersion = readFileSync(path.join(root, ".node-version"), "utf8").trim();
const verifyConfig = JSON.parse(readFileSync(path.join(root, "tsconfig.verify.json"), "utf8")) as {
  include: string[];
  exclude: string[];
  compilerOptions: { incremental: boolean; plugins: unknown[] };
};

describe("deterministic TypeScript verification", () => {
  it("typechecks source files without consuming mutable Next development artifacts", () => {
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit --project tsconfig.verify.json");
    expect(verifyConfig.exclude).toContain(".next");
    expect(verifyConfig.include).not.toContain("next-env.d.ts");
    expect(verifyConfig.include.every((entry) => !entry.startsWith(".next"))).toBe(true);
    expect(verifyConfig.compilerOptions.incremental).toBe(false);
    expect(verifyConfig.compilerOptions.plugins).toEqual([]);
  });

  it("still validates TypeScript and Next-generated route contracts", () => {
    expect(packageJson.scripts.verify).toContain("npm run check");
    expect(packageJson.scripts.check).toContain("npm run typecheck");
    expect(packageJson.scripts.verify).toContain("npm run build");
  });

  it("uses the full verification command as the only pull-request CI gate", () => {
    expect(workflow).toContain("node-version-file: .node-version");
    expect(workflow).toContain("run: npm run verify");
    expect(workflow).not.toContain("doctor:ci");
    expect(workflow).not.toContain("doctor:security");
    expect(nodeVersion).toBe("22.23.2");
    expect(packageJson.engines.node).toBe(">=22.23.2 <23");
  });

  it("keeps package commands canonical instead of maintaining redundant aliases", () => {
    expect(packageJson.scripts.test).toBe("vitest run");
    expect(packageJson.scripts.build).toBe("next build --webpack");
    for (const redundantScript of [
      "db:push",
      "db:lint",
      "db:types",
      "test:unit",
      "test:browser:all",
      "test:e2e:list",
      "test:e2e:install-media",
      "test:e2e:with-video",
      "worker:once",
      "doctor:security",
      "doctor:ci",
    ]) {
      expect(packageJson.scripts).not.toHaveProperty(redundantScript);
    }
  });
});
