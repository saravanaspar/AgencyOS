import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { validateSafeJsonObject } from "@/lib/security/safe-json-object";
import { submitApprovalForRecordAtomically } from "@/modules/approvals/server/approvals";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const AI_SENSITIVE_APPROVAL_POLICY_KEY = "ai_sensitive_operation";
export const AI_APPROVAL_ARGUMENT_NAME = "approvalRequestId";

const PROHIBITED_PAYLOAD_KEY =
  /^(?:fileContent|documentContent|attachmentContent|attachmentBytes|rawPayload|privatePayload|binary|base64|credential|credentials)$/i;
const NARRATIVE_KEY =
  /(?:description|comment|notes?|reason|body|details|summary|snapshot|qualification|address|message)/i;

const SENSITIVE_MUTATION_TOOL_NAMES = new Set([
  "agencyos.organization.update_profile",
  "agencyos.users.grant_access",
  "agencyos.users.change_role",
  "agencyos.users.change_status",
  "agencyos.roles.create",
  "agencyos.roles.update",
  "agencyos.roles.change_status",
  "agencyos.roles.delete",
  "agencyos.roles.set_permissions",
  "agencyos.permissions.set_member_override",
  "agencyos.permissions.delete_member_override",
  "agencyos.structure.change_department_status",
  "agencyos.structure.delete_department",
  "agencyos.structure.change_team_status",
  "agencyos.structure.delete_team",
  "agencyos.structure.update_member_reporting",
  "agencyos.structure.assign_team_member",
  "agencyos.structure.remove_team_member",
  "agencyos.crm.convert_lead",
  "agencyos.crm.delete_lead",
  "agencyos.crm.delete_connection",
  "agencyos.approvals.decide_step",
  "agencyos.approvals.reassign_step",
  "agencyos.approvals.cancel_request",
  "agencyos.projects.request_closure",
  "agencyos.projects.close_project",
  "agencyos.projects.set_archive_state",
  "agencyos.finance.set_approval",
  "agencyos.finance.issue_invoice",
  "agencyos.finance.void_invoice",
  "agencyos.finance.issue_credit_note",
  "agencyos.finance.void_credit_note",
  "agencyos.finance.record_payment",
  "agencyos.finance.update_invoice_status",
  "agencyos.finance.set_payment_reconciliation",
  "agencyos.finance.record_payment_refund",
]);

export type AiOperationMode = "read" | "mutation" | "sensitive_mutation";
export type AiExecutionStatus = "started" | "approval_required" | "succeeded" | "failed";

export interface McpGovernanceAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface PreparedMcpInput {
  arguments: Record<string, unknown>;
  approvalRequestId: string | null;
  hash: string;
  summary: Record<string, unknown>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function assertNoPrivatePayload(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivatePayload(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PROHIBITED_PAYLOAD_KEY.test(key)) {
      throw new Error(`MCP arguments must not include private payload field “${key}”.`);
    }
    assertNoPrivatePayload(entry, `${path}.${key}`);
  }
}

function summarizeValue(key: string, value: unknown): unknown {
  if (NARRATIVE_KEY.test(key)) {
    if (typeof value === "string") return { redacted: true, length: value.length };
    if (Array.isArray(value)) return { redacted: true, count: value.length };
    if (value && typeof value === "object") {
      return {
        redacted: true,
        keys: Object.keys(value as Record<string, unknown>)
          .sort()
          .slice(0, 40),
      };
    }
  }
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") {
    return { type: typeof value };
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === "object") {
    return {
      keys: Object.keys(value as Record<string, unknown>)
        .sort()
        .slice(0, 40),
    };
  }
  return String(value);
}

function summarizeObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 80)
      .map(([key, entry]) => [key, summarizeValue(key, entry)]),
  );
}

export function prepareMcpInput(input: Record<string, unknown>): PreparedMcpInput {
  const approvalValue = input[AI_APPROVAL_ARGUMENT_NAME];
  const approvalPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    approvalValue !== undefined &&
    approvalValue !== null &&
    (typeof approvalValue !== "string" || !approvalPattern.test(approvalValue))
  ) {
    throw new Error("approvalRequestId must be a valid UUID when supplied.");
  }
  const approvalRequestId = typeof approvalValue === "string" ? approvalValue : null;
  const argumentsWithoutApproval = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== AI_APPROVAL_ARGUMENT_NAME),
  );
  assertNoPrivatePayload(argumentsWithoutApproval);
  const serialized = validateSafeJsonObject(argumentsWithoutApproval, {
    label: "MCP tool arguments",
    maximumBytes: 64 * 1024,
    maximumDepth: 16,
    maximumNodes: 4_000,
  });
  return {
    arguments: argumentsWithoutApproval,
    approvalRequestId,
    hash: createHash("sha256").update(serialized).digest("hex"),
    summary: summarizeObject(argumentsWithoutApproval),
  };
}

export function ensureBoundedMcpOutput(output: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(stableValue(output));
  if (Buffer.byteLength(serialized, "utf8") > 512 * 1024) {
    throw new Error("MCP tool output exceeds the bounded model-response limit.");
  }
  if (Array.isArray(output)) return { type: "array", count: output.length };
  if (output && typeof output === "object") {
    return {
      type: "object",
      keys: Object.keys(output as Record<string, unknown>)
        .sort()
        .slice(0, 80),
    };
  }
  return { type: output === null ? "null" : typeof output };
}

export function getAiOperationMode(
  toolName: string,
  annotations: McpGovernanceAnnotations | undefined,
): AiOperationMode {
  if (annotations?.readOnlyHint) return "read";
  if (annotations?.destructiveHint || SENSITIVE_MUTATION_TOOL_NAMES.has(toolName)) {
    return "sensitive_mutation";
  }
  return "mutation";
}

export function toolRequiresAiApproval(
  toolName: string,
  annotations: McpGovernanceAnnotations | undefined,
): boolean {
  return getAiOperationMode(toolName, annotations) === "sensitive_mutation";
}

export async function requestSensitiveMcpApproval(
  context: CurrentPermissionContext,
  toolName: string,
  prepared: PreparedMcpInput,
): Promise<{ intentId: string; approvalRequestId: string }> {
  const intentId = randomUUID();
  const submitted = await submitApprovalForRecordAtomically(
    context,
    {
      definitionKey: AI_SENSITIVE_APPROVAL_POLICY_KEY,
      title: `Approve AI operation: ${toolName}`,
      sourceModule: "automation",
      entityType: "ai_tool_call",
      entityId: intentId,
      deepLink: `/automation?aiIntent=${intentId}`,
      departmentId: null,
      amount: null,
      currency: null,
      snapshot: {
        toolName,
        argumentsHash: prepared.hash,
        argumentKeys: Object.keys(prepared.arguments).sort(),
        risk: "sensitive_mutation",
      },
      dueAt: null,
    },
    async (sql, requestId) => {
      await sql`
        insert into public.automation_ai_mutation_intents (
          id, organization_id, requester_membership_id, tool_name,
          arguments_hash, argument_summary, approval_request_id, status
        ) values (
          ${intentId}::uuid,
          ${context.membership.organizationId}::uuid,
          ${context.membership.id}::uuid,
          ${toolName},
          ${prepared.hash},
          ${sql.json(toJsonValue(prepared.summary))},
          ${requestId}::uuid,
          'pending_approval'
        )
      `;
    },
  );
  return { intentId, approvalRequestId: submitted.requestId };
}

export async function beginApprovedMcpMutation(
  context: CurrentPermissionContext,
  toolName: string,
  prepared: PreparedMcpInput,
): Promise<string> {
  if (!prepared.approvalRequestId) throw new Error("An approved request is required.");
  const database = getDatabaseClient();
  const rows = await database<{ id: string }[]>`
    update public.automation_ai_mutation_intents as intent
    set status = 'executing', execution_started_at = now(), failure_code = null, updated_at = now()
    from public.approval_requests as request
    where intent.approval_request_id = ${prepared.approvalRequestId}::uuid
      and request.id = intent.approval_request_id
      and request.organization_id = ${context.membership.organizationId}::uuid
      and request.requester_membership_id = ${context.membership.id}::uuid
      and request.source_module = 'automation'
      and request.entity_type = 'ai_tool_call'
      and request.entity_id = intent.id::text
      and request.status = 'approved'
      and intent.tool_name = ${toolName}
      and intent.arguments_hash = ${prepared.hash}
      and intent.status in ('pending_approval', 'failed')
    returning intent.id
  `;
  const intent = rows[0];
  if (!intent) {
    throw new Error(
      "The AI mutation approval is missing, not approved, already used, or does not match these arguments.",
    );
  }
  return intent.id;
}

export async function completeApprovedMcpMutation(
  intentId: string,
  success: boolean,
  errorCode: string | null,
): Promise<void> {
  const database = getDatabaseClient();
  await database`
    update public.automation_ai_mutation_intents
    set status = ${success ? "executed" : "failed"},
        executed_at = ${success ? new Date().toISOString() : null}::timestamptz,
        failure_code = ${success ? null : errorCode},
        updated_at = now()
    where id = ${intentId}::uuid
      and status = 'executing'
  `;
}

export async function recordAiExecutionEvent(input: {
  context: CurrentPermissionContext;
  intentId: string | null;
  toolName: string;
  mode: AiOperationMode;
  status: AiExecutionStatus;
  inputHash: string;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  errorCode: string | null;
  startedAt: Date;
}): Promise<void> {
  const database = getDatabaseClient();
  const completedAt = new Date();
  await database`
    insert into public.automation_ai_execution_events (
      organization_id, actor_membership_id, mutation_intent_id,
      tool_name, operation_mode, status, input_hash,
      input_summary, output_summary, error_code, started_at, completed_at
    ) values (
      ${input.context.membership.organizationId}::uuid,
      ${input.context.membership.id}::uuid,
      ${input.intentId}::uuid,
      ${input.toolName},
      ${input.mode},
      ${input.status},
      ${input.inputHash},
      ${database.json(toJsonValue(input.inputSummary))},
      ${database.json(toJsonValue(input.outputSummary))},
      ${input.errorCode},
      ${input.startedAt.toISOString()}::timestamptz,
      ${completedAt.toISOString()}::timestamptz
    )
  `;
}
