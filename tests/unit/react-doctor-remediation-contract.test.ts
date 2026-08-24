import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("React Doctor remediation contracts", () => {
  it("keeps authorization visible in every exported CRM connection action", () => {
    const actions = source("src/modules/crm/actions/imports.ts");
    const exportedActions = actions.match(/export async function \w+Action\(/g) ?? [];
    const authorizationCalls = actions.match(/authorizeCurrentUser\(\[permissions\./g) ?? [];

    expect(exportedActions).toHaveLength(8);
    expect(authorizationCalls).toHaveLength(8);
    expect(actions).toContain("contextFromAuthorization");
    expect(actions).not.toContain("contextFor(");
  });

  it("keeps sign-out safe and idempotent for signed-out callers", () => {
    const auth = source("src/modules/identity/actions/auth.ts");
    const signOut = auth.slice(auth.indexOf("export async function signOutAction"));

    expect(signOut).toContain("revokeCurrentIdentitySession");
    expect(signOut).toContain('redirect("/login")');
    expect(signOut).not.toContain("supabase");
  });

  it("uses Zod 4 top-level string formats throughout application source", () => {
    const files = [
      "src/modules/approvals/schemas/approvals.ts",
      "src/modules/crm/schemas/crm.ts",
      "src/modules/crm/schemas/imports.ts",
      "src/modules/finance/schemas/finance.ts",
      "src/modules/notifications/schemas/notifications.ts",
      "src/modules/organization-structure/schemas/organization-structure.ts",
      "src/modules/permissions/schemas/role-editor.ts",
      "src/modules/projects/schemas/projects.ts",
    ];

    for (const file of files) {
      const contents = source(file);
      expect(contents).not.toMatch(/z\.string\(\)\.(?:uuid|datetime|url|email)\(/);
    }
  });

  it("persists the external-reference and generated-output scan exclusions", () => {
    const config = JSON.parse(source("doctor.config.json")) as {
      ignore: { files: string[] };
    };

    expect(config.ignore.files).toEqual(
      expect.arrayContaining([
        "agencyos-references/**",
        ".next/**",
        "node_modules/**",
        "coverage/**",
      ]),
    );
  });
  it("keeps modal controls and finance evidence accessible and deterministic", () => {
    const approvals = source("src/components/approvals/approval-dialog-shell.tsx");
    const projects = source("src/components/projects/projects-workspace.tsx");
    const commandPalette = source("src/components/shell/command-palette.tsx");
    const crm = source("src/components/crm/crm-workspace.tsx");
    const expenses = source("src/components/finance/expenses-section.tsx");
    const finance = source("src/components/finance/finance-workspace.tsx");

    expect(
      approvals.slice(
        approvals.indexOf("<dialog"),
        approvals.indexOf(">", approvals.indexOf("<dialog")),
      ),
    ).not.toContain("onClick");
    expect(
      projects.slice(
        projects.indexOf("<dialog"),
        projects.indexOf(">", projects.indexOf("<dialog")),
      ),
    ).not.toContain("onClick");
    expect(commandPalette).toContain('aria-labelledby="command-palette-title"');
    expect(commandPalette).toContain('aria-label="Close navigation"');
    expect(crm).toContain('aria-label="Owner"');
    expect(expenses).toContain('aria-label="Receipt file"');
    expect(finance).toContain('aria-label="Invoice attachment file"');
    expect(expenses).not.toContain("new Date(event.createdAt).toLocaleString()");
    expect(finance).not.toContain("new Date(version.createdAt).toLocaleString()");
  });
});
