import { describe, expect, it } from "vitest";

import {
  humanizeModuleName,
  humanizePermissionKey,
  summarizePermissionKey,
} from "@/modules/permissions/permission-display";

describe("permission display helpers", () => {
  it("humanizes module labels", () => {
    expect(humanizeModuleName("crm")).toBe("CRM");
    expect(humanizeModuleName("notifications")).toBe("Notifications");
  });

  it("normalizes permission keys into readable actions", () => {
    expect(humanizePermissionKey("assets.workspace.view")).toBe("Open Assets");
    expect(humanizePermissionKey("settings.role.manage_access")).toBe("Manage access for roles");
    expect(humanizePermissionKey("notifications.preference.manage_settings")).toBe(
      "Manage notification preferences",
    );
  });

  it("builds readable summaries", () => {
    expect(summarizePermissionKey("assets.workspace.view")).toContain("open the Assets module");
    expect(summarizePermissionKey("settings.audit.export")).toContain("export audit log");
  });
});
