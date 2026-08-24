import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  onboardingProgress,
  type HrOnboardingItemKey,
  type HrOnboardingItemStatus,
  type HrOnboardingPlanStatus,
} from "@/modules/hr/onboarding";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrOnboardingItemSummary {
  id: string;
  key: HrOnboardingItemKey;
  label: string;
  position: number;
  status: HrOnboardingItemStatus;
  assignedMembershipId: string | null;
  assignedName: string | null;
  dueDate: string | null;
  notes: string | null;
  completionSource: "manual" | "employee" | "derived" | null;
  completedAt: string | null;
}

export interface HrOnboardingPlanSummary {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string | null;
  cycleNumber: number;
  status: HrOnboardingPlanStatus;
  targetStartDate: string;
  firstDayMeetingAt: string | null;
  firstDayMeetingDetails: string | null;
  probationReviewDate: string | null;
  notes: string | null;
  createdAt: string;
  items: HrOnboardingItemSummary[];
  progress: { completed: number; total: number; percent: number };
  isSelf: boolean;
}

export interface HrOnboardingWorkspaceData {
  plans: HrOnboardingPlanSummary[];
  summary: {
    total: number;
    draft: number;
    inProgress: number;
    ready: number;
    completed: number;
  };
  capabilities: {
    canView: boolean;
    canManage: boolean;
    canUpdateOwn: boolean;
  };
}

interface PlanRow {
  id: string;
  membership_id: string;
  employee_name: string;
  employee_number: string | null;
  cycle_number: number;
  status: HrOnboardingPlanStatus;
  target_start_date: string;
  first_day_meeting_at: string | null;
  first_day_meeting_details: string | null;
  probation_review_date: string | null;
  notes: string | null;
  created_at: string;
}

interface ItemRow {
  id: string;
  onboarding_plan_id: string;
  item_key: HrOnboardingItemKey;
  label: string;
  position: number;
  status: HrOnboardingItemStatus;
  assigned_membership_id: string | null;
  assigned_name: string | null;
  due_date: string | null;
  notes: string | null;
  completion_source: "manual" | "employee" | "derived" | null;
  completed_at: string | null;
}

export async function getHrOnboardingData(
  context: CurrentPermissionContext,
): Promise<HrOnboardingWorkspaceData> {
  const canView = context.permissions.has(hrPermissionKeys.onboardingView);
  const canManage = context.permissions.has(hrPermissionKeys.onboardingManage);
  const canUpdateOwn = context.permissions.has(hrPermissionKeys.onboardingUpdateOwn);
  if (!canView) {
    return {
      plans: [],
      summary: { total: 0, draft: 0, inProgress: 0, ready: 0, completed: 0 },
      capabilities: { canView, canManage, canUpdateOwn },
    };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const scope = context.permissionScopes.get(hrPermissionKeys.onboardingView) ?? "own";
  const planRows = await database<PlanRow[]>`
    select plan.id, plan.membership_id,
      coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
      membership.employee_number, plan.cycle_number, plan.status, plan.target_start_date::text,
      plan.first_day_meeting_at::text, plan.first_day_meeting_details,
      plan.probation_review_date::text, plan.notes, plan.created_at::text
    from public.hr_onboarding_plans as plan
    join public.memberships as membership on membership.id = plan.membership_id
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    left join public.profiles as profile on profile.id = membership.user_id
    left join public.hr_employee_profiles as employee
      on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
    where plan.organization_id = ${organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, plan.membership_id, plan.membership_id
      )
    order by
      case plan.status when 'in_progress' then 1 when 'ready' then 2 when 'draft' then 3 when 'completed' then 4 else 5 end,
      plan.target_start_date,
      employee_name
    limit 500
  `;

  const planIds = planRows.map((row) => row.id);
  const itemRows = planIds.length
    ? await database<ItemRow[]>`
        select item.id, item.onboarding_plan_id, item.item_key, item.label, item.position,
          item.status, item.assigned_membership_id,
          coalesce(assignee_employee.preferred_name, assignee_employee.legal_name,
            assignee_profile.display_name,
            nullif(trim(concat_ws(' ', assignee_profile.first_name, assignee_profile.last_name)), ''),
            split_part(coalesce(assignee_user.email, ''), '@', 1)) as assigned_name,
          item.due_date::text, item.notes, item.completion_source, item.completed_at::text
        from public.hr_onboarding_items as item
        left join public.memberships as assignee on assignee.id = item.assigned_membership_id
        left join public.identity_accounts as assignee_user on assignee_user.id = assignee.user_id
        left join public.profiles as assignee_profile on assignee_profile.id = assignee.user_id
        left join public.hr_employee_profiles as assignee_employee
          on assignee_employee.membership_id = assignee.id
         and assignee_employee.organization_id = assignee.organization_id
        where item.onboarding_plan_id = any(${planIds}::uuid[])
        order by item.onboarding_plan_id, item.position
      `
    : [];

  const itemsByPlan = new Map<string, HrOnboardingItemSummary[]>();
  for (const row of itemRows) {
    const items = itemsByPlan.get(row.onboarding_plan_id) ?? [];
    items.push({
      id: row.id,
      key: row.item_key,
      label: row.label,
      position: row.position,
      status: row.status,
      assignedMembershipId: row.assigned_membership_id,
      assignedName: row.assigned_name,
      dueDate: row.due_date,
      notes: row.notes,
      completionSource: row.completion_source,
      completedAt: row.completed_at,
    });
    itemsByPlan.set(row.onboarding_plan_id, items);
  }

  const plans = planRows.map((row) => {
    const items = itemsByPlan.get(row.id) ?? [];
    return {
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      employeeNumber: row.employee_number,
      cycleNumber: row.cycle_number,
      status: row.status,
      targetStartDate: row.target_start_date,
      firstDayMeetingAt: row.first_day_meeting_at,
      firstDayMeetingDetails: row.first_day_meeting_details,
      probationReviewDate: row.probation_review_date,
      notes: row.notes,
      createdAt: row.created_at,
      items,
      progress: onboardingProgress(items),
      isSelf: row.membership_id === context.membership.id,
    } satisfies HrOnboardingPlanSummary;
  });

  return {
    plans,
    summary: {
      total: plans.length,
      draft: plans.filter((plan) => plan.status === "draft").length,
      inProgress: plans.filter((plan) => plan.status === "in_progress").length,
      ready: plans.filter((plan) => plan.status === "ready").length,
      completed: plans.filter((plan) => plan.status === "completed").length,
    },
    capabilities: { canView, canManage, canUpdateOwn },
  };
}

export async function synchronizeHrOnboardingEvidence(
  sql: TransactionSql,
  input: {
    organizationId: string;
    membershipId: string;
    actorMembershipId: string;
  },
): Promise<number> {
  const rows = await sql<Array<{ id: string }>>`
    with evidence as (
      select plan.id as plan_id, item.id as item_id,
        case item.item_key
          when 'account_created' then membership.id is not null
          when 'email_created' then nullif(btrim(coalesce(auth_user.email, '')), '') is not null
          when 'department_assigned' then membership.department_id is not null
          when 'manager_assigned' then membership.manager_membership_id is not null
          when 'first_day_meeting_scheduled' then plan.first_day_meeting_at is not null
          when 'probation_review_scheduled' then plan.probation_review_date is not null
          else false
        end as is_complete
      from public.hr_onboarding_plans as plan
      join public.hr_onboarding_items as item on item.onboarding_plan_id = plan.id
      join public.memberships as membership on membership.id = plan.membership_id
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      where plan.organization_id = ${input.organizationId}::uuid
        and plan.membership_id = ${input.membershipId}::uuid
        and plan.status <> 'cancelled'
        and item.item_key in (
          'account_created', 'department_assigned', 'manager_assigned', 'email_created',
          'first_day_meeting_scheduled', 'probation_review_scheduled'
        )
    )
    update public.hr_onboarding_items as item
    set status = 'complete', completion_source = 'derived', completed_at = coalesce(item.completed_at, now()),
      completed_by_membership_id = ${input.actorMembershipId}::uuid,
      updated_by_membership_id = ${input.actorMembershipId}::uuid
    from evidence
    where item.id = evidence.item_id
      and evidence.is_complete
      and item.status not in ('complete', 'not_applicable')
    returning item.id
  `;
  return rows.length;
}
