import { describe, expect, it } from "vitest";

import {
  automationHandlerKeys,
  automationRetryDelaySeconds,
  automationTriggerKeys,
} from "@/modules/automation/automation";
import { createAutomationDefinitionSchema } from "@/modules/automation/schemas/automation";
import {
  getAiOperationMode,
  prepareMcpInput,
  toolRequiresAiApproval,
} from "@/modules/mcp/ai-governance";

describe("automation dispatch and AI governance", () => {
  it("uses bounded exponential retry delays", () => {
    expect(automationRetryDelaySeconds(1)).toBe(30);
    expect(automationRetryDelaySeconds(2)).toBe(60);
    expect(automationRetryDelaySeconds(8)).toBe(3_840);
    expect(automationRetryDelaySeconds(12)).toBe(21_600);
    expect(automationRetryDelaySeconds(100)).toBe(21_600);
  });

  it("publishes every delivered business trigger key", () => {
    expect(automationTriggerKeys).toEqual([
      "crm.lead_converted",
      "projects.project_created",
      "finance.invoice_issued",
      "finance.invoice_overdue",
      "finance.payment_received",
      "hr.employee_onboarded",
      "hr.employee_offboarded",
      "hr.leave_approved",
      "legal.contract_expiring",
      "support.ticket_escalated",
      "assets.asset_assigned",
    ]);
  });

  it("accepts only registered handlers and the supported condition grammar", () => {
    expect(automationHandlerKeys).toEqual(["notification.owner", "notification.event_actor"]);
    expect(
      createAutomationDefinitionSchema.parse({
        name: "Project created workflow",
        triggerKey: "projects.project_created",
        handlerKey: "notification.owner",
        allowedModules: ["projects"],
        conditions: {
          entityType: "project",
          payloadEquals: { status: "active", priority: 2, enabled: true },
        },
      }).conditions,
    ).toEqual({
      entityType: "project",
      payloadEquals: { status: "active", priority: 2, enabled: true },
    });
    expect(() =>
      createAutomationDefinitionSchema.parse({
        name: "Unknown handler",
        triggerKey: "projects.project_created",
        handlerKey: "shell.execute",
        allowedModules: ["projects"],
        conditions: {},
      }),
    ).toThrow();
    expect(() =>
      createAutomationDefinitionSchema.parse({
        name: "Unsafe workflow",
        triggerKey: "projects.project_created",
        handlerKey: "notification.owner",
        allowedModules: ["projects"],
        conditions: { arbitrarySql: "select * from projects" },
      }),
    ).toThrow();
  });

  it("removes approval metadata, hashes exact arguments, and redacts values from evidence", () => {
    const first = prepareMcpInput({
      projectId: "11111111-1111-4111-8111-111111111111",
      description: "Private narrative that must not be copied to AI evidence.",
      amountMinor: 125_000,
      approvalRequestId: "22222222-2222-4222-8222-222222222222",
    });
    const second = prepareMcpInput({
      amountMinor: 125_000,
      description: "Private narrative that must not be copied to AI evidence.",
      projectId: "11111111-1111-4111-8111-111111111111",
    });

    expect(first.approvalRequestId).toBe("22222222-2222-4222-8222-222222222222");
    expect(first.arguments).not.toHaveProperty("approvalRequestId");
    expect(first.hash).toBe(second.hash);
    expect(first.summary).toEqual({
      amountMinor: { type: "number" },
      description: { redacted: true, length: 57 },
      projectId: { type: "string", length: 36 },
    });
  });

  it("rejects files, credentials, and private payload containers from MCP arguments", () => {
    for (const unsafe of [
      { fileContent: "bytes" },
      { nested: { attachmentBytes: "base64" } },
      { credentials: { username: "a" } },
      { rawPayload: { anything: true } },
    ]) {
      expect(() => prepareMcpInput(unsafe)).toThrow(/private payload field/i);
    }
  });

  it("requires shared approval only for sensitive mutations", () => {
    expect(getAiOperationMode("agencyos.projects.get_workspace", { readOnlyHint: true })).toBe(
      "read",
    );
    expect(getAiOperationMode("agencyos.projects.create_task", {})).toBe("mutation");
    expect(getAiOperationMode("agencyos.projects.close_project", {})).toBe("sensitive_mutation");
    expect(toolRequiresAiApproval("agencyos.crm.delete_lead", { destructiveHint: true })).toBe(
      true,
    );
    expect(toolRequiresAiApproval("agencyos.projects.create_task", {})).toBe(false);
  });
});
