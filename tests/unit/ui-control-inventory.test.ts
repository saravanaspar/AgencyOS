import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const output = join(root, "test-results", "ui-control-inventory.test.json");

describe("UI control source inventory", () => {
  it("accounts for every button-like control and rejects inaccessible or inert controls", () => {
    rmSync(output, { force: true });
    const stdout = execFileSync(
      process.execPath,
      ["scripts/testing/ui-control-inventory.mjs", "--check", "--output", output],
      { cwd: root, encoding: "utf8" },
    );
    const inventory = JSON.parse(readFileSync(output, "utf8")) as {
      sourceFileCount: number;
      controlCount: number;
      violations: unknown[];
    };

    expect(stdout).toContain("UI control inventory:");
    expect(inventory.sourceFileCount).toBeGreaterThan(50);
    expect(inventory.controlCount).toBeGreaterThan(300);
    expect(inventory.violations).toEqual([]);
  });
});
