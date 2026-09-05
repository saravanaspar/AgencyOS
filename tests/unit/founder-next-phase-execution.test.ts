import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("founder next-phase execution layer", () => {
  it("keeps Executive Analyst strictly permission-filtered and read-only", () => {
    const ai = source("src/modules/ai/ai.ts");
    const route = source("src/app/api/ai/chat/route.ts");
    const agent = source("src/modules/ai/server/agent.ts");
    const governance = source("src/modules/ai/server/governance.ts");
    const mcp = source("src/modules/mcp/tool-registry.ts");
    const metricTool = source("src/modules/mcp/tools/reports-metric-definitions.ts");

    expect(ai).toContain('["operations", "executive"]');
    expect(route).toContain('mode: z.enum(aiModes).default("operations")');
    expect(agent).toContain("filterToolsForExecutiveAnalysis(policyTools)");
    expect(agent).toContain("You are strictly read-only");
    expect(agent).toContain("never use free-form SQL or arbitrary HTTP");
    expect(governance).toContain("EXECUTIVE_ANALYSIS_TOOL_ALLOWLIST");
    expect(governance).toContain("tool.annotations?.readOnlyHint === true");
    expect(governance).toContain('"agencyos.reports.get_metric_definitions"');
    expect(governance).not.toContain('"agencyos.calendar.create_event"');
    expect(mcp).toContain("reportsMetricDefinitionsMcpTool");
    expect(metricTool).toContain('name: "agencyos.reports.get_metric_definitions"');
    expect(metricTool).toContain("metricDefinitionCatalog");
  });

  it("extends the existing command palette with permission-aware create and action commands", () => {
    const registry = source("src/modules/module-registry.ts");
    const palette = source("src/components/shell/command-palette.tsx");
    const shell = source("src/components/shell/workspace-shell.tsx");

    for (const label of [
      "Create lead",
      "Create client",
      "Create project",
      "Create task",
      "Create estimate",
      "Create invoice",
      "Record payment",
      "Record expense",
      "Add vendor",
      "Upload document",
      "Create ticket",
      "Add contract",
      "Add asset",
      "Open overdue invoices",
      "Review projects at risk",
      "Generate or review reports",
    ]) {
      expect(registry, label).toContain(`label: "${label}"`);
    }
    expect(registry).toContain("getAuthorizedGlobalCommandActions");
    expect(registry).toContain("hasRequiredPermissions");
    expect(palette).toContain("getAuthorizedGlobalCommandActions(new Set(permissions))");
    expect(palette).toContain("<h3>Actions</h3>");
    expect(shell).toContain("permissions={permissions}");

    expect(source("src/components/crm/crm-workspace.tsx")).toContain(
      'searchParams.get("create") === "lead"',
    );
    const createQueryDetails = source("src/components/shell/create-query-details.tsx");
    expect(createQueryDetails).toContain('searchParams.get("create") === target');
    expect(source("src/app/(workspace)/projects/page.tsx")).toContain(
      'openCreateProject={firstValue(raw.create) === "project"}',
    );
    expect(source("src/components/projects/projects-workspace.tsx")).toContain(
      '<CreateQueryDetails className="project-inline-panel project-inline-panel--task" target="task">',
    );
    expect(source("src/components/finance/finance-workspace.tsx")).toContain(
      '<CreateQueryDetails className="finance-create-panel" target="invoice">',
    );
    expect(source("src/components/vendors/vendors-workspace.tsx")).toContain(
      '<CreateQueryDetails target="vendor">',
    );
    expect(source("src/components/support/support-workspace.tsx")).toContain('id="create-ticket"');
  });

  it("fills current notification gaps using the existing notification delivery pipeline", () => {
    const worker = source("src/modules/automation/server/event-dispatch-worker.ts");
    const projectActions = source("src/modules/projects/actions/projects.ts");

    expect(worker).toContain(
      'import { enqueueNotification } from "@/modules/notifications/server/notifications"',
    );
    expect(worker).toContain('category: "contract_expiry"');
    expect(worker).toContain('category: "licence_expiry"');
    expect(worker).toContain("record.record_type = 'licence'");
    expect(worker).toContain("legal-contract-reminder:");
    expect(worker).toContain("legal-licence-reminder:");
    expect(worker).toContain("not exists (\n        select 1 from public.notifications");

    expect(projectActions).toContain('category: "assignment"');
    expect(projectActions).toContain("returning task_id");
    expect(projectActions).toContain("project-task-assignment:");
    expect(projectActions).toContain("parsed.data.membershipId !== context.membership.id");
  });

  it("enriches the existing JSONB project blueprint without duplicating project subsystems", () => {
    const blueprint = source("src/modules/projects/server/project-blueprints.ts");

    expect(blueprint).toContain("labels?: Array");
    expect(blueprint).toContain("checklist?: Array");
    expect(blueprint).toContain("recurrence?:");
    expect(blueprint).toContain("dependencies?: Array");
    expect(blueprint).toContain("public.project_labels");
    expect(blueprint).toContain("public.project_task_labels");
    expect(blueprint).toContain("public.project_task_checklist_items");
    expect(blueprint).toContain("public.project_task_recurrences");
    expect(blueprint).toContain("public.project_task_dependencies");
    expect(blueprint).toContain("coalesce(${startDate}::date, current_date)");
    expect(blueprint).not.toContain("project_task_watchers");
    expect(blueprint).not.toContain("project_task_attachments");
  });
});
