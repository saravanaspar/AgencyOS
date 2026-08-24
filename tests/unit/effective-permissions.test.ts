import { describe, expect, it } from "vitest";

import type { AccessPermissionRow } from "@/modules/identity/server/get-current-access-context";
import { resolveEffectivePermissionRows } from "@/modules/permissions/server/effective-permissions";

function resolve(rows: AccessPermissionRow[]) {
  return Object.fromEntries(resolveEffectivePermissionRows(rows));
}

describe("effective permission resolution", () => {
  it("keeps the broadest scope granted by active roles", () => {
    expect(
      resolve([
        { key: "projects.task.view", scope: "own", effect: "allow", source: "role" },
        { key: "projects.task.view", scope: "department", effect: "allow", source: "role" },
        { key: "projects.task.view", scope: "team", effect: "allow", source: "role" },
      ]),
    ).toEqual({ "projects.task.view": "department" });
  });

  it("lets an explicit deny override every role grant", () => {
    expect(
      resolve([
        {
          key: "settings.user.manage_access",
          scope: "organization",
          effect: "allow",
          source: "role",
        },
        {
          key: "settings.user.manage_access",
          scope: null,
          effect: "deny",
          source: "override",
        },
      ]),
    ).toEqual({});
  });

  it("uses an explicit allow override scope instead of the role scope", () => {
    expect(
      resolve([
        { key: "crm.lead.view", scope: "organization", effect: "allow", source: "role" },
        { key: "crm.lead.view", scope: "team", effect: "allow", source: "override" },
      ]),
    ).toEqual({ "crm.lead.view": "team" });
  });

  it("defaults a scope-free allow override to organization scope", () => {
    expect(
      resolve([
        { key: "reports.workspace.view", scope: null, effect: "allow", source: "override" },
      ]),
    ).toEqual({ "reports.workspace.view": "organization" });
  });
});
