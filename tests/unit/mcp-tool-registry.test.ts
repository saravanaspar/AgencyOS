import { beforeAll, describe, expect, it } from "vitest";

let registry: typeof import("@/modules/mcp/tool-registry");

beforeAll(async () => {
  registry = await import("@/modules/mcp/tool-registry");
});

describe("AgencyOS MCP tool registry", () => {
  it("keeps every tool name unique in the central registry", () => {
    const names = registry.AGENCYOS_MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes only tools allowed by effective permissions", () => {
    const employeeTools = registry
      .getAvailableMcpToolsForPermissions(new Set(["settings.organization.view"]))
      .map((tool) => tool.name);

    expect(employeeTools).toContain("agencyos.access.get_current");
    expect(employeeTools).toContain("agencyos.organization.get_profile");
    expect(employeeTools).not.toContain("agencyos.users.change_status");
    expect(employeeTools).not.toContain("agencyos.roles.set_permissions");
  });

  it("requires one of the structure visibility permissions", () => {
    expect(
      registry.getAvailableMcpToolsForPermissions(new Set()).map((tool) => tool.name),
    ).not.toContain("agencyos.structure.get");

    expect(
      registry
        .getAvailableMcpToolsForPermissions(new Set(["settings.team.view"]))
        .map((tool) => tool.name),
    ).toContain("agencyos.structure.get");
  });

  it("keeps destructive tools permission-gated", () => {
    expect(registry.getToolRequiredPermissions("agencyos.roles.delete")).toEqual({
      all: ["settings.role.delete"],
      any: [],
    });
  });

  it("exposes CRM tools only for matching CRM permissions", () => {
    const viewerTools = registry
      .getAvailableMcpToolsForPermissions(new Set(["crm.workspace.view", "crm.lead.view"]))
      .map((tool) => tool.name);

    expect(viewerTools).toContain("agencyos.crm.get_workspace");
    expect(viewerTools).not.toContain("agencyos.crm.create_lead");

    const sellerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["crm.workspace.view", "crm.lead.view", "crm.lead.create"]),
      )
      .map((tool) => tool.name);

    expect(sellerTools).toContain("agencyos.crm.create_lead");
  });

  it("marks CRM deletion as destructive and permission-gated", () => {
    expect(registry.getToolRequiredPermissions("agencyos.crm.delete_lead")).toEqual({
      all: ["crm.lead.delete"],
      any: [],
    });
    const descriptor = registry.AGENCYOS_MCP_TOOLS.find(
      (tool) => tool.name === "agencyos.crm.delete_lead",
    );
    expect(descriptor?.annotations?.destructiveHint).toBe(true);
  });

  it("exposes CRM synchronization without exposing connector credentials or file contents", () => {
    const tools = registry
      .getAvailableMcpToolsForPermissions(new Set(["crm.connection.manage", "crm.import.execute"]))
      .map((tool) => tool.name);

    expect(tools).toContain("agencyos.crm.sync_connection");
    expect(tools).toContain("agencyos.crm.check_connection_health");
    expect(tools).toContain("agencyos.crm.update_connection_schedule");
    expect(tools).toContain("agencyos.crm.set_connection_status");
    expect(tools).toContain("agencyos.crm.delete_connection");
    expect(tools.some((name) => name.includes("create_connection"))).toBe(false);
    expect(tools.some((name) => name.includes("file_import"))).toBe(false);
    expect(tools.some((name) => name.includes("oauth"))).toBe(false);
    expect(tools.some((name) => name.includes("credential"))).toBe(false);
  });

  it("exposes only recipient-safe notification tools", () => {
    const viewerTools = registry
      .getAvailableMcpToolsForPermissions(new Set(["notifications.notification.view"]))
      .map((tool) => tool.name);

    expect(viewerTools).toContain("agencyos.notifications.get_center");
    expect(viewerTools).not.toContain("agencyos.notifications.mark_read");

    const updateTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["notifications.notification.view", "notifications.notification.update"]),
      )
      .map((tool) => tool.name);

    expect(updateTools).toContain("agencyos.notifications.mark_read");
    expect(updateTools).toContain("agencyos.notifications.mark_all_read");
    expect(updateTools.some((name) => name.includes("create"))).toBe(false);
  });

  it("keeps project attachment contents out of MCP while exposing safe stage-two operations", () => {
    const tools = registry
      .getAvailableMcpToolsForPermissions(
        new Set([
          "projects.project.update",
          "projects.project.archive",
          "projects.task.view",
          "projects.task.update",
          "projects.task.assign",
        ]),
      )
      .map((tool) => tool.name);

    expect(tools).toContain("agencyos.projects.create_phase");
    expect(tools).toContain("agencyos.projects.create_milestone");
    expect(tools).toContain("agencyos.projects.set_phase_status");
    expect(tools).toContain("agencyos.projects.set_milestone_status");
    expect(tools).toContain("agencyos.projects.set_task_dependency");
    expect(tools).toContain("agencyos.projects.set_task_recurrence");
    expect(tools).toContain("agencyos.projects.request_closure");
    expect(tools).toContain("agencyos.projects.set_archive_state");
    expect(tools.some((name) => name.includes("attachment"))).toBe(false);
  });

  it("permission-gates project workspace and task operations", () => {
    const viewerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["projects.workspace.view", "projects.project.view", "projects.task.view"]),
      )
      .map((tool) => tool.name);

    expect(viewerTools).toContain("agencyos.projects.get_workspace");
    expect(viewerTools).not.toContain("agencyos.projects.create_project");
    expect(viewerTools).not.toContain("agencyos.projects.create_task");

    const workerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set([
          "projects.workspace.view",
          "projects.project.view",
          "projects.task.view",
          "projects.task.create",
          "projects.comment.create",
          "projects.time.create",
        ]),
      )
      .map((tool) => tool.name);

    expect(workerTools).toContain("agencyos.projects.create_task");
    expect(workerTools).toContain("agencyos.projects.add_comment");
    expect(workerTools).toContain("agencyos.projects.log_time");
  });

  it("permission-gates shared approval tools without exposing policy administration", () => {
    const submitterTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["approvals.request.view", "approvals.request.create"]),
      )
      .map((tool) => tool.name);

    expect(submitterTools).toContain("agencyos.approvals.get_workspace");
    expect(submitterTools).toContain("agencyos.approvals.submit_request");
    expect(submitterTools).not.toContain("agencyos.approvals.decide_step");

    const approverTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set([
          "approvals.request.view",
          "approvals.request.approve",
          "approvals.request.reject",
          "approvals.request.reassign",
        ]),
      )
      .map((tool) => tool.name);

    expect(approverTools).toContain("agencyos.approvals.decide_step");
    expect(approverTools).toContain("agencyos.approvals.reassign_step");
    expect(approverTools.some((name) => name.includes("definition"))).toBe(false);
    expect(approverTools.some((name) => name.includes("delegation"))).toBe(false);
  });

  it("permission-gates the People workspace tool and keeps personal HR fields out of its descriptor", () => {
    const tools = registry
      .getAvailableMcpToolsForPermissions(new Set(["hr.workspace.view", "hr.employee.view"]))
      .map((tool) => tool.name);

    expect(tools).toContain("agencyos.hr.get_workspace");
    expect(
      registry
        .getAvailableMcpToolsForPermissions(new Set(["hr.workspace.view"]))
        .map((tool) => tool.name),
    ).not.toContain("agencyos.hr.get_workspace");

    const descriptor = registry.AGENCYOS_MCP_TOOLS.find(
      (tool) => tool.name === "agencyos.hr.get_workspace",
    );
    expect(descriptor?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.stringify(descriptor?.inputSchema)).not.toMatch(/personal|birth|salary|bank|file/i);
  });

  it("permission-gates finance tools and keeps files and credentials out of MCP", () => {
    const viewerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["finance.workspace.view", "finance.invoice.view"]),
      )
      .map((tool) => tool.name);

    expect(viewerTools).toContain("agencyos.finance.get_workspace");
    expect(viewerTools).not.toContain("agencyos.finance.create_invoice");
    expect(viewerTools).not.toContain("agencyos.finance.issue_invoice");

    const issuerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set([
          "finance.workspace.view",
          "finance.invoice.view",
          "finance.invoice.create",
          "finance.invoice.issue",
        ]),
      )
      .map((tool) => tool.name);

    expect(issuerTools).toContain("agencyos.finance.create_invoice");
    expect(issuerTools).toContain("agencyos.finance.issue_invoice");
    expect(issuerTools.some((name) => name.includes("attachment"))).toBe(false);
    expect(issuerTools.some((name) => name.includes("credential"))).toBe(false);
  });
  it("permission-gates document search and exposes metadata only", () => {
    const viewerTools = registry
      .getAvailableMcpToolsForPermissions(
        new Set(["documents.workspace.view", "documents.document.view"]),
      )
      .map((tool) => tool.name);

    expect(viewerTools).toContain("agencyos.documents.search_library");
    expect(
      registry
        .getAvailableMcpToolsForPermissions(new Set(["documents.workspace.view"]))
        .map((tool) => tool.name),
    ).not.toContain("agencyos.documents.search_library");

    const descriptor = registry.AGENCYOS_MCP_TOOLS.find(
      (tool) => tool.name === "agencyos.documents.search_library",
    );
    expect(descriptor?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.stringify(descriptor)).not.toMatch(
      /storagePath|storageBucket|fileContents|commentBody|legalHoldReason|accessGrants/i,
    );
  });
  it("permission-gates legal compliance search and keeps sensitive fields out of MCP", () => {
    const tools = registry
      .getAvailableMcpToolsForPermissions(new Set(["legal.workspace.view", "legal.record.view"]))
      .map((tool) => tool.name);

    expect(tools).toContain("agencyos.legal.search_compliance_records");
    expect(
      registry
        .getAvailableMcpToolsForPermissions(new Set(["legal.workspace.view"]))
        .map((tool) => tool.name),
    ).not.toContain("agencyos.legal.search_compliance_records");

    const descriptor = registry.AGENCYOS_MCP_TOOLS.find(
      (tool) => tool.name === "agencyos.legal.search_compliance_records",
    );
    expect(descriptor?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.stringify(descriptor)).not.toMatch(
      /storagePath|fileContents|internalSummary|closureReason|eventDetails/i,
    );
  });
  it("connects dashboard, calendar, reports, automation, and search with explicit permissions", () => {
    const permissions = new Set([
      "dashboard.workspace.view",
      "calendar.workspace.view",
      "calendar.event.view",
      "calendar.event.create",
      "calendar.event.manage",
      "reports.workspace.view",
      "automation.workspace.view",
      "automation.definition.view",
      "automation.definition.manage_settings",
      "automation.execution.retry",
      "search.records.view",
    ]);
    const tools = registry.getAvailableMcpToolsForPermissions(permissions).map((tool) => tool.name);
    for (const name of [
      "agencyos.dashboard.get_workspace",
      "agencyos.calendar.get_workspace",
      "agencyos.calendar.create_event",
      "agencyos.calendar.cancel_event",
      "agencyos.reports.get_workspace",
      "agencyos.automation.get_workspace",
      "agencyos.automation.create_definition",
      "agencyos.automation.set_enabled",
      "agencyos.automation.retry_dispatch",
      "agencyos.search.records",
    ]) {
      expect(tools).toContain(name);
    }
  });

  it("keeps new write tools hidden from read-only users", () => {
    const tools = registry
      .getAvailableMcpToolsForPermissions(
        new Set([
          "calendar.workspace.view",
          "calendar.event.view",
          "automation.workspace.view",
          "automation.definition.view",
        ]),
      )
      .map((tool) => tool.name);
    expect(tools).toContain("agencyos.calendar.get_workspace");
    expect(tools).toContain("agencyos.automation.get_workspace");
    expect(tools).not.toContain("agencyos.calendar.create_event");
    expect(tools).not.toContain("agencyos.calendar.cancel_event");
    expect(tools).not.toContain("agencyos.automation.create_definition");
  });
});
