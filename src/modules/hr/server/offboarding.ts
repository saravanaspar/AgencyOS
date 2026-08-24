import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  offboardingProgress,
  type HrOffboardingItemKey,
  type HrOffboardingItemStatus,
  type HrOffboardingPlanStatus,
  type HrSeparationType,
} from "@/modules/hr/offboarding";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrOffboardingItemSummary {
  id: string;
  key: HrOffboardingItemKey;
  label: string;
  position: number;
  status: HrOffboardingItemStatus;
  assignedMembershipId: string | null;
  assignedName: string | null;
  dueDate: string | null;
  notes: string | null;
  completionSource: "manual" | "derived" | "system" | null;
  completedAt: string | null;
}

export interface HrOffboardingPlanSummary {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string | null;
  cycleNumber: number;
  separationType: HrSeparationType;
  status: HrOffboardingPlanStatus;
  noticeDate: string;
  lastWorkingDate: string;
  reason: string | null;
  replacementMembershipId: string | null;
  replacementName: string | null;
  exitInterviewAt: string | null;
  exitInterviewDetails: string | null;
  notes: string | null;
  membershipStatus: "active" | "deactivated" | "invited" | "suspended";
  lifecycleStatus: string;
  activeProjectCount: number;
  openTaskCount: number;
  outstandingExpenseCount: number;
  generatedExitDocumentCount: number;
  createdAt: string;
  items: HrOffboardingItemSummary[];
  progress: { completed: number; total: number; percent: number };
  isSelf: boolean;
}

export interface HrOffboardingWorkspaceData {
  plans: HrOffboardingPlanSummary[];
  summary: {
    total: number;
    inProgress: number;
    ready: number;
    completed: number;
    dueWithinSevenDays: number;
  };
  capabilities: {
    canView: boolean;
    canManage: boolean;
    canCreateOwn: boolean;
  };
}

interface PlanRow {
  id: string;
  membership_id: string;
  employee_name: string;
  employee_number: string | null;
  cycle_number: number;
  separation_type: HrSeparationType;
  status: HrOffboardingPlanStatus;
  notice_date: string;
  last_working_date: string;
  reason: string | null;
  replacement_membership_id: string | null;
  replacement_name: string | null;
  exit_interview_at: string | null;
  exit_interview_details: string | null;
  notes: string | null;
  membership_status: HrOffboardingPlanSummary["membershipStatus"];
  lifecycle_status: string;
  active_project_count: number;
  open_task_count: number;
  outstanding_expense_count: number;
  generated_exit_document_count: number;
  created_at: string;
}

interface ItemRow {
  id: string;
  offboarding_plan_id: string;
  item_key: HrOffboardingItemKey;
  label: string;
  position: number;
  status: HrOffboardingItemStatus;
  assigned_membership_id: string | null;
  assigned_name: string | null;
  due_date: string | null;
  notes: string | null;
  completion_source: HrOffboardingItemSummary["completionSource"];
  completed_at: string | null;
}

export async function getHrOffboardingData(
  context: CurrentPermissionContext,
): Promise<HrOffboardingWorkspaceData> {
  const canView = context.permissions.has(hrPermissionKeys.offboardingView);
  const canManage = context.permissions.has(hrPermissionKeys.offboardingManage);
  const canCreateOwn = context.permissions.has(hrPermissionKeys.offboardingCreateOwn);
  if (!canView) {
    return {
      plans: [],
      summary: { total: 0, inProgress: 0, ready: 0, completed: 0, dueWithinSevenDays: 0 },
      capabilities: { canView, canManage, canCreateOwn },
    };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const scope = context.permissionScopes.get(hrPermissionKeys.offboardingView) ?? "own";
  const planRows = await database<PlanRow[]>`
    select plan.id, plan.membership_id,
      coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
      membership.employee_number, plan.cycle_number, plan.separation_type, plan.status,
      plan.notice_date::text, plan.last_working_date::text, plan.reason,
      plan.replacement_membership_id,
      coalesce(replacement_employee.preferred_name, replacement_employee.legal_name,
        replacement_profile.display_name,
        nullif(trim(concat_ws(' ', replacement_profile.first_name, replacement_profile.last_name)), ''),
        split_part(coalesce(replacement_user.email, ''), '@', 1)) as replacement_name,
      plan.exit_interview_at::text, plan.exit_interview_details, plan.notes,
      membership.status as membership_status,
      coalesce(employee.lifecycle_status, 'preboarding') as lifecycle_status,
      (
        select count(distinct project.id)::integer
        from public.projects as project
        left join public.project_members as project_member
          on project_member.project_id = project.id and project_member.membership_id = plan.membership_id
        where project.organization_id = plan.organization_id
          and project.status in ('planned', 'active', 'on_hold')
          and (project.owner_membership_id = plan.membership_id or project_member.membership_id is not null)
      ) as active_project_count,
      (
        select count(distinct task.id)::integer
        from public.project_task_assignees as assignment
        join public.project_tasks as task on task.id = assignment.task_id
        join public.project_task_statuses as task_status on task_status.id = task.status_id
        where assignment.membership_id = plan.membership_id
          and task.organization_id = plan.organization_id
          and not task_status.is_terminal
      ) as open_task_count,
      (
        select count(*)::integer
        from public.finance_expenses as expense
        where expense.organization_id = plan.organization_id
          and expense.employee_membership_id = plan.membership_id
          and (expense.approval_status = 'pending' or expense.payment_status in ('unpaid', 'scheduled'))
      ) as outstanding_expense_count,
      (
        select count(distinct document.document_type)::integer
        from public.hr_employee_documents as document
        where document.organization_id = plan.organization_id
          and document.membership_id = plan.membership_id
          and document.document_type in ('experience_letter', 'relieving_letter')
          and document.status = 'issued'
      ) as generated_exit_document_count,
      plan.created_at::text
    from public.hr_offboarding_plans as plan
    join public.memberships as membership on membership.id = plan.membership_id
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    left join public.profiles as profile on profile.id = membership.user_id
    left join public.hr_employee_profiles as employee
      on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
    left join public.memberships as replacement on replacement.id = plan.replacement_membership_id
    left join public.identity_accounts as replacement_user on replacement_user.id = replacement.user_id
    left join public.profiles as replacement_profile on replacement_profile.id = replacement.user_id
    left join public.hr_employee_profiles as replacement_employee
      on replacement_employee.membership_id = replacement.id
     and replacement_employee.organization_id = replacement.organization_id
    where plan.organization_id = ${organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, plan.membership_id, plan.membership_id
      )
    order by
      case plan.status when 'ready' then 1 when 'in_progress' then 2 when 'draft' then 3 when 'completed' then 4 else 5 end,
      plan.last_working_date, employee_name
    limit 500
  `;

  const planIds = planRows.map((row) => row.id);
  const itemRows = planIds.length
    ? await database<ItemRow[]>`
        select item.id, item.offboarding_plan_id, item.item_key, item.label, item.position,
          item.status, item.assigned_membership_id,
          coalesce(assignee_employee.preferred_name, assignee_employee.legal_name,
            assignee_profile.display_name,
            nullif(trim(concat_ws(' ', assignee_profile.first_name, assignee_profile.last_name)), ''),
            split_part(coalesce(assignee_user.email, ''), '@', 1)) as assigned_name,
          item.due_date::text, item.notes, item.completion_source, item.completed_at::text
        from public.hr_offboarding_items as item
        left join public.memberships as assignee on assignee.id = item.assigned_membership_id
        left join public.identity_accounts as assignee_user on assignee_user.id = assignee.user_id
        left join public.profiles as assignee_profile on assignee_profile.id = assignee.user_id
        left join public.hr_employee_profiles as assignee_employee
          on assignee_employee.membership_id = assignee.id
         and assignee_employee.organization_id = assignee.organization_id
        where item.offboarding_plan_id = any(${planIds}::uuid[])
        order by item.offboarding_plan_id, item.position
      `
    : [];

  const itemsByPlan = new Map<string, HrOffboardingItemSummary[]>();
  for (const row of itemRows) {
    const items = itemsByPlan.get(row.offboarding_plan_id) ?? [];
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
    itemsByPlan.set(row.offboarding_plan_id, items);
  }

  const plans = planRows.map((row) => {
    const items = itemsByPlan.get(row.id) ?? [];
    return {
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      employeeNumber: row.employee_number,
      cycleNumber: row.cycle_number,
      separationType: row.separation_type,
      status: row.status,
      noticeDate: row.notice_date,
      lastWorkingDate: row.last_working_date,
      reason: row.reason,
      replacementMembershipId: row.replacement_membership_id,
      replacementName: row.replacement_name,
      exitInterviewAt: row.exit_interview_at,
      exitInterviewDetails: row.exit_interview_details,
      notes: row.notes,
      membershipStatus: row.membership_status,
      lifecycleStatus: row.lifecycle_status,
      activeProjectCount: row.active_project_count,
      openTaskCount: row.open_task_count,
      outstandingExpenseCount: row.outstanding_expense_count,
      generatedExitDocumentCount: row.generated_exit_document_count,
      createdAt: row.created_at,
      items,
      progress: offboardingProgress(items),
      isSelf: row.membership_id === context.membership.id,
    } satisfies HrOffboardingPlanSummary;
  });

  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setUTCDate(sevenDaysFromNow.getUTCDate() + 7);
  const sevenDayKey = sevenDaysFromNow.toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);

  return {
    plans,
    summary: {
      total: plans.length,
      inProgress: plans.filter((plan) => plan.status === "in_progress").length,
      ready: plans.filter((plan) => plan.status === "ready").length,
      completed: plans.filter((plan) => plan.status === "completed").length,
      dueWithinSevenDays: plans.filter(
        (plan) =>
          plan.status !== "completed" &&
          plan.status !== "cancelled" &&
          plan.lastWorkingDate >= todayKey &&
          plan.lastWorkingDate <= sevenDayKey,
      ).length,
    },
    capabilities: { canView, canManage, canCreateOwn },
  };
}

export async function synchronizeHrOffboardingEvidence(
  sql: TransactionSql,
  input: { organizationId: string; membershipId: string; actorMembershipId: string },
): Promise<number> {
  const rows = await sql<Array<{ id: string }>>`
    with plan_scope as (
      select plan.id, plan.organization_id, plan.membership_id, plan.notice_date,
        plan.last_working_date, membership.status as membership_status,
        coalesce(employee.lifecycle_status, 'preboarding') as lifecycle_status
      from public.hr_offboarding_plans as plan
      join public.memberships as membership on membership.id = plan.membership_id
      left join public.hr_employee_profiles as employee
        on employee.membership_id = plan.membership_id
       and employee.organization_id = plan.organization_id
      where plan.organization_id = ${input.organizationId}::uuid
        and plan.membership_id = ${input.membershipId}::uuid
        and plan.status not in ('completed', 'cancelled')
      limit 1
    ), evidence as (
      select plan_scope.*,
        (
          select count(distinct project.id)::integer
          from public.projects as project
          left join public.project_members as project_member
            on project_member.project_id = project.id
           and project_member.membership_id = plan_scope.membership_id
          where project.organization_id = plan_scope.organization_id
            and project.status in ('planned', 'active', 'on_hold')
            and (project.owner_membership_id = plan_scope.membership_id or project_member.membership_id is not null)
        ) as active_project_count,
        (
          select count(distinct task.id)::integer
          from public.project_task_assignees as assignment
          join public.project_tasks as task on task.id = assignment.task_id
          join public.project_task_statuses as task_status on task_status.id = task.status_id
          where assignment.membership_id = plan_scope.membership_id
            and task.organization_id = plan_scope.organization_id
            and not task_status.is_terminal
        ) as open_task_count,
        (
          select count(*)::integer
          from public.finance_expenses as expense
          where expense.organization_id = plan_scope.organization_id
            and expense.employee_membership_id = plan_scope.membership_id
            and (expense.approval_status = 'pending' or expense.payment_status in ('unpaid', 'scheduled'))
        ) as outstanding_expense_count,
        (
          select count(distinct document.document_type)::integer
          from public.hr_employee_documents as document
          where document.organization_id = plan_scope.organization_id
            and document.membership_id = plan_scope.membership_id
            and document.document_type in ('experience_letter', 'relieving_letter')
            and document.status = 'issued'
        ) as generated_exit_document_count
      from plan_scope
    ), desired as (
      select id as plan_id, 'separation_record'::text as item_key, 'complete'::text as status,
        'Separation type, notice date, and reason are recorded.'::text as notes from evidence
      union all
      select id, 'last_working_date', 'complete', 'Last working date: ' || last_working_date::text from evidence
      union all
      select id, 'project_reassignment', case when active_project_count = 0 then 'complete' else 'blocked' end,
        case when active_project_count = 0 then 'No active project access or ownership remains.'
          else active_project_count::text || ' active project assignment(s) remain.' end from evidence
      union all
      select id, 'open_task_review', case when open_task_count = 0 then 'complete' else 'blocked' end,
        case when open_task_count = 0 then 'No open task assignments remain.'
          else open_task_count::text || ' open task assignment(s) remain.' end from evidence
      union all
      select id, 'expense_settlement', case when outstanding_expense_count = 0 then 'complete' else 'blocked' end,
        case when outstanding_expense_count = 0 then 'No unsettled employee expenses remain.'
          else outstanding_expense_count::text || ' unsettled expense(s) remain.' end from evidence
      union all
      select id, 'account_suspension', case when membership_status in ('suspended', 'deactivated') then 'complete' else 'pending' end,
        'Membership status: ' || membership_status from evidence
      union all
      select id, 'document_generation', case when generated_exit_document_count = 2 then 'complete' else 'pending' end,
        generated_exit_document_count::text || ' of 2 exit letters generated.' from evidence
      union all
      select id, 'employee_archive', case when lifecycle_status = 'archived' and membership_status = 'deactivated' then 'complete' else 'pending' end,
        'Employee lifecycle: ' || lifecycle_status || '; membership: ' || membership_status from evidence
    )
    update public.hr_offboarding_items as item
    set status = desired.status,
      notes = desired.notes,
      completion_source = 'derived',
      completed_at = case when desired.status = 'complete' then coalesce(item.completed_at, now()) else null end,
      completed_by_membership_id = case
        when desired.status = 'complete' then ${input.actorMembershipId}::uuid else null end,
      updated_by_membership_id = ${input.actorMembershipId}::uuid
    from desired
    where item.offboarding_plan_id = desired.plan_id
      and item.item_key = desired.item_key
      and (item.status, coalesce(item.notes, '')) is distinct from (desired.status, desired.notes)
    returning item.id
  `;
  return rows.length;
}
