import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const workspaceRoot = join(root, "src/app/(workspace)");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("workspace access failure contracts", () => {
  it("never redirects transient access-check failures from a workspace page", () => {
    const pagePaths = readdirSync(workspaceRoot, { recursive: true, encoding: "utf8" }).filter(
      (path) => path.endsWith("page.tsx"),
    );

    for (const relativePath of pagePaths) {
      const page = readFileSync(join(workspaceRoot, relativePath), "utf8");
      expect(page, relativePath).not.toContain("requirePagePermissions(");
      if (page.includes("redirect(`/access-denied?reason=${")) {
        expect(page, relativePath).toMatch(/PageAccessFailure|reason === "access-check-failed"/);
      }
    }
  });

  it("renders a retry state for infrastructure failures and avoids retry-link prefetches", () => {
    const failure = source("src/components/feedback/page-access-failure.tsx");
    const denied = source("src/app/(public)/access-denied/page.tsx");
    const pending = source("src/app/(public)/pending-access/page.tsx");
    const shell = source("src/components/shell/workspace-shell.tsx");

    expect(failure).toContain('reason === "access-check-failed"');
    expect(failure).toContain("<AccessCheckRetry />");
    expect(denied).toContain('href="/dashboard"');
    expect(denied).toContain("prefetch={false}");
    expect(pending).toContain("prefetch={false}");
    expect(shell).toContain("prefetch={false}");
  });

  it("treats badge counter failures as non-authoritative", () => {
    const counters = source("src/modules/identity/server/workspace-counters.ts");

    expect(counters).toContain("__agencyOsWorkspaceCounterFallback");
    expect(counters).toContain("Badge counters are display-only");
    expect(counters).toContain("unreadNotificationCount: 0");
    expect(counters).toContain("pendingApprovalCount: 0");
  });
});
