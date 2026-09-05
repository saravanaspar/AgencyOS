import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { validateSafeJsonObject } from "@/lib/security/safe-json-object";
import type {
  AutomationAiExecutionSummary,
  AutomationAiIntentSummary,
  AutomationExecutionSummary,
  AutomationDefinitionSummary,
  AutomationDispatchSummary,
  AutomationEntityOption,
  AutomationWorkspaceData,
  VaultwardenEntityType,
  VaultwardenLinkSummary,
} from "@/modules/automation/automation";
import {
  automationHandlers,
  vaultwardenVisibilityPermissions,
} from "@/modules/automation/automation";
import type {
  CreateAutomationDefinitionInput,
  CreateVaultwardenLinkInput,
} from "@/modules/automation/schemas/automation";
import {
  buildVaultwardenItemUrl,
  getAutomationIntegrationConfiguration,
} from "@/modules/automation/server/integration-config";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const automationPermissionKeys = {
  workspace: "automation.workspace.view",
  viewDefinitions: "automation.definition.view",
  manageDefinitions: "automation.definition.manage_settings",
  viewExecutions: "automation.execution.view",
  retryExecutions: "automation.execution.retry",
  viewAiExecutions: "automation.ai_execution.view",
  viewVaultwardenLinks: "automation.vault_link.view",
  manageVaultwardenLinks: "automation.vault_link.manage_settings",
} as const;

interface DefinitionRow {
  id: string;
  name: string;
  trigger_key: string;
  handler_key: string;
  enabled: boolean;
  allowed_modules: string[];
  owner_name: string;
  last_execution_at: Date | null;
  last_result: AutomationDefinitionSummary["lastResult"];
  error_count: number;
  created_at: Date;
}

interface ExecutionRow {
  id: string;
  automation_id: string;
  automation_name: string;
  execution_id: string;
  handler_key: string;
  source_module: string;
  status: AutomationExecutionSummary["status"];
  result_summary: string | null;
  occurred_at: Date;
  completed_at: Date;
}

interface DispatchRow {
  id: string;
  event_key: string;
  source_module: string;
  entity_type: string;
  entity_id: string;
  automation_name: string;
  handler_key: string;
  status: AutomationDispatchSummary["status"];
  attempt_count: number;
  max_attempts: number;
  available_at: Date;
  delivered_at: Date | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date;
}

interface AiIntentRow {
  id: string;
  requester_name: string;
  tool_name: string;
  status: AutomationAiIntentSummary["status"];
  approval_request_id: string | null;
  approval_status: string | null;
  created_at: Date;
  executed_at: Date | null;
  failure_code: string | null;
}

interface AiExecutionRow {
  id: string;
  actor_name: string;
  tool_name: string;
  operation_mode: AutomationAiExecutionSummary["operationMode"];
  status: AutomationAiExecutionSummary["status"];
  error_code: string | null;
  started_at: Date;
  completed_at: Date;
}

interface VaultLinkRow {
  id: string;
  entity_type: VaultwardenEntityType;
  entity_id: string;
  entity_label: string;
  item_reference: string;
  visibility_permission_key: string;
  created_at: Date;
}

interface EntityOptionRow {
  entity_type: "project" | "client";
  id: string;
  label: string;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function requirePermission(context: CurrentPermissionContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new Error("Automation access denied.");
}

function mapDefinition(row: DefinitionRow): AutomationDefinitionSummary {
  return {
    id: row.id,
    name: row.name,
    triggerKey: row.trigger_key,
    handlerKey: row.handler_key,
    enabled: row.enabled,
    allowedModules: row.allowed_modules,
    ownerName: row.owner_name,
    lastExecutionAt: iso(row.last_execution_at),
    lastResult: row.last_result,
    errorCount: row.error_count,
    createdAt: row.created_at.toISOString(),
  };
}

function mapExecution(row: ExecutionRow): AutomationExecutionSummary {
  return {
    id: row.id,
    automationId: row.automation_id,
    automationName: row.automation_name,
    executionId: row.execution_id,
    handlerKey: row.handler_key,
    sourceModule: row.source_module,
    status: row.status,
    resultSummary: row.result_summary,
    occurredAt: row.occurred_at.toISOString(),
    completedAt: row.completed_at.toISOString(),
  };
}

function mapDispatch(row: DispatchRow): AutomationDispatchSummary {
  return {
    id: row.id,
    eventKey: row.event_key,
    sourceModule: row.source_module,
    entityType: row.entity_type,
    entityId: row.entity_id,
    automationName: row.automation_name,
    handlerKey: row.handler_key,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at.toISOString(),
    deliveredAt: iso(row.delivered_at),
    lastErrorCode: row.last_error_code,
    lastErrorSummary: row.last_error_summary,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAiIntent(row: AiIntentRow): AutomationAiIntentSummary {
  return {
    id: row.id,
    requesterName: row.requester_name,
    toolName: row.tool_name,
    status: row.status,
    approvalRequestId: row.approval_request_id,
    approvalStatus: row.approval_status,
    createdAt: row.created_at.toISOString(),
    executedAt: iso(row.executed_at),
    failureCode: row.failure_code,
  };
}

function mapAiExecution(row: AiExecutionRow): AutomationAiExecutionSummary {
  return {
    id: row.id,
    actorName: row.actor_name,
    toolName: row.tool_name,
    operationMode: row.operation_mode,
    status: row.status,
    errorCode: row.error_code,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at.toISOString(),
  };
}

function mapVaultLink(
  row: VaultLinkRow,
  vaultwardenBaseUrl: string | null,
): VaultwardenLinkSummary {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    itemReference: row.item_reference,
    visibilityPermissionKey: row.visibility_permission_key,
    openUrl: buildVaultwardenItemUrl(row.item_reference, vaultwardenBaseUrl),
    createdAt: row.created_at.toISOString(),
  };
}

export async function getAutomationWorkspaceData(
  context: CurrentPermissionContext,
): Promise<AutomationWorkspaceData> {
  requirePermission(context, automationPermissionKeys.workspace);
  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const canViewDefinitions = context.permissions.has(automationPermissionKeys.viewDefinitions);
  const canViewExecutions = context.permissions.has(automationPermissionKeys.viewExecutions);
  const canViewAllAiExecutions = context.permissions.has(automationPermissionKeys.viewAiExecutions);
  const canViewAiExecutions = true;
  const canViewVaultLinks = context.permissions.has(automationPermissionKeys.viewVaultwardenLinks);
  const canManageVaultwardenLinks = context.permissions.has(
    automationPermissionKeys.manageVaultwardenLinks,
  );
  const projectScope = context.permissionScopes.get(vaultwardenVisibilityPermissions.project);
  const clientScope = context.permissionScopes.get(vaultwardenVisibilityPermissions.client);
  const canViewVendors = context.permissions.has(vaultwardenVisibilityPermissions.vendor);

  const [
    definitions,
    executions,
    dispatches,
    aiIntents,
    aiExecutions,
    approvalPolicies,
    vaultLinks,
    entityOptions,
  ] = await Promise.all([
    canViewDefinitions
      ? database<DefinitionRow[]>`
            select
              definition.id, definition.name, definition.trigger_key, definition.handler_key,
              definition.enabled, definition.allowed_modules,
              coalesce(nullif(profile.display_name, ''), account.email) as owner_name,
              definition.last_execution_at, definition.last_result, definition.error_count,
              definition.created_at
            from public.automation_definitions as definition
            join public.memberships as membership on membership.id = definition.owner_membership_id
            join public.identity_accounts as account on account.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            where definition.organization_id = ${organizationId}::uuid
            order by definition.enabled desc, definition.updated_at desc
            limit 100
          `
      : Promise.resolve([] as DefinitionRow[]),
    canViewExecutions
      ? database<ExecutionRow[]>`
            select
              event.id, event.automation_id, definition.name as automation_name,
              event.execution_id, event.handler_key, event.source_module, event.status,
              event.result_summary, event.occurred_at, event.completed_at
            from public.automation_execution_events as event
            join public.automation_definitions as definition on definition.id = event.automation_id
            where event.organization_id = ${organizationId}::uuid
            order by event.completed_at desc
            limit 100
          `
      : Promise.resolve([] as ExecutionRow[]),
    canViewExecutions
      ? database<DispatchRow[]>`
            select
              dispatch.id, event.event_key, event.source_module, event.entity_type,
              event.entity_id, definition.name as automation_name,
              definition.handler_key, dispatch.status,
              dispatch.attempt_count, dispatch.max_attempts, dispatch.available_at,
              dispatch.delivered_at, dispatch.last_error_code,
              dispatch.last_error_summary, dispatch.created_at
            from public.automation_dispatches as dispatch
            join public.automation_domain_events as event on event.id = dispatch.event_id
            join public.automation_definitions as definition on definition.id = dispatch.automation_id
            where dispatch.organization_id = ${organizationId}::uuid
            order by dispatch.created_at desc
            limit 120
          `
      : Promise.resolve([] as DispatchRow[]),
    canViewAiExecutions
      ? database<AiIntentRow[]>`
            select
              intent.id,
              coalesce(nullif(profile.display_name, ''), account.email) as requester_name,
              intent.tool_name, intent.status, intent.approval_request_id,
              request.status as approval_status, intent.created_at, intent.executed_at,
              intent.failure_code
            from public.automation_ai_mutation_intents as intent
            join public.memberships as membership on membership.id = intent.requester_membership_id
            join public.identity_accounts as account on account.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            left join public.approval_requests as request on request.id = intent.approval_request_id
            where intent.organization_id = ${organizationId}::uuid
              and (
                ${canViewAllAiExecutions}::boolean
                or intent.requester_membership_id = ${context.membership.id}::uuid
              )
            order by intent.created_at desc
            limit 100
          `
      : Promise.resolve([] as AiIntentRow[]),
    canViewAiExecutions
      ? database<AiExecutionRow[]>`
            select
              event.id,
              coalesce(nullif(profile.display_name, ''), account.email) as actor_name,
              event.tool_name, event.operation_mode, event.status, event.error_code,
              event.started_at, event.completed_at
            from public.automation_ai_execution_events as event
            join public.memberships as membership on membership.id = event.actor_membership_id
            join public.identity_accounts as account on account.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            where event.organization_id = ${organizationId}::uuid
              and (
                ${canViewAllAiExecutions}::boolean
                or event.actor_membership_id = ${context.membership.id}::uuid
              )
            order by event.created_at desc
            limit 120
          `
      : Promise.resolve([] as AiExecutionRow[]),
    database<{ id: string }[]>`
            select id
            from public.approval_definitions
            where organization_id = ${organizationId}::uuid
              and key = 'ai_sensitive_operation'
              and source_module = 'automation'
              and entity_type = 'ai_tool_call'
              and status = 'active'
            limit 1
          `,
    canViewVaultLinks
      ? database<VaultLinkRow[]>`
            select
              link.id, link.entity_type, link.entity_id, link.entity_label, link.item_reference,
              link.visibility_permission_key, link.created_at
            from public.vaultwarden_item_links as link
            where link.organization_id = ${organizationId}::uuid
              and link.revoked_at is null
              and (
                (
                  link.entity_type = 'project'
                  and ${Boolean(projectScope)}
                  and private.project_is_visible(
                    link.entity_id,
                    ${context.membership.id}::uuid,
                    ${projectScope ?? "own"}
                  )
                )
                or (
                  link.entity_type = 'client'
                  and ${Boolean(clientScope)}
                  and exists (
                    select 1
                    from public.crm_companies as company
                    where company.id = link.entity_id
                      and company.organization_id = link.organization_id
                      and private.crm_scope_allows_membership(
                        ${context.membership.id}::uuid,
                        ${clientScope ?? "own"},
                        company.account_owner_membership_id,
                        company.created_by_membership_id
                      )
                  )
                )
                or (link.entity_type = 'vendor' and ${canViewVendors})
              )
            order by link.created_at desc
            limit 100
          `
      : Promise.resolve([] as VaultLinkRow[]),
    canManageVaultwardenLinks
      ? database<EntityOptionRow[]>`
            select
              'project'::text as entity_type,
              project.id,
              project.code || ' — ' || project.name as label
            from public.projects as project
            where project.organization_id = ${organizationId}::uuid
              and project.archived_at is null
              and ${Boolean(projectScope)}
              and private.project_is_visible(
                project.id,
                ${context.membership.id}::uuid,
                ${projectScope ?? "own"}
              )
            union all
            select
              'client'::text,
              company.id,
              coalesce(nullif(company.display_name, ''), company.legal_name) as label
            from public.crm_companies as company
            where company.organization_id = ${organizationId}::uuid
              and ${Boolean(clientScope)}
              and private.crm_scope_allows_membership(
                ${context.membership.id}::uuid,
                ${clientScope ?? "own"},
                company.account_owner_membership_id,
                company.created_by_membership_id
              )
            order by entity_type, label
            limit 500
          `
      : Promise.resolve([] as EntityOptionRow[]),
  ]);
  const configuration = await getAutomationIntegrationConfiguration(organizationId);

  return {
    workerConfigured: configuration.workerConfigured,
    vaultwardenConfigured: Boolean(configuration.vaultwardenBaseUrl),
    aiApprovalPolicyConfigured: approvalPolicies.length > 0,
    handlers: automationHandlers,
    definitions: definitions.map(mapDefinition),
    executions: executions.map(mapExecution),
    dispatches: dispatches.map(mapDispatch),
    aiIntents: aiIntents.map(mapAiIntent),
    aiExecutions: aiExecutions.map(mapAiExecution),
    vaultwardenLinks: vaultLinks.map((row) => mapVaultLink(row, configuration.vaultwardenBaseUrl)),
    entityOptions: entityOptions.map((option) => ({
      entityType: option.entity_type,
      id: option.id,
      label: option.label,
    })) as AutomationEntityOption[],
    capabilities: {
      canManageDefinitions: context.permissions.has(automationPermissionKeys.manageDefinitions),
      canViewExecutions,
      canRetryDispatches: context.permissions.has(automationPermissionKeys.retryExecutions),
      canViewAiExecutions,
      canManageVaultwardenLinks,
    },
  };
}

export async function createAutomationDefinition(
  context: CurrentPermissionContext,
  input: CreateAutomationDefinitionInput,
): Promise<string> {
  requirePermission(context, automationPermissionKeys.manageDefinitions);
  validateSafeJsonObject(input.conditions, {
    label: "Automation conditions",
    maximumBytes: 16 * 1024,
    maximumDepth: 12,
    maximumNodes: 1_000,
  });
  const database = getDatabaseClient();
  const [row] = await database.begin(async (transaction) => {
    const inserted = await transaction<{ id: string }[]>`
      insert into public.automation_definitions (
        organization_id, name, trigger_key, conditions, handler_key,
        allowed_modules, owner_membership_id, created_by_membership_id, updated_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid,
        ${input.name},
        ${input.triggerKey},
        ${transaction.json(toJsonValue(input.conditions))},
        ${input.handlerKey},
        ${input.allowedModules},
        ${context.membership.id}::uuid,
        ${context.membership.id}::uuid,
        ${context.membership.id}::uuid
      )
      returning id
    `;
    const created = inserted[0];
    if (!created) throw new Error("Automation definition was not created.");
    await writeAuditEvent(transaction, context, {
      action: "automation.definition.created",
      entityType: "automation_definition",
      entityId: created.id,
      afterState: {
        name: input.name,
        triggerKey: input.triggerKey,
        handlerKey: input.handlerKey,
        allowedModules: input.allowedModules,
        enabled: true,
      },
    });
    return inserted;
  });
  if (!row) throw new Error("Automation definition was not created.");
  return row.id;
}

export async function setAutomationEnabled(
  context: CurrentPermissionContext,
  automationId: string,
  enabled: boolean,
): Promise<void> {
  requirePermission(context, automationPermissionKeys.manageDefinitions);
  const database = getDatabaseClient();
  await database.begin(async (transaction) => {
    const rows = await transaction<{ name: string }[]>`
      update public.automation_definitions
      set enabled = ${enabled}, updated_by_membership_id = ${context.membership.id}::uuid,
          updated_at = now()
      where id = ${automationId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      returning name
    `;
    const row = rows[0];
    if (!row) throw new Error("Automation definition was not found.");
    await writeAuditEvent(transaction, context, {
      action: enabled ? "automation.definition.enabled" : "automation.definition.disabled",
      entityType: "automation_definition",
      entityId: automationId,
      beforeState: { enabled: !enabled },
      afterState: { enabled },
      changedFields: ["enabled"],
    });
  });
}

async function resolveEntityLabel(
  context: CurrentPermissionContext,
  input: CreateVaultwardenLinkInput,
): Promise<string> {
  const permission = vaultwardenVisibilityPermissions[input.entityType];
  requirePermission(context, permission);
  if (input.entityType === "vendor") return input.entityLabel;
  const scope = context.permissionScopes.get(permission);
  if (!scope) throw new Error("Vaultwarden link target access was denied.");
  const database = getDatabaseClient();
  if (input.entityType === "project") {
    const rows = await database<{ label: string }[]>`
      select code || ' — ' || name as label
      from public.projects
      where id = ${input.entityId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and private.project_is_visible(
          id,
          ${context.membership.id}::uuid,
          ${scope}
        )
      limit 1
    `;
    if (!rows[0]) throw new Error("Project was not found.");
    return rows[0].label;
  }
  const rows = await database<{ label: string }[]>`
    select coalesce(nullif(display_name, ''), legal_name) as label
    from public.crm_companies
    where id = ${input.entityId}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid,
        ${scope},
        owner_membership_id,
        created_by_membership_id
      )
    limit 1
  `;
  if (!rows[0]) throw new Error("Client was not found.");
  return rows[0].label;
}

export async function createVaultwardenLink(
  context: CurrentPermissionContext,
  input: CreateVaultwardenLinkInput,
): Promise<void> {
  requirePermission(context, automationPermissionKeys.manageVaultwardenLinks);
  const label = await resolveEntityLabel(context, input);
  const permission = vaultwardenVisibilityPermissions[input.entityType];
  const database = getDatabaseClient();
  await database.begin(async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      insert into public.vaultwarden_item_links (
        organization_id, entity_type, entity_id, entity_label, item_reference,
        visibility_permission_key, created_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid,
        ${input.entityType},
        ${input.entityId}::uuid,
        ${label},
        ${input.itemReference}::uuid,
        ${permission},
        ${context.membership.id}::uuid
      )
      returning id
    `;
    const row = rows[0];
    if (!row) throw new Error("Vaultwarden item link was not created.");
    await writeAuditEvent(transaction, context, {
      action: "automation.vault_link.created",
      entityType: "vaultwarden_item_link",
      entityId: row.id,
      afterState: {
        entityType: input.entityType,
        entityId: input.entityId,
        itemReference: input.itemReference,
        visibilityPermissionKey: permission,
      },
    });
  });
}

export async function revokeVaultwardenLink(
  context: CurrentPermissionContext,
  linkId: string,
): Promise<void> {
  requirePermission(context, automationPermissionKeys.manageVaultwardenLinks);
  const database = getDatabaseClient();
  const projectScope = context.permissionScopes.get(vaultwardenVisibilityPermissions.project);
  const clientScope = context.permissionScopes.get(vaultwardenVisibilityPermissions.client);
  const canViewVendors = context.permissions.has(vaultwardenVisibilityPermissions.vendor);
  await database.begin(async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      update public.vaultwarden_item_links as link
      set revoked_at = now(), revoked_by_membership_id = ${context.membership.id}::uuid
      where link.id = ${linkId}::uuid
        and link.organization_id = ${context.membership.organizationId}::uuid
        and link.revoked_at is null
        and (
          (
            link.entity_type = 'project'
            and ${Boolean(projectScope)}
            and private.project_is_visible(
              link.entity_id,
              ${context.membership.id}::uuid,
              ${projectScope ?? "own"}
            )
          )
          or (
            link.entity_type = 'client'
            and ${Boolean(clientScope)}
            and exists (
              select 1
              from public.crm_companies as company
              where company.id = link.entity_id
                and company.organization_id = link.organization_id
                and private.crm_scope_allows_membership(
                  ${context.membership.id}::uuid,
                  ${clientScope ?? "own"},
                  company.account_owner_membership_id,
                  company.created_by_membership_id
                )
            )
          )
          or (link.entity_type = 'vendor' and ${canViewVendors})
        )
      returning link.id
    `;
    if (!rows[0]) throw new Error("Vaultwarden item link was not found.");
    await writeAuditEvent(transaction, context, {
      action: "automation.vault_link.revoked",
      entityType: "vaultwarden_item_link",
      entityId: linkId,
      changedFields: ["revokedAt"],
    });
  });
}

export async function retryAutomationDispatch(
  context: CurrentPermissionContext,
  dispatchId: string,
): Promise<void> {
  requirePermission(context, automationPermissionKeys.retryExecutions);
  const database = getDatabaseClient();
  await database.begin(async (transaction) => {
    const rows = await transaction<
      {
        id: string;
        event_key: string;
        automation_id: string;
        attempt_count: number;
        max_attempts: number;
      }[]
    >`
      update public.automation_dispatches as dispatch
      set status = 'retry',
          max_attempts = least(greatest(dispatch.max_attempts, dispatch.attempt_count) + 8, 100),
          available_at = now(), locked_at = null, lock_token = null, delivered_at = null,
          last_error_code = null, last_error_summary = null,
          updated_at = now()
      from public.automation_domain_events as event
      where dispatch.id = ${dispatchId}::uuid
        and dispatch.organization_id = ${context.membership.organizationId}::uuid
        and dispatch.status = 'dead_letter'
        and dispatch.attempt_count < 100
        and event.id = dispatch.event_id
      returning dispatch.id, event.event_key, dispatch.automation_id,
        dispatch.attempt_count, dispatch.max_attempts
    `;
    const row = rows[0];
    if (!row) throw new Error("Dead-letter automation dispatch was not found.");
    await writeAuditEvent(transaction, context, {
      action: "automation.dispatch.requeued",
      entityType: "automation_dispatch",
      entityId: row.id,
      beforeState: { status: "dead_letter" },
      afterState: {
        status: "retry",
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      },
      changedFields: ["status", "maxAttempts", "availableAt"],
      metadata: { eventKey: row.event_key, automationId: row.automation_id },
    });
  });
}
