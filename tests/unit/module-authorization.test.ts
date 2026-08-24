import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getAuthorizedNavigationGroups, navigationGroups } from "@/lib/navigation";
import { moduleRegistry } from "@/modules/module-registry";
import { hasRequiredPermissions, modulePermissionKeys } from "@/modules/permissions/module-access";

describe("module authorization", () => {
  it("requires every permission in a route requirement", () => {
    const permissions = new Set([modulePermissionKeys.dashboard, modulePermissionKeys.calendar]);

    expect(hasRequiredPermissions(permissions, [modulePermissionKeys.dashboard])).toBe(true);
    expect(
      hasRequiredPermissions(permissions, [
        modulePermissionKeys.dashboard,
        modulePermissionKeys.calendar,
      ]),
    ).toBe(true);
    expect(hasRequiredPermissions(permissions, [modulePermissionKeys.finance])).toBe(false);
  });

  it("filters the sidebar and command-palette source to allowed modules", () => {
    const groups = getAuthorizedNavigationGroups(
      new Set([modulePermissionKeys.dashboard, modulePermissionKeys.calendar]),
    );
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));

    expect(labels).toEqual(["Dashboard", "Calendar"]);
    expect(labels).not.toContain("Finance");
    expect(labels).not.toContain("Settings");
  });

  it("defines a permission requirement for every registered module and navigation item", () => {
    expect(
      Object.values(moduleRegistry).every((module) => module.requiredPermissions.length > 0),
    ).toBe(true);
    expect(
      navigationGroups.every((group) =>
        group.items.every((item) => item.requiredPermissions.length > 0),
      ),
    ).toBe(true);
  });

  it("installs every module permission through the module authorization migration", () => {
    const migration = readFileSync(
      "database/migrations/20260713000300_module_authorization.sql",
      "utf8",
    );

    for (const permission of Object.values(modulePermissionKeys)) {
      if (
        permission === modulePermissionKeys.dashboard ||
        permission === modulePermissionKeys.settings ||
        permission === modulePermissionKeys.approvals
      ) {
        continue;
      }

      expect(migration).toContain(permission.replace(".workspace.view", "', 'workspace', 'view"));
    }

    expect(migration).toContain("Synchronize the new template grants");
  });
});
