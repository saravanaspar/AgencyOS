import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(workspace)/automation/page.tsx", "utf8");
const component = readFileSync("src/components/automation/automation-workspace.tsx", "utf8");

describe("automation workspace", () => {
  it("uses a permission-gated internal automation workspace", () => {
    expect(page).toContain("automationPermissionKeys.workspace");
    expect(page).toContain("getAutomationWorkspaceData");
    expect(page).toContain("AutomationWorkspace");
  });

  it("shows worker status, registered handlers, execution history, and vault links", () => {
    expect(component).toContain("AgencyOS worker");
    expect(component).toContain("INTERNAL_WORKER_SECRET");
    expect(component).toContain('name="handlerKey"');
    expect(component).toContain("Execution history");
    expect(component).toContain("Vaultwarden item links");
    expect(component).toContain("Open Vaultwarden");
    expect(component).not.toContain("n8n");
  });
});
