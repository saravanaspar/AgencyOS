import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { projectPermissionKeys } from "@/modules/projects/projects";

const root = process.cwd();
const projectsServerSource = readFileSync(
  path.join(root, "src/modules/projects/server/projects.ts"),
  "utf8",
);
const projectMigration = readFileSync(
  path.join(root, "database/migrations/20260713000900_projects_foundation.sql"),
  "utf8",
);
const moduleAuthorizationMigration = readFileSync(
  path.join(root, "database/migrations/20260713000300_module_authorization.sql"),
  "utf8",
);

function registeredProjectPermissions(): Set<string> {
  const registered = new Set<string>();
  const migrations = `${moduleAuthorizationMigration}\n${projectMigration}`;

  for (const match of migrations.matchAll(/\('projects',\s*'([a-z0-9_]+)',\s*'([a-z0-9_]+)'/g)) {
    registered.add(`projects.${match[1]}.${match[2]}`);
  }

  return registered;
}

describe("project permission and SQL contracts", () => {
  it("uses the canonical identity tables for project member display data", () => {
    expect(projectsServerSource).not.toContain("public.user_profiles");
    expect(projectsServerSource).not.toMatch(
      /\b(?:membership|owner|assignee_membership|watcher_membership|upload_membership)\.email\b/,
    );
    expect(projectsServerSource).toContain("public.profiles");
    expect(projectsServerSource).toContain("public.identity_accounts");
    expect(projectsServerSource).toContain("membership.organization_id = ${organizationId}::uuid");
  });

  it("registers every permission used by the project workspace", () => {
    const registered = registeredProjectPermissions();

    expect([...Object.values(projectPermissionKeys)].filter((key) => !registered.has(key))).toEqual(
      [],
    );
  });

  it("keeps project reads scoped in both the server query and database policies", () => {
    expect(projectsServerSource).toContain("private.project_is_visible");
    expect(projectMigration).toContain(
      "using (private.project_permission_allows(projects.id, 'projects.project.view'))",
    );
    expect(projectMigration).toContain(
      "where role_template.key in ('owner', 'project_manager') and permission.module = 'projects'",
    );
  });
});
