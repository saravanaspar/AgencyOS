import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { approvalSnapshotHash } from "@/modules/approvals/approval-snapshot";
import {
  safeApprovalDeepLink,
  type ApprovalDecisionMode,
  type ApprovalDefinitionStepInput,
  type ApprovalSelectorType,
  type ApprovalStatus,
  type ApprovalStepStatus,
  type ApprovalWorkspaceData,
} from "@/modules/approvals/approvals";
import type {
  ApprovalDecisionInput,
  ApprovalFilters,
  ApprovalRequestIntegrationInput,
  CreateApprovalDefinitionInput,
  CreateApprovalDelegationInput,
  CreateApprovalRequestInput,
  ReassignApprovalStepInput,
} from "@/modules/approvals/schemas/approvals";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const approvalPermissionKeys = {
  viewRequests: "approvals.request.view",
  createRequest: "approvals.request.create",
  approveRequest: "approvals.request.approve",
  rejectRequest: "approvals.request.reject",
  reassignRequest: "approvals.request.reassign",
  viewDefinitions: "approvals.definition.view",
  manageDefinitions: "approvals.definition.manage_settings",
  manageDelegations: "approvals.delegation.manage_settings",
} as const;

export const APPROVAL_PAGE_SIZE = 20;
const MAX_ROLE_APPROVERS = 50;

interface DefinitionRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  source_module: string;
  entity_type: string;
  version: number;
  status: "active" | "inactive";
  allow_self_approval: boolean;
  allow_reassignment: boolean;
  steps: ApprovalWorkspaceData["definitions"][number]["steps"];
}

interface RequestRow {
  id: string;
  title: string;
  source_module: string;
  entity_type: string;
  entity_id: string | null;
  deep_link: string | null;
  status: ApprovalStatus;
  current_stage: number | null;
  amount: string | number | null;
  currency: string | null;
  requester_membership_id: string;
  requester_display_name: string;
  submitted_at: Date;
  due_at: Date | null;
  completed_at: Date | null;
  definition_name: string;
  snapshot: Record<string, unknown>;
  pending_steps: Array<{
    id: string;
    stepName: string;
    stageOrder: number;
    status: ApprovalStepStatus;
    approverMembershipId: string;
    approverDisplayName: string;
    delegatedFromDisplayName: string | null;
    commentRequired: boolean;
    dueAt: string | null;
    reminderCount: number;
    escalatedAt: string | null;
    canAct: boolean;
    canReassign: boolean;
  }>;
  actions: Array<{
    id: string;
    action: string;
    actorDisplayName: string;
    comment: string | null;
    createdAt: string;
  }>;
}

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  department_id: string | null;
  manager_membership_id: string | null;
  can_approve: boolean;
}

interface RoleRow {
  key: string;
  name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface DelegationRow {
  id: string;
  from_membership_id: string;
  from_display_name: string;
  to_membership_id: string;
  to_display_name: string;
  source_module: string | null;
  starts_at: Date;
  ends_at: Date;
  status: "active" | "revoked" | "expired";
  reason: string | null;
  can_revoke: boolean;
}

interface CountRow {
  count: number;
}

interface SummaryRow {
  assigned_pending: number;
  submitted_pending: number;
  decided_this_month: number;
  overdue: number;
}

interface DefinitionMutationRow {
  id: string;
  key: string;
  name: string;
  source_module: string;
  entity_type: string;
  version: number;
  status: "active" | "inactive";
  allow_self_approval: boolean;
  allow_reassignment: boolean;
}

interface DefinitionStepMutationRow {
  id: string;
  name: string;
  stage_order: number;
  sort_order: number;
  selector_type: ApprovalSelectorType;
  selector_role_key: string | null;
  selector_membership_id: string | null;
  decision_mode: ApprovalDecisionMode;
  conditions: Record<string, unknown>;
  comment_required: boolean;
  reminder_after_hours: number | null;
  escalation_after_hours: number | null;
  expires_after_hours: number | null;
}

interface RequestMutationRow {
  id: string;
  title: string;
  source_module: string;
  entity_type: string;
  entity_id: string | null;
  status: ApprovalStatus;
  requester_membership_id: string;
  current_stage: number | null;
  deep_link: string | null;
}

interface StepDecisionRow {
  id: string;
  request_id: string;
  organization_id: string;
  definition_step_id: string;
  stage_order: number;
  decision_mode: ApprovalDecisionMode;
  status: ApprovalStepStatus;
  approver_membership_id: string;
  comment_required: boolean;
  request_status: ApprovalStatus;
  requester_membership_id: string;
  request_title: string;
  request_deep_link: string | null;
  definition_allow_reassignment: boolean;
  definition_allow_self_approval: boolean;
}

interface ResolvedApprover {
  membershipId: string;
  delegatedFromMembershipId: string | null;
}

interface CreatedStepNotification {
  id: string;
  approverMembershipId: string;
  stepName: string;
}

export type ApprovalWorkspaceResult =
  | { allowed: true; data: ApprovalWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeConditions(value: unknown): ApprovalDefinitionStepInput["conditions"] {
  const record = recordValue(value);
  const minimumAmount = optionalNumber(record.minimumAmount);
  const maximumAmount = optionalNumber(record.maximumAmount);
  const departmentId = typeof record.departmentId === "string" ? record.departmentId : undefined;
  return {
    ...(minimumAmount === undefined ? {} : { minimumAmount }),
    ...(maximumAmount === undefined ? {} : { maximumAmount }),
    ...(departmentId ? { departmentId } : {}),
  };
}

function stepApplies(
  conditions: ApprovalDefinitionStepInput["conditions"],
  input: { amount: number | null; departmentId: string | null },
): boolean {
  if (
    conditions.minimumAmount !== undefined &&
    (input.amount === null || input.amount < conditions.minimumAmount)
  ) {
    return false;
  }
  if (
    conditions.maximumAmount !== undefined &&
    (input.amount === null || input.amount > conditions.maximumAmount)
  ) {
    return false;
  }
  if (conditions.departmentId && conditions.departmentId !== input.departmentId) return false;
  return true;
}

function addHours(date: Date, hours: number | null): Date | null {
  return hours === null ? null : new Date(date.getTime() + hours * 60 * 60 * 1_000);
}

function earliestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() <= right.getTime() ? left : right;
}

async function resolveApprovers(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  definition: DefinitionMutationRow,
  step: DefinitionStepMutationRow,
  requesterMembershipId: string,
): Promise<ResolvedApprover[]> {
  let membershipIds: string[] = [];

  if (step.selector_type === "manager") {
    const rows = await sql<{ manager_membership_id: string | null }[]>`
      select manager_membership_id
      from public.memberships
      where id = ${requesterMembershipId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
      limit 1
    `;
    if (rows[0]?.manager_membership_id) membershipIds = [rows[0].manager_membership_id];
  } else if (step.selector_type === "membership" && step.selector_membership_id) {
    membershipIds = [step.selector_membership_id];
  } else if (step.selector_type === "role" && step.selector_role_key) {
    const rows = await sql<{ id: string }[]>`
      select distinct membership.id
      from public.memberships as membership
      join public.membership_roles as assignment
        on assignment.membership_id = membership.id
      join public.roles as role
        on role.id = assignment.role_id
       and role.organization_id = membership.organization_id
       and role.status = 'active'
      where membership.organization_id = ${context.membership.organizationId}::uuid
        and membership.status = 'active'
        and role.key = ${step.selector_role_key}
      order by membership.id
      limit ${MAX_ROLE_APPROVERS + 1}
    `;
    if (rows.length > MAX_ROLE_APPROVERS) {
      throw new Error(`Approval role ${step.selector_role_key} resolves to too many members.`);
    }
    membershipIds = rows.map((row) => row.id);
  }

  if (!definition.allow_self_approval) {
    membershipIds = membershipIds.filter((id) => id !== requesterMembershipId);
  }
  membershipIds = [...new Set(membershipIds)];

  if (membershipIds.length > 0) {
    const authorizedApprovers = await sql<{ id: string }[]>`
      select membership.id
      from public.memberships as membership
      where membership.id = any(${membershipIds}::uuid[])
        and membership.organization_id = ${context.membership.organizationId}::uuid
        and membership.status = 'active'
        and private.membership_has_permission(
          membership.id,
          'approvals.request.approve'
        )
      order by membership.id
    `;
    membershipIds = authorizedApprovers.map((membership) => membership.id);
  }

  if (membershipIds.length === 0) {
    throw new Error(
      `Approval step “${step.name}” has no eligible approver with approval permission.`,
    );
  }

  const delegations = await sql<
    {
      from_membership_id: string;
      to_membership_id: string;
      source_module: string | null;
    }[]
  >`
    select distinct on (delegation.from_membership_id)
      delegation.from_membership_id,
      delegation.to_membership_id,
      delegation.source_module
    from public.approval_delegations as delegation
    join public.memberships as delegate
      on delegate.id = delegation.to_membership_id
     and delegate.organization_id = delegation.organization_id
     and delegate.status = 'active'
     and private.membership_has_permission(delegate.id, 'approvals.request.approve')
    where delegation.organization_id = ${context.membership.organizationId}::uuid
      and delegation.from_membership_id = any(${membershipIds}::uuid[])
      and delegation.status = 'active'
      and delegation.starts_at <= now()
      and delegation.ends_at > now()
      and (delegation.source_module is null or delegation.source_module = ${definition.source_module})
    order by
      delegation.from_membership_id,
      (delegation.source_module is not null) desc,
      delegation.created_at desc
  `;
  const delegationBySource = new Map(
    delegations.map((delegation) => [delegation.from_membership_id, delegation.to_membership_id]),
  );

  const resolved = membershipIds.map((membershipId) => {
    const delegated = delegationBySource.get(membershipId);
    return {
      membershipId: delegated ?? membershipId,
      delegatedFromMembershipId: delegated ? membershipId : null,
    };
  });

  const unique = new Map<string, ResolvedApprover>();
  for (const item of resolved) {
    if (!definition.allow_self_approval && item.membershipId === requesterMembershipId) continue;
    unique.set(item.membershipId, item);
  }
  if (unique.size === 0) {
    throw new Error(`Approval step “${step.name}” delegates back to the requester.`);
  }
  return [...unique.values()];
}

async function notifyApprovalAssignment(input: {
  organizationId: string;
  requestId: string;
  title: string;
  deepLink: string | null;
  createdByMembershipId: string;
  steps: CreatedStepNotification[];
}) {
  await Promise.allSettled(
    input.steps.map((step) =>
      enqueueNotification({
        organizationId: input.organizationId,
        recipientMembershipId: step.approverMembershipId,
        category: "approval_requested",
        severity: "info",
        title: `Approval requested: ${input.title}`,
        message: `${step.stepName} is ready for your decision.`,
        deepLink: input.deepLink ?? `/approvals?view=inbox&q=${input.requestId}`,
        sourceModule: "approvals",
        sourceEntityType: "approval_request",
        sourceEntityId: input.requestId,
        dedupeKey: `approval:${input.requestId}:step:${step.id}:requested`,
        createdByMembershipId: input.createdByMembershipId,
      }),
    ),
  );
}

async function notifyApprovalDecision(input: {
  organizationId: string;
  requesterMembershipId: string;
  requestId: string;
  title: string;
  status: ApprovalStatus;
  deepLink: string | null;
  actorMembershipId: string;
}) {
  const label = input.status === "revision_requested" ? "revision requested" : input.status;
  await enqueueNotification({
    organizationId: input.organizationId,
    recipientMembershipId: input.requesterMembershipId,
    category: "approval_decision",
    severity: input.status === "approved" ? "info" : "warning",
    title: `Approval ${label}: ${input.title}`,
    message: `Your approval request is now ${label.replaceAll("_", " ")}.`,
    deepLink: input.deepLink ?? `/approvals?view=submitted&q=${input.requestId}`,
    sourceModule: "approvals",
    sourceEntityType: "approval_request",
    sourceEntityId: input.requestId,
    dedupeKey: `approval:${input.requestId}:decision:${input.status}`,
    createdByMembershipId: input.actorMembershipId,
  });
}

export async function getApprovalWorkspaceData(
  filters: ApprovalFilters,
): Promise<ApprovalWorkspaceResult> {
  const authorization = await authorizeCurrentUser([approvalPermissionKeys.viewRequests]);
  if (!authorization.allowed) return authorization;

  const { context } = authorization;
  const permissions = context.permissions;
  const canManageDefinitions = permissions.has(approvalPermissionKeys.manageDefinitions);
  const canManageDelegations = permissions.has(approvalPermissionKeys.manageDelegations);
  const canApprove = permissions.has(approvalPermissionKeys.approveRequest);
  const canReject = permissions.has(approvalPermissionKeys.rejectRequest);
  const canReassign = permissions.has(approvalPermissionKeys.reassignRequest);
  const requestViewScope =
    context.permissionScopes.get(approvalPermissionKeys.viewRequests) ?? "own";
  const canViewAll =
    canManageDefinitions ||
    requestViewScope === "organization" ||
    requestViewScope === "department" ||
    requestViewScope === "team" ||
    requestViewScope === "managed_employees";
  const effectiveView = filters.view === "all" && !canViewAll ? "inbox" : filters.view;
  const database = getDatabaseClient();
  const offset = (filters.page - 1) * APPROVAL_PAGE_SIZE;
  const searchPattern = `%${filters.q}%`;

  try {
    const [definitions, requests, counts, summaryRows, members, roles, departments, delegations] =
      await Promise.all([
        database<DefinitionRow[]>`
          select
            definition.id,
            definition.key,
            definition.name,
            definition.description,
            definition.source_module,
            definition.entity_type,
            definition.version,
            definition.status,
            definition.allow_self_approval,
            definition.allow_reassignment,
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', step.id,
                  'name', step.name,
                  'stageOrder', step.stage_order,
                  'sortOrder', step.sort_order,
                  'selectorType', step.selector_type,
                  'selectorRoleKey', step.selector_role_key,
                  'selectorMembershipId', step.selector_membership_id,
                  'selectorDisplayName', case
                    when step.selector_type = 'manager' then 'Requester manager'
                    when step.selector_type = 'role' then coalesce(role.name, step.selector_role_key)
                    else coalesce(
                      profile.display_name,
                      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                      auth_user.email,
                      'Named member'
                    )
                  end,
                  'decisionMode', step.decision_mode,
                  'conditions', step.conditions,
                  'commentRequired', step.comment_required,
                  'reminderAfterHours', step.reminder_after_hours,
                  'escalationAfterHours', step.escalation_after_hours,
                  'expiresAfterHours', step.expires_after_hours
                ) order by step.stage_order, step.sort_order, step.id
              )
              from public.approval_definition_steps as step
              left join public.roles as role
                on role.organization_id = step.organization_id
               and role.key = step.selector_role_key
              left join public.memberships as named_membership
                on named_membership.id = step.selector_membership_id
              left join public.identity_accounts as auth_user
                on auth_user.id = named_membership.user_id
              left join public.profiles as profile
                on profile.id = named_membership.user_id
              where step.definition_id = definition.id
            ), '[]'::jsonb) as steps
          from public.approval_definitions as definition
          where definition.organization_id = ${context.membership.organizationId}::uuid
            and (${canManageDefinitions}::boolean or definition.status = 'active')
          order by definition.status, definition.name, definition.version desc
        `,
        database<RequestRow[]>`
          select
            request.id,
            request.title,
            request.source_module,
            request.entity_type,
            request.entity_id,
            request.deep_link,
            request.status,
            request.current_stage,
            request.amount,
            request.currency,
            request.requester_membership_id,
            coalesce(
              requester_profile.display_name,
              nullif(requester_user.raw_user_meta_data ->> 'full_name', ''),
              requester_user.email,
              'Member'
            ) as requester_display_name,
            request.submitted_at,
            request.due_at,
            request.completed_at,
            definition.name as definition_name,
            request.snapshot,
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', step.id,
                  'stepName', step.step_name,
                  'stageOrder', step.stage_order,
                  'status', step.status,
                  'approverMembershipId', step.approver_membership_id,
                  'approverDisplayName', coalesce(
                    approver_profile.display_name,
                    nullif(approver_user.raw_user_meta_data ->> 'full_name', ''),
                    approver_user.email,
                    'Member'
                  ),
                  'delegatedFromDisplayName', case when step.delegated_from_membership_id is null then null else coalesce(
                    delegate_profile.display_name,
                    nullif(delegate_user.raw_user_meta_data ->> 'full_name', ''),
                    delegate_user.email,
                    'Member'
                  ) end,
                  'commentRequired', step.comment_required,
                  'dueAt', step.due_at,
                  'reminderCount', step.reminder_count,
                  'escalatedAt', step.escalated_at,
                  'canAct', step.status = 'pending' and step.approver_membership_id = ${context.membership.id}::uuid,
                  'canReassign', ${canReassign}::boolean and definition.allow_reassignment and step.status = 'pending'
                    and (step.approver_membership_id = ${context.membership.id}::uuid or ${canManageDefinitions}::boolean)
                ) order by step.stage_order, step.sort_order, step.created_at, step.id
              )
              from public.approval_request_steps as step
              join public.memberships as approver_membership
                on approver_membership.id = step.approver_membership_id
              join public.identity_accounts as approver_user
                on approver_user.id = approver_membership.user_id
              left join public.profiles as approver_profile
                on approver_profile.id = approver_membership.user_id
              left join public.memberships as delegate_membership
                on delegate_membership.id = step.delegated_from_membership_id
              left join public.identity_accounts as delegate_user
                on delegate_user.id = delegate_membership.user_id
              left join public.profiles as delegate_profile
                on delegate_profile.id = delegate_membership.user_id
              where step.request_id = request.id
            ), '[]'::jsonb) as pending_steps,
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', action.id,
                  'action', action.action,
                  'actorDisplayName', coalesce(
                    actor_profile.display_name,
                    nullif(actor_user.raw_user_meta_data ->> 'full_name', ''),
                    actor_user.email,
                    'System'
                  ),
                  'comment', action.comment,
                  'createdAt', action.created_at
                ) order by action.created_at, action.id
              )
              from public.approval_actions as action
              left join public.memberships as actor_membership
                on actor_membership.id = action.actor_membership_id
              left join public.identity_accounts as actor_user
                on actor_user.id = actor_membership.user_id
              left join public.profiles as actor_profile
                on actor_profile.id = actor_membership.user_id
              where action.request_id = request.id
            ), '[]'::jsonb) as actions
          from public.approval_requests as request
          join public.approval_definitions as definition
            on definition.id = request.definition_id
          join public.memberships as requester_membership
            on requester_membership.id = request.requester_membership_id
          join public.identity_accounts as requester_user
            on requester_user.id = requester_membership.user_id
          left join public.profiles as requester_profile
            on requester_profile.id = requester_membership.user_id
          where request.organization_id = ${context.membership.organizationId}::uuid
            and (
              (${effectiveView} = 'all' and (
                ${canManageDefinitions}::boolean
                or private.crm_scope_allows_membership(
                  ${context.membership.id}::uuid,
                  ${requestViewScope},
                  request.requester_membership_id,
                  request.requester_membership_id
                )
              ))
              or (${effectiveView} = 'submitted' and request.requester_membership_id = ${context.membership.id}::uuid)
              or (${effectiveView} = 'inbox' and exists (
                select 1 from public.approval_request_steps as assigned_step
                where assigned_step.request_id = request.id
                  and assigned_step.approver_membership_id = ${context.membership.id}::uuid
                  and assigned_step.status = 'pending'
              ))
            )
            and (${filters.status} = 'all' or request.status = ${filters.status})
            and (${filters.q} = '' or (
              request.title ilike ${searchPattern}
              or request.entity_type ilike ${searchPattern}
              or coalesce(request.entity_id, '') ilike ${searchPattern}
              or definition.name ilike ${searchPattern}
              or coalesce(requester_user.email, '') ilike ${searchPattern}
            ))
          order by
            case when request.status = 'pending' then 0 else 1 end,
            request.submitted_at desc,
            request.id desc
          limit ${APPROVAL_PAGE_SIZE}
          offset ${offset}
        `,
        database<CountRow[]>`
          select count(*)::integer as count
          from public.approval_requests as request
          join public.approval_definitions as definition on definition.id = request.definition_id
          join public.memberships as requester_membership on requester_membership.id = request.requester_membership_id
          join public.identity_accounts as requester_user on requester_user.id = requester_membership.user_id
          where request.organization_id = ${context.membership.organizationId}::uuid
            and (
              (${effectiveView} = 'all' and (
                ${canManageDefinitions}::boolean
                or private.crm_scope_allows_membership(
                  ${context.membership.id}::uuid,
                  ${requestViewScope},
                  request.requester_membership_id,
                  request.requester_membership_id
                )
              ))
              or (${effectiveView} = 'submitted' and request.requester_membership_id = ${context.membership.id}::uuid)
              or (${effectiveView} = 'inbox' and exists (
                select 1 from public.approval_request_steps as assigned_step
                where assigned_step.request_id = request.id
                  and assigned_step.approver_membership_id = ${context.membership.id}::uuid
                  and assigned_step.status = 'pending'
              ))
            )
            and (${filters.status} = 'all' or request.status = ${filters.status})
            and (${filters.q} = '' or (
              request.title ilike ${searchPattern}
              or request.entity_type ilike ${searchPattern}
              or coalesce(request.entity_id, '') ilike ${searchPattern}
              or definition.name ilike ${searchPattern}
              or coalesce(requester_user.email, '') ilike ${searchPattern}
            ))
        `,
        database<SummaryRow[]>`
          select
            count(distinct request.id) filter (
              where request.status = 'pending'
                and step.approver_membership_id = ${context.membership.id}::uuid
                and step.status = 'pending'
            )::integer as assigned_pending,
            count(distinct request.id) filter (
              where request.status = 'pending'
                and request.requester_membership_id = ${context.membership.id}::uuid
            )::integer as submitted_pending,
            count(distinct action.request_id) filter (
              where action.actor_membership_id = ${context.membership.id}::uuid
                and action.action in ('approved', 'rejected', 'revision_requested')
                and action.created_at >= date_trunc('month', now())
            )::integer as decided_this_month,
            count(distinct step.id) filter (
              where step.status = 'pending'
                and step.approver_membership_id = ${context.membership.id}::uuid
                and step.due_at < now()
            )::integer as overdue
          from public.approval_requests as request
          left join public.approval_request_steps as step on step.request_id = request.id
          left join public.approval_actions as action on action.request_id = request.id
          where request.organization_id = ${context.membership.organizationId}::uuid
        `,
        database<MemberRow[]>`
          select
            membership.id,
            coalesce(
              profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              auth_user.email,
              'Member'
            ) as display_name,
            auth_user.email,
            membership.department_id,
            membership.manager_membership_id,
            private.membership_has_permission(
              membership.id,
              'approvals.request.approve'
            ) as can_approve
          from public.memberships as membership
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          where membership.organization_id = ${context.membership.organizationId}::uuid
            and membership.status = 'active'
          order by display_name, auth_user.email
          limit 1_000
        `,
        database<RoleRow[]>`
          select role.key, role.name
          from public.roles as role
          where role.organization_id = ${context.membership.organizationId}::uuid
            and role.status = 'active'
          order by role.name
        `,
        database<DepartmentRow[]>`
          select department.id, department.name
          from public.departments as department
          where department.organization_id = ${context.membership.organizationId}::uuid
            and department.status = 'active'
          order by department.name
        `,
        database<DelegationRow[]>`
          select
            delegation.id,
            delegation.from_membership_id,
            coalesce(
              from_profile.display_name,
              nullif(from_user.raw_user_meta_data ->> 'full_name', ''),
              from_user.email,
              'Member'
            ) as from_display_name,
            delegation.to_membership_id,
            coalesce(
              to_profile.display_name,
              nullif(to_user.raw_user_meta_data ->> 'full_name', ''),
              to_user.email,
              'Member'
            ) as to_display_name,
            delegation.source_module,
            delegation.starts_at,
            delegation.ends_at,
            case
              when delegation.status = 'active' and delegation.ends_at <= now() then 'expired'
              else delegation.status
            end as status,
            delegation.reason,
            delegation.from_membership_id = ${context.membership.id}::uuid
              or ${canManageDelegations}::boolean as can_revoke
          from public.approval_delegations as delegation
          join public.memberships as from_membership on from_membership.id = delegation.from_membership_id
          join public.identity_accounts as from_user on from_user.id = from_membership.user_id
          left join public.profiles as from_profile on from_profile.id = from_membership.user_id
          join public.memberships as to_membership on to_membership.id = delegation.to_membership_id
          join public.identity_accounts as to_user on to_user.id = to_membership.user_id
          left join public.profiles as to_profile on to_profile.id = to_membership.user_id
          where delegation.organization_id = ${context.membership.organizationId}::uuid
            and (
              delegation.from_membership_id = ${context.membership.id}::uuid
              or delegation.to_membership_id = ${context.membership.id}::uuid
              or ${canManageDelegations}::boolean
            )
          order by delegation.status, delegation.ends_at desc
          limit 200
        `,
      ]);

    const totalItems = counts[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / APPROVAL_PAGE_SIZE));
    const page = Math.min(filters.page, totalPages);
    const summary = summaryRows[0] ?? {
      assigned_pending: 0,
      submitted_pending: 0,
      decided_this_month: 0,
      overdue: 0,
    };

    return {
      allowed: true,
      data: {
        definitions: definitions.map((definition) => ({
          id: definition.id,
          key: definition.key,
          name: definition.name,
          description: definition.description,
          sourceModule: definition.source_module,
          entityType: definition.entity_type,
          version: definition.version,
          status: definition.status,
          allowSelfApproval: definition.allow_self_approval,
          allowReassignment: definition.allow_reassignment,
          steps: (definition.steps ?? []).map((step) => ({
            ...step,
            conditions: normalizeConditions(step.conditions),
          })),
        })),
        requests: requests.map((request) => ({
          id: request.id,
          title: request.title,
          sourceModule: request.source_module,
          entityType: request.entity_type,
          entityId: request.entity_id,
          deepLink: safeApprovalDeepLink(request.deep_link),
          status: request.status,
          currentStage: request.current_stage,
          amount: request.amount === null ? null : Number(request.amount),
          currency: request.currency,
          requesterMembershipId: request.requester_membership_id,
          requesterDisplayName: request.requester_display_name,
          submittedAt: request.submitted_at.toISOString(),
          dueAt: request.due_at?.toISOString() ?? null,
          completedAt: request.completed_at?.toISOString() ?? null,
          definitionName: request.definition_name,
          snapshot: recordValue(request.snapshot),
          pendingSteps: request.pending_steps ?? [],
          actions: request.actions ?? [],
        })),
        members: members.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          email: member.email,
          departmentId: member.department_id,
          managerMembershipId: member.manager_membership_id,
          canApprove: member.can_approve,
        })),
        roles,
        departments,
        delegations: delegations.map((delegation) => ({
          id: delegation.id,
          fromMembershipId: delegation.from_membership_id,
          fromDisplayName: delegation.from_display_name,
          toMembershipId: delegation.to_membership_id,
          toDisplayName: delegation.to_display_name,
          sourceModule: delegation.source_module,
          startsAt: delegation.starts_at.toISOString(),
          endsAt: delegation.ends_at.toISOString(),
          status: delegation.status,
          reason: delegation.reason,
          canRevoke: delegation.can_revoke,
        })),
        filters: { ...filters, view: effectiveView, page },
        pagination: {
          page,
          pageSize: APPROVAL_PAGE_SIZE,
          totalItems,
          totalPages,
        },
        summary: {
          assignedPending: summary.assigned_pending,
          submittedPending: summary.submitted_pending,
          decidedThisMonth: summary.decided_this_month,
          overdue: summary.overdue,
        },
        capabilities: {
          canCreateRequest: permissions.has(approvalPermissionKeys.createRequest),
          canManageDefinitions,
          canManageDelegations,
          canApprove,
          canReject,
          canReassign,
          canViewAllRequests: canViewAll,
        },
        currentMembershipId: context.membership.id,
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}

export async function createApprovalDefinition(
  context: CurrentPermissionContext,
  input: CreateApprovalDefinitionInput,
): Promise<string> {
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`${context.membership.organizationId}:approval-policy:${input.key}`},
          0
        )
      )
    `;
    const versions = await sql<{ next_version: number; has_active: boolean }[]>`
      select
        (coalesce(max(version), 0) + 1)::integer as next_version,
        coalesce(bool_or(status = 'active'), false) as has_active
      from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${input.key}
    `;
    const version = versions[0]?.next_version ?? 1;
    if (versions[0]?.has_active) {
      throw new Error("An active approval policy already uses this key.");
    }

    const rows = await sql<{ id: string }[]>`
      insert into public.approval_definitions (
        organization_id, key, name, description, source_module, entity_type, version,
        allow_self_approval, allow_reassignment,
        created_by_membership_id, updated_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid,
        ${input.key},
        ${input.name},
        ${input.description},
        ${input.sourceModule},
        ${input.entityType},
        ${version},
        ${input.allowSelfApproval},
        ${input.allowReassignment},
        ${context.membership.id}::uuid,
        ${context.membership.id}::uuid
      )
      returning id
    `;
    const definitionId = rows[0]?.id;
    if (!definitionId) throw new Error("Approval policy could not be created.");

    for (const step of input.steps) {
      await sql`
        insert into public.approval_definition_steps (
          organization_id, definition_id, name, stage_order, sort_order,
          selector_type, selector_role_key, selector_membership_id, decision_mode,
          conditions, comment_required, reminder_after_hours,
          escalation_after_hours, expires_after_hours
        ) values (
          ${context.membership.organizationId}::uuid,
          ${definitionId}::uuid,
          ${step.name},
          ${step.stageOrder},
          ${step.sortOrder},
          ${step.selectorType},
          ${step.selectorRoleKey},
          ${step.selectorMembershipId}::uuid,
          ${step.decisionMode},
          ${sql.json(toJsonValue(step.conditions))},
          ${step.commentRequired},
          ${step.reminderAfterHours},
          ${step.escalationAfterHours},
          ${step.expiresAfterHours}
        )
      `;
    }

    await writeAuditEvent(sql, context, {
      action: "approvals.definition.created",
      entityType: "approval_definition",
      entityId: definitionId,
      afterState: {
        key: input.key,
        name: input.name,
        sourceModule: input.sourceModule,
        entityType: input.entityType,
        steps: input.steps.length,
        version,
      },
      changedFields: ["definition", "steps"],
    });
    return definitionId;
  });
}

export async function retireApprovalDefinition(
  context: CurrentPermissionContext,
  definitionId: string,
): Promise<void> {
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    const rows = await sql<{ id: string; name: string }[]>`
      update public.approval_definitions
      set status = 'inactive', updated_by_membership_id = ${context.membership.id}::uuid
      where id = ${definitionId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
      returning id, name
    `;
    if (!rows[0]) throw new Error("Active approval policy was not found.");
    await writeAuditEvent(sql, context, {
      action: "approvals.definition.retired",
      entityType: "approval_definition",
      entityId: definitionId,
      beforeState: { status: "active" },
      afterState: { status: "inactive" },
      changedFields: ["status"],
    });
  });
}

async function createRequestInTransaction(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  definition: DefinitionMutationRow,
  input: Omit<CreateApprovalRequestInput, "definitionId">,
): Promise<{ request: RequestMutationRow; activeSteps: CreatedStepNotification[] }> {
  const definitionSteps = await sql<DefinitionStepMutationRow[]>`
    select
      id, name, stage_order, sort_order, selector_type, selector_role_key,
      selector_membership_id, decision_mode, conditions, comment_required,
      reminder_after_hours, escalation_after_hours, expires_after_hours
    from public.approval_definition_steps
    where definition_id = ${definition.id}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
    order by stage_order, sort_order, id
  `;
  if (definitionSteps.length === 0) throw new Error("Approval policy has no steps.");

  const applicableSteps = definitionSteps.filter((step) =>
    stepApplies(normalizeConditions(step.conditions), {
      amount: input.amount,
      departmentId: input.departmentId,
    }),
  );
  if (applicableSteps.length === 0) {
    throw new Error("No approval policy step applies to this request.");
  }

  const snapshotHash = approvalSnapshotHash(input.snapshot);
  const requestRows = await sql<RequestMutationRow[]>`
    insert into public.approval_requests (
      organization_id, definition_id, definition_version, requester_membership_id,
      title, source_module, entity_type, entity_id, deep_link, department_id,
      amount, currency, snapshot, snapshot_hash, status, current_stage, due_at
    ) values (
      ${context.membership.organizationId}::uuid,
      ${definition.id}::uuid,
      ${definition.version},
      ${context.membership.id}::uuid,
      ${input.title},
      ${definition.source_module},
      ${definition.entity_type},
      ${input.entityId},
      ${safeApprovalDeepLink(input.deepLink)},
      ${input.departmentId}::uuid,
      ${input.amount},
      ${input.currency},
      ${sql.json(toJsonValue(input.snapshot))},
      ${snapshotHash},
      'pending',
      ${Math.min(...applicableSteps.map((step) => step.stage_order))},
      ${input.dueAt}::timestamptz
    )
    on conflict (organization_id, source_module, entity_type, entity_id)
      where entity_id is not null and status = 'pending'
      do nothing
    returning id, title, source_module, entity_type, entity_id, status,
      requester_membership_id, current_stage, deep_link
  `;
  const request = requestRows[0];
  if (!request) {
    throw new Error("This record already has a pending approval request.");
  }

  const submittedAt = new Date();
  const firstStage = request.current_stage ?? 1;
  const stepRows: Array<{
    organization_id: string;
    request_id: string;
    definition_step_id: string;
    stage_order: number;
    sort_order: number;
    step_name: string;
    selector_type: ApprovalSelectorType;
    decision_mode: ApprovalDecisionMode;
    approver_membership_id: string;
    delegated_from_membership_id: string | null;
    status: "pending" | "waiting";
    comment_required: boolean;
    due_at: string | null;
    reminder_at: string | null;
    escalation_at: string | null;
  }> = [];

  for (const step of applicableSteps) {
    const approvers = await resolveApprovers(sql, context, definition, step, context.membership.id);
    const status = step.stage_order === firstStage ? "pending" : "waiting";
    const dueAt =
      status === "pending"
        ? earliestDate(
            addHours(submittedAt, step.expires_after_hours),
            input.dueAt ? new Date(input.dueAt) : null,
          )
        : null;
    for (const approver of approvers) {
      stepRows.push({
        organization_id: context.membership.organizationId,
        request_id: request.id,
        definition_step_id: step.id,
        stage_order: step.stage_order,
        sort_order: step.sort_order,
        step_name: step.name,
        selector_type: step.selector_type,
        decision_mode: step.decision_mode,
        approver_membership_id: approver.membershipId,
        delegated_from_membership_id: approver.delegatedFromMembershipId,
        status,
        comment_required: step.comment_required,
        due_at: dueAt?.toISOString() ?? null,
        reminder_at:
          status === "pending"
            ? (addHours(submittedAt, step.reminder_after_hours)?.toISOString() ?? null)
            : null,
        escalation_at:
          status === "pending"
            ? (addHours(submittedAt, step.escalation_after_hours)?.toISOString() ?? null)
            : null,
      });
    }
  }

  const insertedSteps = (await sql`
    insert into public.approval_request_steps ${sql(
      stepRows,
      "organization_id",
      "request_id",
      "definition_step_id",
      "stage_order",
      "sort_order",
      "step_name",
      "selector_type",
      "decision_mode",
      "approver_membership_id",
      "delegated_from_membership_id",
      "status",
      "comment_required",
      "due_at",
      "reminder_at",
      "escalation_at",
    )}
    returning id, approver_membership_id, step_name, status
  `) as Array<{
    id: string;
    approver_membership_id: string;
    step_name: string;
    status: "pending" | "waiting";
  }>;
  const activeSteps: CreatedStepNotification[] = insertedSteps
    .filter((step) => step.status === "pending")
    .map((step) => ({
      id: step.id,
      approverMembershipId: step.approver_membership_id,
      stepName: step.step_name,
    }));

  await sql`
    insert into public.approval_actions (
      organization_id, request_id, actor_membership_id, action, metadata
    ) values (
      ${context.membership.organizationId}::uuid,
      ${request.id}::uuid,
      ${context.membership.id}::uuid,
      'submitted',
      ${sql.json(toJsonValue({ snapshotHash, definitionKey: definition.key }))}
    )
  `;
  await writeAuditEvent(sql, context, {
    action: "approvals.request.submitted",
    entityType: "approval_request",
    entityId: request.id,
    afterState: {
      status: "pending",
      definitionKey: definition.key,
      title: input.title,
      snapshotHash,
    },
    changedFields: ["status", "snapshot"],
  });
  return { request, activeSteps };
}

export async function createApprovalRequest(
  context: CurrentPermissionContext,
  input: CreateApprovalRequestInput,
): Promise<string> {
  const database = getDatabaseClient();
  const result = await database.begin(async (sql) => {
    const definitions = await sql<DefinitionMutationRow[]>`
      select id, key, name, source_module, entity_type, version, status,
        allow_self_approval, allow_reassignment
      from public.approval_definitions
      where id = ${input.definitionId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
      limit 1
      for share
    `;
    const definition = definitions[0];
    if (!definition) throw new Error("Active approval policy was not found.");
    return createRequestInTransaction(sql, context, definition, {
      title: input.title,
      entityId: input.entityId,
      deepLink: input.deepLink,
      departmentId: input.departmentId,
      amount: input.amount,
      currency: input.currency,
      snapshot: input.snapshot,
      dueAt: input.dueAt,
    });
  });

  await notifyApprovalAssignment({
    organizationId: context.membership.organizationId,
    requestId: result.request.id,
    title: result.request.title,
    deepLink: result.request.deep_link,
    createdByMembershipId: context.membership.id,
    steps: result.activeSteps,
  });
  return result.request.id;
}

export async function submitApprovalForRecordAtomically<T>(
  context: CurrentPermissionContext,
  input: ApprovalRequestIntegrationInput,
  mutate: (sql: TransactionSql, requestId: string) => Promise<T>,
): Promise<{ requestId: string; result: T }> {
  const database = getDatabaseClient();
  const transactionResult = await database.begin(async (sql) => {
    const definitions = await sql<DefinitionMutationRow[]>`
      select id, key, name, source_module, entity_type, version, status,
        allow_self_approval, allow_reassignment
      from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${input.definitionKey}
        and source_module = ${input.sourceModule}
        and entity_type = ${input.entityType}
        and status = 'active'
      limit 1
      for share
    `;
    const definition = definitions[0];
    if (!definition) throw new Error("Active approval policy was not found.");

    const approval = await createRequestInTransaction(sql, context, definition, {
      title: input.title,
      entityId: input.entityId,
      deepLink: input.deepLink,
      departmentId: input.departmentId,
      amount: input.amount,
      currency: input.currency,
      snapshot: input.snapshot,
      dueAt: input.dueAt,
    });
    const result = await mutate(sql, approval.request.id);
    return { approval, result };
  });

  await notifyApprovalAssignment({
    organizationId: context.membership.organizationId,
    requestId: transactionResult.approval.request.id,
    title: transactionResult.approval.request.title,
    deepLink: transactionResult.approval.request.deep_link,
    createdByMembershipId: context.membership.id,
    steps: transactionResult.approval.activeSteps,
  });
  return { requestId: transactionResult.approval.request.id, result: transactionResult.result };
}

export async function submitApprovalForRecord(
  context: CurrentPermissionContext,
  input: ApprovalRequestIntegrationInput,
): Promise<string> {
  const submitted = await submitApprovalForRecordAtomically(context, input, async () => undefined);
  return submitted.requestId;
}

export async function decideApprovalStep(
  context: CurrentPermissionContext,
  input: ApprovalDecisionInput,
): Promise<{ requestId: string; status: ApprovalStatus }> {
  const database = getDatabaseClient();
  const result = await database.begin(async (sql) => {
    const rows = await sql<StepDecisionRow[]>`
      select
        step.id,
        step.request_id,
        step.organization_id,
        step.definition_step_id,
        step.stage_order,
        step.decision_mode,
        step.status,
        step.approver_membership_id,
        step.comment_required,
        request.status as request_status,
        request.requester_membership_id,
        request.title as request_title,
        request.deep_link as request_deep_link,
        definition.allow_reassignment as definition_allow_reassignment,
        definition.allow_self_approval as definition_allow_self_approval
      from public.approval_request_steps as step
      join public.approval_requests as request on request.id = step.request_id
      join public.approval_definitions as definition on definition.id = request.definition_id
      where step.id = ${input.requestStepId}::uuid
        and step.organization_id = ${context.membership.organizationId}::uuid
      for update of request, step
    `;
    const row = rows[0];
    if (!row || row.request_status !== "pending" || row.status !== "pending") {
      throw new Error("Pending approval step was not found.");
    }
    if (row.approver_membership_id !== context.membership.id) {
      throw new Error("This approval step is assigned to another member.");
    }
    if ((row.comment_required || input.decision !== "approved") && !input.comment) {
      throw new Error("A comment is required for this decision.");
    }

    await sql`
      update public.approval_request_steps
      set status = ${input.decision}, acted_at = now()
      where id = ${row.id}::uuid
    `;
    await sql`
      insert into public.approval_actions (
        organization_id, request_id, request_step_id, actor_membership_id,
        action, comment
      ) values (
        ${context.membership.organizationId}::uuid,
        ${row.request_id}::uuid,
        ${row.id}::uuid,
        ${context.membership.id}::uuid,
        ${input.decision},
        ${input.comment}
      )
    `;

    let requestStatus: ApprovalStatus = "pending";
    const activatedSteps: CreatedStepNotification[] = [];

    if (input.decision === "rejected" || input.decision === "revision_requested") {
      requestStatus = input.decision;
      await sql`
        update public.approval_request_steps
        set status = 'cancelled'
        where request_id = ${row.request_id}::uuid
          and id <> ${row.id}::uuid
          and status in ('waiting', 'pending')
      `;
      await sql`
        update public.approval_requests
        set status = ${requestStatus}, current_stage = null, completed_at = now()
        where id = ${row.request_id}::uuid
      `;
    } else {
      if (row.decision_mode === "any") {
        await sql`
          update public.approval_request_steps
          set status = 'skipped'
          where request_id = ${row.request_id}::uuid
            and definition_step_id = ${row.definition_step_id}::uuid
            and id <> ${row.id}::uuid
            and status = 'pending'
        `;
      }

      const stageRemaining = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.approval_request_steps
        where request_id = ${row.request_id}::uuid
          and stage_order = ${row.stage_order}
          and status in ('waiting', 'pending')
      `;
      if ((stageRemaining[0]?.count ?? 0) === 0) {
        const nextStages = await sql<{ stage_order: number }[]>`
          select min(stage_order)::integer as stage_order
          from public.approval_request_steps
          where request_id = ${row.request_id}::uuid
            and status = 'waiting'
        `;
        const nextStage = nextStages[0]?.stage_order;
        if (nextStage) {
          const activated = await sql<
            {
              id: string;
              approver_membership_id: string;
              step_name: string;
              reminder_after_hours: number | null;
              escalation_after_hours: number | null;
            }[]
          >`
            update public.approval_request_steps as request_step
            set
              status = 'pending',
              due_at = case
                when definition_step.expires_after_hours is null then approval_request.due_at
                when approval_request.due_at is null then
                  now() + make_interval(hours => definition_step.expires_after_hours)
                else least(
                  approval_request.due_at,
                  now() + make_interval(hours => definition_step.expires_after_hours)
                )
              end,
              reminder_at = case
                when definition_step.reminder_after_hours is null then null
                else now() + make_interval(hours => definition_step.reminder_after_hours)
              end,
              escalation_at = case
                when definition_step.escalation_after_hours is null then null
                else now() + make_interval(hours => definition_step.escalation_after_hours)
              end
            from public.approval_definition_steps as definition_step,
              public.approval_requests as approval_request
            where request_step.request_id = ${row.request_id}::uuid
              and request_step.stage_order = ${nextStage}
              and request_step.status = 'waiting'
              and definition_step.id = request_step.definition_step_id
              and approval_request.id = request_step.request_id
            returning request_step.id, request_step.approver_membership_id,
              request_step.step_name, definition_step.reminder_after_hours,
              definition_step.escalation_after_hours
          `;
          activatedSteps.push(
            ...activated.map((step) => ({
              id: step.id,
              approverMembershipId: step.approver_membership_id,
              stepName: step.step_name,
            })),
          );
          await sql`
            update public.approval_requests
            set current_stage = ${nextStage}
            where id = ${row.request_id}::uuid
          `;
        } else {
          requestStatus = "approved";
          await sql`
            update public.approval_requests
            set status = 'approved', current_stage = null, completed_at = now()
            where id = ${row.request_id}::uuid
          `;
        }
      }
    }

    await writeAuditEvent(sql, context, {
      action: `approvals.request.${input.decision}`,
      entityType: "approval_request",
      entityId: row.request_id,
      beforeState: { status: row.request_status, stepStatus: row.status },
      afterState: { status: requestStatus, stepStatus: input.decision },
      changedFields: ["status", "stepStatus"],
      metadata: { requestStepId: row.id },
    });

    return {
      requestId: row.request_id,
      requestTitle: row.request_title,
      requestDeepLink: row.request_deep_link,
      requesterMembershipId: row.requester_membership_id,
      status: requestStatus,
      activeSteps: activatedSteps,
    };
  });

  if (result.activeSteps.length > 0) {
    await notifyApprovalAssignment({
      organizationId: context.membership.organizationId,
      requestId: result.requestId,
      title: result.requestTitle,
      deepLink: result.requestDeepLink,
      createdByMembershipId: context.membership.id,
      steps: result.activeSteps,
    });
  }
  if (result.status !== "pending") {
    await notifyApprovalDecision({
      organizationId: context.membership.organizationId,
      requesterMembershipId: result.requesterMembershipId,
      requestId: result.requestId,
      title: result.requestTitle,
      status: result.status,
      deepLink: result.requestDeepLink,
      actorMembershipId: context.membership.id,
    });
  }
  return { requestId: result.requestId, status: result.status };
}

export async function reassignApprovalStep(
  context: CurrentPermissionContext,
  input: ReassignApprovalStepInput,
): Promise<string> {
  const database = getDatabaseClient();
  const result = await database.begin(async (sql) => {
    const rows = await sql<StepDecisionRow[]>`
      select
        step.id, step.request_id, step.organization_id, step.definition_step_id,
        step.stage_order, step.decision_mode, step.status, step.approver_membership_id,
        step.comment_required, request.status as request_status,
        request.requester_membership_id, request.title as request_title,
        request.deep_link as request_deep_link,
        definition.allow_reassignment as definition_allow_reassignment,
        definition.allow_self_approval as definition_allow_self_approval
      from public.approval_request_steps as step
      join public.approval_requests as request on request.id = step.request_id
      join public.approval_definitions as definition on definition.id = request.definition_id
      where step.id = ${input.requestStepId}::uuid
        and step.organization_id = ${context.membership.organizationId}::uuid
      for update of request, step
    `;
    const row = rows[0];
    if (!row || row.status !== "pending" || row.request_status !== "pending") {
      throw new Error("Pending approval step was not found.");
    }
    if (!row.definition_allow_reassignment)
      throw new Error("This policy does not allow reassignment.");
    const canManage = context.permissions.has(approvalPermissionKeys.manageDefinitions);
    if (row.approver_membership_id !== context.membership.id && !canManage) {
      throw new Error("Only the current approver or policy manager may reassign this step.");
    }
    if (
      !row.definition_allow_self_approval &&
      input.approverMembershipId === row.requester_membership_id
    ) {
      throw new Error("This request does not allow self-approval.");
    }
    const target = await sql<{ id: string }[]>`
      select id
      from public.memberships
      where id = ${input.approverMembershipId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
        and private.membership_has_permission(id, 'approvals.request.approve')
      limit 1
    `;
    if (!target[0]) {
      throw new Error("The new approver is not an active member with approval permission.");
    }

    await sql`
      update public.approval_request_steps as request_step
      set
        approver_membership_id = ${input.approverMembershipId}::uuid,
        delegated_from_membership_id = null,
        reminder_count = 0,
        last_reminded_at = null,
        escalated_at = null,
        reminder_at = case
          when definition_step.reminder_after_hours is null then null
          else now() + make_interval(hours => definition_step.reminder_after_hours)
        end,
        escalation_at = case
          when definition_step.escalation_after_hours is null then null
          else now() + make_interval(hours => definition_step.escalation_after_hours)
        end
      from public.approval_definition_steps as definition_step
      where request_step.id = ${row.id}::uuid
        and definition_step.id = request_step.definition_step_id
    `;
    await sql`
      insert into public.approval_actions (
        organization_id, request_id, request_step_id, actor_membership_id,
        action, comment, metadata
      ) values (
        ${context.membership.organizationId}::uuid,
        ${row.request_id}::uuid,
        ${row.id}::uuid,
        ${context.membership.id}::uuid,
        'reassigned',
        ${input.comment},
        ${sql.json(
          toJsonValue({
            fromMembershipId: row.approver_membership_id,
            toMembershipId: input.approverMembershipId,
          }),
        )}
      )
    `;
    await writeAuditEvent(sql, context, {
      action: "approvals.request.reassigned",
      entityType: "approval_request",
      entityId: row.request_id,
      beforeState: { approverMembershipId: row.approver_membership_id },
      afterState: { approverMembershipId: input.approverMembershipId },
      changedFields: ["approverMembershipId"],
      metadata: { requestStepId: row.id },
    });
    return {
      requestId: row.request_id,
      requestTitle: row.request_title,
      requestDeepLink: row.request_deep_link,
      stepId: row.id,
    };
  });

  await notifyApprovalAssignment({
    organizationId: context.membership.organizationId,
    requestId: result.requestId,
    title: result.requestTitle,
    deepLink: result.requestDeepLink,
    createdByMembershipId: context.membership.id,
    steps: [
      {
        id: result.stepId,
        approverMembershipId: input.approverMembershipId,
        stepName: "Reassigned approval",
      },
    ],
  });
  return result.requestId;
}

export async function cancelApprovalRequest(
  context: CurrentPermissionContext,
  requestId: string,
  comment: string,
): Promise<void> {
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    const rows = await sql<{ id: string; status: ApprovalStatus }[]>`
      select id, status
      from public.approval_requests
      where id = ${requestId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and requester_membership_id = ${context.membership.id}::uuid
      for update
    `;
    const row = rows[0];
    if (!row || row.status !== "pending") throw new Error("Pending request was not found.");
    await sql`
      update public.approval_requests
      set status = 'cancelled', current_stage = null, completed_at = now()
      where id = ${requestId}::uuid
    `;
    await sql`
      update public.approval_request_steps
      set status = 'cancelled'
      where request_id = ${requestId}::uuid and status in ('waiting', 'pending')
    `;
    await sql`
      insert into public.approval_actions (
        organization_id, request_id, actor_membership_id, action, comment
      ) values (
        ${context.membership.organizationId}::uuid,
        ${requestId}::uuid,
        ${context.membership.id}::uuid,
        'cancelled',
        ${comment}
      )
    `;
    await writeAuditEvent(sql, context, {
      action: "approvals.request.cancelled",
      entityType: "approval_request",
      entityId: requestId,
      beforeState: { status: "pending" },
      afterState: { status: "cancelled" },
      changedFields: ["status"],
    });
  });
}

export async function invalidateApprovalRequestForEntity(
  context: CurrentPermissionContext,
  input: {
    sourceModule: string;
    entityType: string;
    entityId: string;
    currentSnapshot: Record<string, unknown>;
    reason: string;
  },
): Promise<number> {
  const currentHash = approvalSnapshotHash(input.currentSnapshot);
  const database = getDatabaseClient();
  const changed = await database.begin(async (sql) => {
    const rows = await sql<
      {
        id: string;
        snapshot_hash: string;
        title: string;
        requester_membership_id: string;
        deep_link: string | null;
      }[]
    >`
      select id, snapshot_hash, title, requester_membership_id, deep_link
      from public.approval_requests
      where organization_id = ${context.membership.organizationId}::uuid
        and source_module = ${input.sourceModule}
        and entity_type = ${input.entityType}
        and entity_id = ${input.entityId}
        and status = 'pending'
      for update
    `;
    const changed = rows.filter((row) => row.snapshot_hash !== currentHash);
    for (const row of changed) {
      await sql`
        update public.approval_requests
        set status = 'invalidated', current_stage = null, invalidated_at = now(), completed_at = now()
        where id = ${row.id}::uuid
      `;
      await sql`
        update public.approval_request_steps
        set status = 'cancelled'
        where request_id = ${row.id}::uuid and status in ('waiting', 'pending')
      `;
      await sql`
        insert into public.approval_actions (
          organization_id, request_id, actor_membership_id, action, comment,
          metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${row.id}::uuid,
          ${context.membership.id}::uuid,
          'invalidated',
          ${input.reason},
          ${sql.json(toJsonValue({ previousSnapshotHash: row.snapshot_hash, currentHash }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "approvals.request.invalidated",
        entityType: "approval_request",
        entityId: row.id,
        beforeState: { status: "pending", snapshotHash: row.snapshot_hash },
        afterState: { status: "invalidated", currentHash },
        changedFields: ["status"],
      });
    }
    return changed;
  });

  await Promise.allSettled(
    changed.map((request) =>
      notifyApprovalDecision({
        organizationId: context.membership.organizationId,
        requesterMembershipId: request.requester_membership_id,
        requestId: request.id,
        title: request.title,
        status: "invalidated",
        deepLink: request.deep_link,
        actorMembershipId: context.membership.id,
      }),
    ),
  );
  return changed.length;
}

export async function createApprovalDelegation(
  context: CurrentPermissionContext,
  input: CreateApprovalDelegationInput,
): Promise<string> {
  if (input.toMembershipId === context.membership.id) {
    throw new Error("You cannot delegate approvals to yourself.");
  }
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const target = await sql<{ id: string }[]>`
      select id from public.memberships
      where id = ${input.toMembershipId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
        and private.membership_has_permission(id, 'approvals.request.approve')
      limit 1
    `;
    if (!target[0]) {
      throw new Error("Delegate is not an active member with approval permission.");
    }
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`${context.membership.organizationId}:approval-delegation:${context.membership.id}:${input.sourceModule ?? "*"}`},
          0
        )
      )
    `;
    const overlap = await sql<{ id: string }[]>`
      select id
      from public.approval_delegations
      where organization_id = ${context.membership.organizationId}::uuid
        and from_membership_id = ${context.membership.id}::uuid
        and status = 'active'
        and (${input.sourceModule}::text is null or source_module is null or source_module = ${input.sourceModule})
        and starts_at < ${input.endsAt}::timestamptz
        and ends_at > ${input.startsAt}::timestamptz
      limit 1
      for update
    `;
    if (overlap[0]) throw new Error("An overlapping active delegation already exists.");

    const rows = await sql<{ id: string }[]>`
      insert into public.approval_delegations (
        organization_id, from_membership_id, to_membership_id, source_module,
        starts_at, ends_at, reason, created_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid,
        ${context.membership.id}::uuid,
        ${input.toMembershipId}::uuid,
        ${input.sourceModule},
        ${input.startsAt}::timestamptz,
        ${input.endsAt}::timestamptz,
        ${input.reason},
        ${context.membership.id}::uuid
      )
      returning id
    `;
    const delegationId = rows[0]?.id;
    if (!delegationId) throw new Error("Approval delegation could not be created.");
    await writeAuditEvent(sql, context, {
      action: "approvals.delegation.created",
      entityType: "approval_delegation",
      entityId: delegationId,
      afterState: {
        toMembershipId: input.toMembershipId,
        sourceModule: input.sourceModule,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      changedFields: ["delegation"],
    });
    return delegationId;
  });
}

export async function revokeApprovalDelegation(
  context: CurrentPermissionContext,
  delegationId: string,
): Promise<void> {
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    const canManage = context.permissions.has(approvalPermissionKeys.manageDelegations);
    const rows = await sql<{ id: string }[]>`
      update public.approval_delegations
      set
        status = 'revoked',
        revoked_at = now(),
        revoked_by_membership_id = ${context.membership.id}::uuid
      where id = ${delegationId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and status = 'active'
        and (from_membership_id = ${context.membership.id}::uuid or ${canManage}::boolean)
      returning id
    `;
    if (!rows[0]) throw new Error("Active delegation was not found.");
    await writeAuditEvent(sql, context, {
      action: "approvals.delegation.revoked",
      entityType: "approval_delegation",
      entityId: delegationId,
      beforeState: { status: "active" },
      afterState: { status: "revoked" },
      changedFields: ["status"],
    });
  });
}
