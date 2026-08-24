import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("internal automation and permission-aware AI contracts", () => {
  it("keeps the transactional event, dispatch, retry, and AI evidence model", () => {
    const migration = source(
      "database/migrations/20260718004900_automation_permission_aware_ai.sql",
    );
    for (const table of [
      "automation_domain_events",
      "automation_dispatches",
      "automation_dispatch_attempts",
      "automation_ai_mutation_intents",
      "automation_ai_execution_events",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("private.validate_automation_dispatch_tenant");
    expect(migration).toContain("private.prevent_automation_append_only_mutation");
  });

  it("migrates external workflow records to the internal handler model without enabling them", () => {
    const migration = source(
      "database/migrations/20260721005400_internal_workers_and_automation.sql",
    );
    expect(migration).toContain("set enabled = false");
    expect(migration).toContain("rename column n8n_workflow_id to handler_key");
    expect(migration).toContain("rename to automation_execution_events");
    expect(migration).toContain("drop column secret_reference");
    expect(migration).toContain(
      "create or replace function private.validate_automation_execution_tenant()",
    );
    expect(migration).toContain("definition.handler_key = new.handler_key");
    expect(migration).not.toContain("definition.n8n_workflow_id = new.workflow_id");
  });

  it("routes only enabled definitions and executes fixed internal handlers", () => {
    const worker = source("src/modules/automation/server/event-dispatch-worker.ts");
    const registry = source("src/modules/automation/server/handler-registry.ts");
    expect(worker).toContain("definition.enabled");
    expect(worker).toContain("event.source_module = any(definition.allowed_modules)");
    expect(worker).toContain("payloadEquals");
    expect(worker).toContain("executeAutomationHandler");
    expect(worker).toContain("automationRetryDelaySeconds");
    expect(worker).toContain('"dead_letter"');
    expect(worker).toContain("for update of dispatch skip locked");
    expect(worker).not.toContain("fetch(");
    expect(registry).toContain('"notification.owner"');
    expect(registry).toContain('"notification.event_actor"');
    expect(registry).toContain("isAutomationHandlerKey");
    expect(registry).not.toMatch(/eval\(|new Function|child_process/);
  });

  it("uses one authenticated worker endpoint and retains dead-letter recovery", () => {
    const route = source("src/app/api/internal/workers/run/route.ts");
    const runner = source("scripts/workers/run.mjs");
    const server = source("src/modules/automation/server/automation.ts");
    expect(route).toContain("INTERNAL_WORKER_SECRET");
    expect(route).toContain("getInternalWorkerDefinition");
    expect(route).toContain("runInternalWorkerRequest");
    expect(runner).toContain('key: "automation"');
    expect(server).toContain("automation.execution.retry");
    expect(server).toContain("retryAutomationDispatch");
    expect(server).toContain('action: "automation.dispatch.requeued"');
    expect(source("src/components/automation/automation-workspace.tsx")).toContain(
      "Retry dispatch",
    );
  });

  it("reauthorizes every MCP call, bounds model data, and gates sensitive mutations", () => {
    const registry = source("src/modules/mcp/tool-registry.ts");
    const governance = source("src/modules/mcp/ai-governance.ts");
    expect(registry).toContain("authorizeTool(tool)");
    expect(registry).toContain("prepareMcpInput");
    expect(registry).toContain("requestSensitiveMcpApproval");
    expect(registry).toContain("beginApprovedMcpMutation");
    expect(registry).toContain("ensureBoundedMcpOutput");
    expect(governance).toContain("AI_SENSITIVE_APPROVAL_POLICY_KEY");
    expect(governance).toContain("submitApprovalForRecordAtomically");
    expect(governance).toContain("validateSafeJsonObject");
    expect(governance).toContain("maximumBytes: 64 * 1024");
    expect(governance).toContain("512 * 1024");
  });

  it("keeps the single worker secret documented", () => {
    const env = source(".env.example");
    const operations = source("docs/OPERATIONS.md");
    expect(env).toContain("INTERNAL_WORKER_SECRET");
    expect(operations).toContain("INTERNAL_WORKER_SECRET");
    expect(operations).toContain("npm run worker");
    expect(operations).toContain("/api/internal/workers/run");
  });
});
