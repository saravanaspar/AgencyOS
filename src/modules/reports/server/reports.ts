import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { financePermissionKeys } from "@/modules/finance/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { legalCompliancePermissionKeys } from "@/modules/legal/compliance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { normalizeReportWidgets } from "@/modules/reports/report-builder";
import {
  rateBps,
  reportSections,
  reportsPermissionKeys,
  resolveComparisonPeriod,
  resolveReportPeriod,
  type ReportCountRow,
  type ReportMetric,
  type ReportProjectRow,
  type ReportSection,
  type ReportsWorkspaceData,
  type ReportWorkloadRow,
} from "@/modules/reports/reports";
import type { ReportsFilters } from "@/modules/reports/schemas/reports";
import { supportPermissionKeys } from "@/modules/support/support";
import { getFounderReportPackForContext } from "@/modules/reports/server/founder-packs";

export type ReportsWorkspaceResult =
  | { allowed: true; data: ReportsWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  default_currency: string;
  number_format: string;
}
interface OptionRow {
  id: string;
  label: string;
}
interface CountRow {
  id: string;
  label: string;
  count: string | number;
  secondary?: string | null;
  amount_minor?: string | number | null;
  rate_bps?: string | number | null;
  average_days?: string | number | null;
}
interface SingleAggregateRow {
  count_value?: string | number;
  amount_value?: string | number;
  secondary_value?: string | number | null;
}
interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  total_tasks: string | number;
  completed_tasks: string | number;
  overdue_tasks: string | number;
  estimated_minutes: string | number;
  actual_minutes: string | number;
  revenue_minor: string | number;
  expense_minor: string | number;
}
interface WorkloadRow {
  membership_id: string;
  name: string;
  department: string | null;
  open_tasks: string | number;
  overdue_tasks: string | number;
  estimated_minutes: string | number;
  actual_minutes: string | number;
  expected_minutes: string | number;
}
interface FinanceAggregateRow {
  outstanding_minor: string | number;
  overdue_minor: string | number;
  revenue_minor: string | number;
  expenses_minor: string | number;
  tax_minor: string | number;
  issued_minor: string | number;
  paid_minor: string | number;
}
interface HrSummaryRow {
  headcount: string | number;
  exits: string | number;
  average_headcount: string | number;
}
interface SupportSummaryRow {
  open_tickets: string | number;
  average_resolution_hours: string | number | null;
  sla_breaches: string | number;
  satisfaction_responses: string | number;
  average_score: string | number | null;
}
interface LegalSummaryRow {
  active_contracts: string | number;
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function countRows(rows: readonly CountRow[]): ReportCountRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    count: toNumber(row.count),
    secondary: row.secondary ?? null,
    amountMinor: row.amount_minor == null ? null : toNumber(row.amount_minor),
    rateBps: row.rate_bps == null ? null : toNumber(row.rate_bps),
    averageDays: row.average_days == null ? null : Number(row.average_days),
  }));
}

function availableSections(context: CurrentPermissionContext): ReportSection[] {
  const sections: ReportSection[] = ["overview"];
  if (context.permissions.has(crmPermissionKeys.leadView)) sections.push("crm");
  if (
    context.permissions.has(projectPermissionKeys.projectView) ||
    context.permissions.has(projectPermissionKeys.taskView)
  ) {
    sections.push("projects");
  }
  if (context.permissions.has(financePermissionKeys.reportView)) sections.push("finance");
  if (context.permissions.has(hrPermissionKeys.employeeView)) sections.push("hr");
  if (context.permissions.has(supportPermissionKeys.view)) sections.push("support");
  if (context.permissions.has("reports.founder_pack.view")) {
    sections.push("founder_daily", "founder_weekly");
  }
  if (
    context.permissions.has(legalPermissionKeys.view) ||
    context.permissions.has(legalCompliancePermissionKeys.view)
  ) {
    sections.push("legal");
  }
  return reportSections.filter((section) => sections.includes(section));
}

async function loadOrganization(database: Sql, organizationId: string): Promise<OrganizationRow> {
  const rows = await database<OrganizationRow[]>`
    select default_currency, number_format
    from public.organizations
    where id = ${organizationId}::uuid
    limit 1
  `;
  return rows[0] ?? { default_currency: "USD", number_format: "en-US" };
}

async function loadOptions(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<ReportsWorkspaceData["options"]> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const reportScope = context.permissionScopes.get(reportsPermissionKeys.workspace) ?? "own";
  const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
  const companyScope = context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own";

  const [owners, teams, departments, projects, clients] = await Promise.all([
    database<OptionRow[]>`
      select membership.id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
          nullif(auth_user.raw_user_meta_data ->> 'name', ''), auth_user.email, 'Unknown member') as label
      from public.memberships as membership
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      where membership.organization_id = ${organizationId}::uuid
        and membership.status = 'active'
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${reportScope}, membership.id, membership.id
        )
      order by label
      limit 500
    `,
    database<OptionRow[]>`
      select team.id, team.name as label
      from public.teams as team
      where team.organization_id = ${organizationId}::uuid
        and team.status = 'active'
        and (
          ${reportScope} = 'organization'
          or exists (
            select 1 from public.team_members as mine
            where mine.team_id = team.id and mine.membership_id = ${membershipId}::uuid
          )
        )
      order by lower(team.name)
      limit 250
    `,
    database<OptionRow[]>`
      select department.id, department.name as label
      from public.departments as department
      where department.organization_id = ${organizationId}::uuid
        and department.status = 'active'
        and (
          ${reportScope} = 'organization'
          or department.id = (
            select membership.department_id from public.memberships as membership
            where membership.id = ${membershipId}::uuid
          )
        )
      order by lower(department.name)
      limit 250
    `,
    database<OptionRow[]>`
      select project.id, concat(project.code, ' · ', project.name) as label
      from public.projects as project
      where project.organization_id = ${organizationId}::uuid
        and project.archived_at is null
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
      order by lower(project.name)
      limit 500
    `,
    database<OptionRow[]>`
      select company.id, coalesce(company.display_name, company.legal_name) as label
      from public.crm_companies as company
      where company.organization_id = ${organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid, ${companyScope},
          company.account_owner_membership_id, company.created_by_membership_id
        )
      order by lower(coalesce(company.display_name, company.legal_name))
      limit 500
    `,
  ]);

  const statuses = [
    "new",
    "qualified",
    "converted",
    "lost",
    "planned",
    "active",
    "on_hold",
    "completed",
    "issued",
    "partially_paid",
    "paid",
    "overdue",
    "pending",
    "approved",
    "open",
    "resolved",
    "closed",
    "awaiting_signature",
  ].map((value) => ({ id: value, label: value.replaceAll("_", " ") }));

  return { owners, teams, departments, projects, clients, statuses };
}

async function loadCrmReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["crm"]>> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const scope = context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
  const args = [
    database<CountRow[]>`
      select coalesce(nullif(lead.source, ''), 'Unspecified') as id,
        coalesce(nullif(lead.source, ''), 'Unspecified') as label,
        count(*)::bigint as count,
        round(coalesce(sum(lead.estimated_value), 0) * 100)::bigint as amount_minor
      from public.crm_leads as lead
      left join public.memberships as owner on owner.id = lead.owner_membership_id
      where lead.organization_id = ${organizationId}::uuid
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
        and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = lead.owner_membership_id))
        and (${filters.department}::uuid is null or owner.department_id = ${filters.department}::uuid)
        and (${filters.status}::text is null or lead.status = ${filters.status})
      group by coalesce(nullif(lead.source, ''), 'Unspecified')
      order by count desc, label
      limit 50
    `,
    database<CountRow[]>`
      select lead.status as id, replace(lead.status, '_', ' ') as label,
        count(*)::bigint as count,
        round(coalesce(sum(lead.estimated_value), 0) * 100)::bigint as amount_minor
      from public.crm_leads as lead
      left join public.memberships as owner on owner.id = lead.owner_membership_id
      where lead.organization_id = ${organizationId}::uuid
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
        and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = lead.owner_membership_id))
        and (${filters.department}::uuid is null or owner.department_id = ${filters.department}::uuid)
        and (${filters.status}::text is null or lead.status = ${filters.status})
      group by lead.status
      order by count desc, lead.status
    `,
    database<CountRow[]>`
      select stage.id::text as id, stage.name as label, count(lead.id)::bigint as count,
        round(coalesce(sum(lead.estimated_value), 0) * 100)::bigint as amount_minor,
        round(avg(lead.probability) * 100)::bigint as rate_bps
      from public.crm_pipeline_stages as stage
      left join public.crm_leads as lead on lead.stage_id = stage.id
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
        and (${filters.status}::text is null or lead.status = ${filters.status})
      where stage.organization_id = ${organizationId}::uuid
      group by stage.id, stage.name, stage.position
      order by stage.position
    `,
    database<CountRow[]>`
      select coalesce(lead.owner_membership_id::text, 'unassigned') as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'Unassigned') as label,
        count(*) filter (where lead.status = 'converted')::bigint as count,
        round(coalesce(sum(lead.estimated_value) filter (where lead.status = 'converted'), 0) * 100)::bigint as amount_minor
      from public.crm_leads as lead
      left join public.memberships as owner on owner.id = lead.owner_membership_id
      left join public.identity_accounts as auth_user on auth_user.id = owner.user_id
      where lead.organization_id = ${organizationId}::uuid
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
        and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = lead.owner_membership_id))
        and (${filters.department}::uuid is null or owner.department_id = ${filters.department}::uuid)
      group by lead.owner_membership_id, auth_user.raw_user_meta_data, auth_user.email
      order by amount_minor desc, label
      limit 100
    `,
    database<CountRow[]>`
      select stage.id::text as id, stage.name as label, count(lead.id)::bigint as count,
        round(avg(extract(epoch from (coalesce(lead.converted_at, lead.updated_at) - lead.stage_entered_at)) / 86400.0), 1) as average_days
      from public.crm_pipeline_stages as stage
      join public.crm_leads as lead on lead.stage_id = stage.id
      where stage.organization_id = ${organizationId}::uuid
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
      group by stage.id, stage.name, stage.position
      order by stage.position
    `,
    database<CountRow[]>`
      select md5(coalesce(nullif(btrim(lead.lost_reason), ''), 'Unspecified')) as id,
        coalesce(nullif(btrim(lead.lost_reason), ''), 'Unspecified') as label,
        count(*)::bigint as count
      from public.crm_leads as lead
      where lead.organization_id = ${organizationId}::uuid
        and lead.status = 'lost'
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
      group by coalesce(nullif(btrim(lead.lost_reason), ''), 'Unspecified')
      order by count desc, label
      limit 50
    `,
    database<SingleAggregateRow[]>`
      select count(*) filter (where lead.status in ('converted', 'lost'))::bigint as count_value,
        count(*) filter (where lead.status = 'converted')::bigint as secondary_value
      from public.crm_leads as lead
      where lead.organization_id = ${organizationId}::uuid
        and lead.created_at::date between ${filters.from}::date and ${filters.to}::date
        and private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id)
        and (${filters.owner}::uuid is null or lead.owner_membership_id = ${filters.owner}::uuid)
    `,
  ] as const;
  const [source, status, stage, owner, time, lost, conversionRows] = await Promise.all(args);
  const eligible = toNumber(conversionRows[0]?.count_value);
  const converted = toNumber(conversionRows[0]?.secondary_value);
  return {
    leadsBySource: countRows(source),
    leadsByStatus: countRows(status),
    pipelineByStage: countRows(stage),
    salesByOwner: countRows(owner),
    timeInStage: countRows(time),
    lostReasons: countRows(lost),
    conversion: { eligible, converted, rateBps: rateBps(converted, eligible) },
  };
}

async function loadProjectReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["projects"]>> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
  const taskScope = context.permissionScopes.get(projectPermissionKeys.taskView) ?? projectScope;
  const timeScope = context.permissionScopes.get(projectPermissionKeys.timeView) ?? projectScope;

  const [projectRows, workloadRows] = await Promise.all([
    database<ProjectRow[]>`
      with visible_projects as (
        select project.*
        from public.projects as project
        left join public.memberships as owner on owner.id = project.owner_membership_id
        where project.organization_id = ${organizationId}::uuid
          and project.archived_at is null
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
          and (${filters.owner}::uuid is null or project.owner_membership_id = ${filters.owner}::uuid)
          and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = project.owner_membership_id))
          and (${filters.department}::uuid is null or owner.department_id = ${filters.department}::uuid)
          and (${filters.project}::uuid is null or project.id = ${filters.project}::uuid)
          and (${filters.client}::uuid is null or project.company_id = ${filters.client}::uuid)
          and (${filters.status}::text is null or project.status = ${filters.status})
      ), task_totals as (
        select task.project_id,
          count(*)::bigint as total_tasks,
          count(*) filter (where status.is_terminal and not status.is_cancelled)::bigint as completed_tasks,
          count(*) filter (where not status.is_terminal and task.due_date < current_date)::bigint as overdue_tasks,
          coalesce(sum(task.estimated_minutes), 0)::bigint as estimated_minutes
        from public.project_tasks as task
        join public.project_task_statuses as status on status.id = task.status_id
        join visible_projects as project on project.id = task.project_id
        where private.project_is_visible(project.id, ${membershipId}::uuid, ${taskScope})
        group by task.project_id
      ), time_totals as (
        select entry.project_id, coalesce(sum(entry.minutes), 0)::bigint as actual_minutes
        from public.project_time_entries as entry
        join visible_projects as project on project.id = entry.project_id
        where entry.work_date between ${filters.from}::date and ${filters.to}::date
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${timeScope})
        group by entry.project_id
      ), revenue as (
        select invoice.project_id,
          coalesce(sum(invoice.subtotal_minor - invoice.discount_minor), 0)::bigint as revenue_minor
        from public.finance_invoices as invoice
        join visible_projects as project on project.id = invoice.project_id
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${filters.from}::date and ${filters.to}::date
        group by invoice.project_id
      ), expense as (
        select allocation.project_id,
          coalesce(sum(allocation.amount_minor), 0)::bigint as expense_minor
        from public.finance_expense_project_allocations as allocation
        join public.finance_expenses as expense on expense.id = allocation.expense_id
        join visible_projects as project on project.id = allocation.project_id
        join public.organizations as organization on organization.id = expense.organization_id
        where expense.currency = organization.default_currency
          and expense.approval_status = 'approved'
          and expense.expense_date between ${filters.from}::date and ${filters.to}::date
        group by allocation.project_id
      )
      select project.id, project.code, project.name, project.status,
        coalesce(task.total_tasks, 0)::bigint as total_tasks,
        coalesce(task.completed_tasks, 0)::bigint as completed_tasks,
        coalesce(task.overdue_tasks, 0)::bigint as overdue_tasks,
        coalesce(task.estimated_minutes, 0)::bigint as estimated_minutes,
        coalesce(time.actual_minutes, 0)::bigint as actual_minutes,
        coalesce(revenue.revenue_minor, 0)::bigint as revenue_minor,
        coalesce(expense.expense_minor, 0)::bigint as expense_minor
      from visible_projects as project
      left join task_totals as task on task.project_id = project.id
      left join time_totals as time on time.project_id = project.id
      left join revenue on revenue.project_id = project.id
      left join expense on expense.project_id = project.id
      order by overdue_tasks desc, lower(project.name)
      limit 500
    `,
    database<WorkloadRow[]>`
      with visible_projects as (
        select project.id
        from public.projects as project
        where project.organization_id = ${organizationId}::uuid
          and project.archived_at is null
          and private.project_is_visible(project.id, ${membershipId}::uuid, ${projectScope})
          and (${filters.project}::uuid is null or project.id = ${filters.project}::uuid)
          and (${filters.client}::uuid is null or project.company_id = ${filters.client}::uuid)
      ), members as (
        select membership.id, membership.department_id,
          coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'Unknown member') as name,
          department.name as department,
          coalesce(profile.weekly_hours, 40)::numeric as weekly_hours
        from public.memberships as membership
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.departments as department on department.id = membership.department_id
        left join public.hr_employee_profiles as profile on profile.membership_id = membership.id
        where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
          and private.crm_scope_allows_membership(${membershipId}::uuid, ${timeScope}, membership.id, membership.id)
          and (${filters.owner}::uuid is null or membership.id = ${filters.owner}::uuid)
          and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = membership.id))
          and (${filters.department}::uuid is null or membership.department_id = ${filters.department}::uuid)
      ), task_totals as (
        select assignee.membership_id,
          count(*) filter (where not status.is_terminal)::bigint as open_tasks,
          count(*) filter (where not status.is_terminal and task.due_date < current_date)::bigint as overdue_tasks,
          coalesce(sum(task.estimated_minutes) filter (where not status.is_terminal), 0)::bigint as estimated_minutes
        from public.project_task_assignees as assignee
        join public.project_tasks as task on task.id = assignee.task_id
        join public.project_task_statuses as status on status.id = task.status_id
        join visible_projects as project on project.id = task.project_id
        group by assignee.membership_id
      ), time_totals as (
        select entry.membership_id, coalesce(sum(entry.minutes), 0)::bigint as actual_minutes
        from public.project_time_entries as entry
        join visible_projects as project on project.id = entry.project_id
        where entry.work_date between ${filters.from}::date and ${filters.to}::date
        group by entry.membership_id
      )
      select member.id as membership_id, member.name, member.department,
        coalesce(task.open_tasks, 0)::bigint as open_tasks,
        coalesce(task.overdue_tasks, 0)::bigint as overdue_tasks,
        coalesce(task.estimated_minutes, 0)::bigint as estimated_minutes,
        coalesce(time.actual_minutes, 0)::bigint as actual_minutes,
        round(member.weekly_hours * 60 * greatest(1, (${filters.to}::date - ${filters.from}::date + 1)) / 7.0)::bigint as expected_minutes
      from members as member
      left join task_totals as task on task.membership_id = member.id
      left join time_totals as time on time.membership_id = member.id
      order by overdue_tasks desc, open_tasks desc, lower(member.name)
      limit 500
    `,
  ]);

  const projects: ReportProjectRow[] = projectRows.map((row) => {
    const totalTasks = toNumber(row.total_tasks);
    const completedTasks = toNumber(row.completed_tasks);
    const revenueMinor = toNumber(row.revenue_minor);
    const expenseMinor = toNumber(row.expense_minor);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      progress: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalTasks,
      completedTasks,
      overdueTasks: toNumber(row.overdue_tasks),
      estimatedMinutes: toNumber(row.estimated_minutes),
      actualMinutes: toNumber(row.actual_minutes),
      revenueMinor,
      expenseMinor,
      grossProfitMinor: revenueMinor - expenseMinor,
    };
  });
  const workload: ReportWorkloadRow[] = workloadRows.map((row) => ({
    membershipId: row.membership_id,
    name: row.name,
    department: row.department,
    openTasks: toNumber(row.open_tasks),
    overdueTasks: toNumber(row.overdue_tasks),
    estimatedMinutes: toNumber(row.estimated_minutes),
    actualMinutes: toNumber(row.actual_minutes),
    utilizationBps: rateBps(toNumber(row.actual_minutes), toNumber(row.expected_minutes)),
  }));
  const totalTasks = projects.reduce((sum, row) => sum + row.totalTasks, 0);
  const completedTasks = projects.reduce((sum, row) => sum + row.completedTasks, 0);
  const actualMinutes = workload.reduce((sum, row) => sum + row.actualMinutes, 0);
  const expectedMinutes = workload.reduce(
    (sum, row) =>
      sum +
      (row.utilizationBps ? Math.round((row.actualMinutes * 10_000) / row.utilizationBps) : 0),
    0,
  );
  return {
    projects,
    workload,
    overdueProjects: projects.filter((row) => row.overdueTasks > 0).length,
    taskCompletionRateBps: rateBps(completedTasks, totalTasks),
    utilizationBps: rateBps(actualMinutes, expectedMinutes),
  };
}

async function loadFinanceReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["finance"]>> {
  const organizationId = context.membership.organizationId;
  const [summaryRows, monthRows, clientRows, expenseRows] = await Promise.all([
    database<FinanceAggregateRow[]>`
      with invoice_totals as (
        select
          coalesce(sum(invoice.subtotal_minor - invoice.discount_minor), 0)::bigint as revenue_minor,
          coalesce(sum(invoice.tax_minor), 0)::bigint as tax_minor,
          coalesce(sum(invoice.balance_minor) filter (where invoice.status not in ('paid', 'void', 'credited')), 0)::bigint as outstanding_minor,
          coalesce(sum(invoice.balance_minor) filter (where invoice.status not in ('paid', 'void', 'credited') and invoice.due_date < current_date), 0)::bigint as overdue_minor,
          coalesce(sum(invoice.total_minor), 0)::bigint as issued_minor,
          coalesce(sum(invoice.amount_paid_minor), 0)::bigint as paid_minor
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${filters.from}::date and ${filters.to}::date
          and (${filters.project}::uuid is null or invoice.project_id = ${filters.project}::uuid)
          and (${filters.client}::uuid is null or invoice.company_id = ${filters.client}::uuid)
          and (${filters.status}::text is null or invoice.status = ${filters.status})
      ), expense_totals as (
        select coalesce(sum(expense.total_minor), 0)::bigint as expenses_minor
        from public.finance_expenses as expense
        join public.organizations as organization on organization.id = expense.organization_id
        where expense.organization_id = ${organizationId}::uuid
          and expense.currency = organization.default_currency
          and expense.approval_status = 'approved'
          and expense.expense_date between ${filters.from}::date and ${filters.to}::date
          and (${filters.project}::uuid is null or exists (
            select 1 from public.finance_expense_project_allocations allocation
            where allocation.expense_id = expense.id and allocation.project_id = ${filters.project}::uuid
          ))
      )
      select invoice.outstanding_minor, invoice.overdue_minor, invoice.revenue_minor,
        expense.expenses_minor, invoice.tax_minor, invoice.issued_minor, invoice.paid_minor
      from invoice_totals invoice cross join expense_totals expense
    `,
    database<CountRow[]>`
      with months as (
        select generate_series(date_trunc('month', ${filters.from}::date), date_trunc('month', ${filters.to}::date), interval '1 month')::date as month
      ), totals as (
        select date_trunc('month', invoice.issue_date)::date as month,
          sum(invoice.subtotal_minor - invoice.discount_minor)::bigint as amount_minor,
          count(*)::bigint as count
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${filters.from}::date and ${filters.to}::date
          and (${filters.project}::uuid is null or invoice.project_id = ${filters.project}::uuid)
          and (${filters.client}::uuid is null or invoice.company_id = ${filters.client}::uuid)
        group by date_trunc('month', invoice.issue_date)::date
      )
      select months.month::text as id, to_char(months.month, 'Mon YYYY') as label,
        coalesce(totals.count, 0)::bigint as count,
        coalesce(totals.amount_minor, 0)::bigint as amount_minor
      from months left join totals on totals.month = months.month
      order by months.month
    `,
    database<CountRow[]>`
      select company.id::text as id, coalesce(company.display_name, company.legal_name) as label,
        count(invoice.id)::bigint as count,
        coalesce(sum(invoice.balance_minor), 0)::bigint as amount_minor
      from public.crm_companies as company
      join public.finance_invoices as invoice on invoice.company_id = company.id
      join public.organizations as organization on organization.id = invoice.organization_id
      where company.organization_id = ${organizationId}::uuid
        and invoice.issued_at is not null and invoice.status not in ('paid', 'void', 'credited')
        and invoice.currency = organization.default_currency
        and invoice.issue_date between ${filters.from}::date and ${filters.to}::date
        and (${filters.client}::uuid is null or company.id = ${filters.client}::uuid)
        and (${filters.project}::uuid is null or invoice.project_id = ${filters.project}::uuid)
      group by company.id, company.display_name, company.legal_name
      having sum(invoice.balance_minor) <> 0
      order by amount_minor desc, label
      limit 250
    `,
    database<CountRow[]>`
      select category.id::text as id, category.name as label, count(expense.id)::bigint as count,
        coalesce(sum(expense.total_minor), 0)::bigint as amount_minor
      from public.finance_expense_categories as category
      join public.finance_expenses as expense on expense.category_id = category.id
      join public.organizations as organization on organization.id = expense.organization_id
      where category.organization_id = ${organizationId}::uuid
        and expense.currency = organization.default_currency
        and expense.approval_status = 'approved'
        and expense.expense_date between ${filters.from}::date and ${filters.to}::date
      group by category.id, category.name
      order by amount_minor desc, lower(category.name)
      limit 100
    `,
  ]);
  const row = summaryRows[0] ?? {
    outstanding_minor: 0,
    overdue_minor: 0,
    revenue_minor: 0,
    expenses_minor: 0,
    tax_minor: 0,
    issued_minor: 0,
    paid_minor: 0,
  };
  const revenueMinor = toNumber(row.revenue_minor);
  const expensesMinor = toNumber(row.expenses_minor);
  return {
    revenueByMonth: countRows(monthRows),
    clientBalances: countRows(clientRows),
    expenseBreakdown: countRows(expenseRows),
    outstandingMinor: toNumber(row.outstanding_minor),
    overdueMinor: toNumber(row.overdue_minor),
    revenueMinor,
    expensesMinor,
    grossProfitMinor: revenueMinor - expensesMinor,
    taxMinor: toNumber(row.tax_minor),
    collectionRateBps: rateBps(toNumber(row.paid_minor), toNumber(row.issued_minor)),
  };
}

async function loadHrReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["hr"]>> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const scope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
  const memberFilter = database`
    private.crm_scope_allows_membership(${membershipId}::uuid, ${scope}, membership.id, membership.id)
    and (${filters.owner}::uuid is null or membership.id = ${filters.owner}::uuid)
    and (${filters.team}::uuid is null or exists (select 1 from public.team_members tm where tm.team_id = ${filters.team}::uuid and tm.membership_id = membership.id))
    and (${filters.department}::uuid is null or membership.department_id = ${filters.department}::uuid)
  `;
  const [
    summaryRows,
    departmentRows,
    attendanceRows,
    leaveRows,
    probationRows,
    documentRows,
    assetRows,
  ] = await Promise.all([
    database<HrSummaryRow[]>`
      with scoped_members as (
        select membership.id
        from public.memberships as membership
        where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
          and ${memberFilter}
      ), exits as (
        select count(*)::bigint as exits
        from public.hr_offboarding_plans as plan
        join scoped_members as member on member.id = plan.membership_id
        where plan.status = 'completed'
          and plan.last_working_date between ${filters.from}::date and ${filters.to}::date
      )
      select count(*)::bigint as headcount,
        (select exits from exits)::bigint as exits,
        count(*)::bigint as average_headcount
      from scoped_members
    `,
    database<CountRow[]>`
      select coalesce(department.id::text, 'unassigned') as id,
        coalesce(department.name, 'Unassigned') as label, count(*)::bigint as count
      from public.memberships as membership
      left join public.departments as department on department.id = membership.department_id
      where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
        and ${memberFilter}
      group by department.id, department.name
      order by count desc, label
    `,
    database<CountRow[]>`
      select attendance.attendance_status as id, replace(attendance.attendance_status, '_', ' ') as label,
        count(*)::bigint as count,
        sum(attendance.late_minutes + attendance.early_departure_minutes)::bigint as amount_minor
      from public.hr_attendance_records as attendance
      join public.memberships as membership on membership.id = attendance.membership_id
      where attendance.organization_id = ${organizationId}::uuid
        and attendance.attendance_date between ${filters.from}::date and ${filters.to}::date
        and ${memberFilter}
      group by attendance.attendance_status
      order by count desc, attendance.attendance_status
    `,
    database<CountRow[]>`
      select leave_type.id::text as id, leave_type.name as label,
        count(request.id)::bigint as count,
        coalesce(sum(request.requested_days), 0)::numeric as average_days
      from public.hr_leave_types as leave_type
      join public.hr_leave_requests as request on request.leave_type_id = leave_type.id
      join public.memberships as membership on membership.id = request.membership_id
      where leave_type.organization_id = ${organizationId}::uuid
        and request.status = 'approved'
        and request.start_date <= ${filters.to}::date and request.end_date >= ${filters.from}::date
        and ${memberFilter}
      group by leave_type.id, leave_type.name
      order by average_days desc, lower(leave_type.name)
    `,
    database<CountRow[]>`
      select plan.id::text as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'Unknown member') as label,
        1::bigint as count, plan.probation_review_date::text as secondary
      from public.hr_onboarding_plans as plan
      join public.memberships as membership on membership.id = plan.membership_id
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      where plan.organization_id = ${organizationId}::uuid
        and plan.status not in ('completed', 'cancelled')
        and plan.probation_review_date between ${filters.from}::date and ${filters.to}::date
        and ${memberFilter}
      order by plan.probation_review_date
      limit 250
    `,
    database<CountRow[]>`
      select document.id::text as id, document.title as label, 1::bigint as count,
        document.expiry_date::text as secondary
      from public.hr_employee_supporting_documents as document
      join public.memberships as membership on membership.id = document.membership_id
      where document.organization_id = ${organizationId}::uuid
        and document.status = 'current' and document.expiry_date is not null
        and document.expiry_date between ${filters.from}::date and ${filters.to}::date
        and ${memberFilter}
      order by document.expiry_date
      limit 250
    `,
    database<CountRow[]>`
      select membership.id::text as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'Unknown member') as label,
        count(assignment.id)::bigint as count
      from public.asset_assignments as assignment
      join public.memberships as membership on membership.id = assignment.membership_id
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      where assignment.organization_id = ${organizationId}::uuid and assignment.returned_at is null
        and ${memberFilter}
      group by membership.id, auth_user.raw_user_meta_data, auth_user.email
      order by count desc, label
      limit 250
    `,
  ]);
  const summary = summaryRows[0] ?? { headcount: 0, exits: 0, average_headcount: 0 };
  const exits = toNumber(summary.exits);
  const averageHeadcount = toNumber(summary.average_headcount);
  return {
    headcount: toNumber(summary.headcount),
    departments: countRows(departmentRows),
    attendance: countRows(attendanceRows),
    leave: countRows(leaveRows),
    turnover: { exits, averageHeadcount, rateBps: rateBps(exits, averageHeadcount) },
    probationReviews: countRows(probationRows),
    expiringDocuments: countRows(documentRows),
    assetAssignments: countRows(assetRows),
  };
}

async function loadSupportReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["support"]>> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const base = database`
    ticket.organization_id = ${organizationId}::uuid
    and ticket.created_at::date between ${filters.from}::date and ${filters.to}::date
    and private.support_ticket_membership_access_allowed(ticket.id, ${membershipId}::uuid, ${supportPermissionKeys.view})
    and (${filters.owner}::uuid is null or ticket.assigned_agent_membership_id = ${filters.owner}::uuid)
    and (${filters.team}::uuid is null or ticket.assigned_team_id = ${filters.team}::uuid)
    and (${filters.project}::uuid is null or ticket.project_id = ${filters.project}::uuid)
    and (${filters.client}::uuid is null or ticket.client_company_id = ${filters.client}::uuid)
    and (${filters.status}::text is null or ticket.status = ${filters.status})
  `;
  const [summaryRows, categoryRows, clientRows, agentRows] = await Promise.all([
    database<SupportSummaryRow[]>`
      select count(*) filter (where ticket.status not in ('resolved', 'closed'))::bigint as open_tickets,
        round(avg(extract(epoch from (ticket.resolved_at - ticket.created_at)) / 3600.0) filter (where ticket.resolved_at is not null), 1) as average_resolution_hours,
        count(*) filter (where (ticket.first_responded_at is null and ticket.first_response_due_at < now()) or (ticket.resolved_at is null and ticket.status <> 'pending_customer' and ticket.resolution_due_at < now()))::bigint as sla_breaches,
        count(ticket.satisfaction_score)::bigint as satisfaction_responses,
        round(avg(ticket.satisfaction_score), 2) as average_score
      from public.support_tickets as ticket
      where ${base}
    `,
    database<CountRow[]>`
      select coalesce(category.id::text, 'uncategorized') as id,
        coalesce(category.name, 'Uncategorized') as label, count(*)::bigint as count
      from public.support_tickets as ticket
      left join public.support_ticket_categories as category on category.id = ticket.category_id
      where ${base}
      group by category.id, category.name
      order by count desc, label
    `,
    database<CountRow[]>`
      select coalesce(company.id::text, 'no-client') as id,
        coalesce(company.display_name, company.legal_name, 'No client') as label,
        count(*)::bigint as count
      from public.support_tickets as ticket
      left join public.crm_companies as company on company.id = ticket.client_company_id
      where ${base}
      group by company.id, company.display_name, company.legal_name
      order by count desc, label
      limit 100
    `,
    database<CountRow[]>`
      select coalesce(agent.id::text, 'unassigned') as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email, 'Unassigned') as label,
        count(*) filter (where ticket.status not in ('resolved', 'closed'))::bigint as count,
        count(*) filter (where ticket.resolution_due_at < now() and ticket.status not in ('resolved', 'closed', 'pending_customer'))::bigint as amount_minor
      from public.support_tickets as ticket
      left join public.memberships as agent on agent.id = ticket.assigned_agent_membership_id
      left join public.identity_accounts as auth_user on auth_user.id = agent.user_id
      where ${base}
      group by agent.id, auth_user.raw_user_meta_data, auth_user.email
      order by count desc, label
      limit 100
    `,
  ]);
  const summary = summaryRows[0] ?? {
    open_tickets: 0,
    average_resolution_hours: null,
    sla_breaches: 0,
    satisfaction_responses: 0,
    average_score: null,
  };
  return {
    openTickets: toNumber(summary.open_tickets),
    averageResolutionHours:
      summary.average_resolution_hours == null ? null : Number(summary.average_resolution_hours),
    slaBreaches: toNumber(summary.sla_breaches),
    byCategory: countRows(categoryRows),
    byClient: countRows(clientRows),
    agentWorkload: countRows(agentRows),
    satisfaction: {
      responses: toNumber(summary.satisfaction_responses),
      averageScore: summary.average_score == null ? null : Number(summary.average_score),
    },
  };
}

async function loadLegalReport(
  database: Sql,
  context: CurrentPermissionContext,
  filters: ReportsWorkspaceData["filters"],
): Promise<NonNullable<ReportsWorkspaceData["legal"]>> {
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const canViewContracts = context.permissions.has(legalPermissionKeys.view);
  const canViewRecords = context.permissions.has(legalCompliancePermissionKeys.view);
  const [summaryRows, expiringRows, signatureRows, renewalRows, accessRows, licenceRows] =
    await Promise.all([
      canViewContracts
        ? database<LegalSummaryRow[]>`
          select count(*)::bigint as active_contracts
          from public.legal_contracts as contract
          where contract.organization_id = ${organizationId}::uuid
            and contract.status = 'active' and contract.deleted_at is null
            and private.legal_contract_membership_access_allowed(contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view})
            and (${filters.owner}::uuid is null or contract.responsible_owner_membership_id = ${filters.owner}::uuid)
            and (${filters.department}::uuid is null or contract.department_id = ${filters.department}::uuid)
            and (${filters.client}::uuid is null or contract.counterparty_company_id = ${filters.client}::uuid)
        `
        : Promise.resolve([] as LegalSummaryRow[]),
      canViewContracts
        ? database<CountRow[]>`
          select contract.id::text as id, contract.title as label, 1::bigint as count,
            contract.end_date::text as secondary
          from public.legal_contracts as contract
          where contract.organization_id = ${organizationId}::uuid
            and contract.status = 'active' and contract.deleted_at is null
            and contract.end_date between ${filters.from}::date and ${filters.to}::date
            and private.legal_contract_membership_access_allowed(contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view})
            and (${filters.owner}::uuid is null or contract.responsible_owner_membership_id = ${filters.owner}::uuid)
            and (${filters.department}::uuid is null or contract.department_id = ${filters.department}::uuid)
            and (${filters.client}::uuid is null or contract.counterparty_company_id = ${filters.client}::uuid)
          order by contract.end_date
          limit 250
        `
        : Promise.resolve([] as CountRow[]),
      canViewContracts
        ? database<CountRow[]>`
          select contract.id::text as id, contract.title as label, 1::bigint as count,
            replace(contract.signature_status, '_', ' ') as secondary
          from public.legal_contracts as contract
          where contract.organization_id = ${organizationId}::uuid
            and contract.status in ('approved', 'awaiting_signature') and contract.signature_status <> 'signed'
            and contract.deleted_at is null
            and private.legal_contract_membership_access_allowed(contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view})
          order by contract.updated_at desc
          limit 250
        `
        : Promise.resolve([] as CountRow[]),
      canViewContracts
        ? database<CountRow[]>`
          select contract.id::text as id, contract.title as label, 1::bigint as count,
            contract.renewal_date::text as secondary
          from public.legal_contracts as contract
          where contract.organization_id = ${organizationId}::uuid
            and contract.status = 'active' and contract.deleted_at is null
            and contract.renewal_date between ${filters.from}::date and ${filters.to}::date
            and private.legal_contract_membership_access_allowed(contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view})
          order by contract.renewal_date
          limit 250
        `
        : Promise.resolve([] as CountRow[]),
      canViewContracts
        ? database<CountRow[]>`
          select to_char(event.created_at, 'YYYY-MM') as id, to_char(event.created_at, 'Mon YYYY') as label,
            count(*)::bigint as count
          from public.private_file_events as event
          join public.private_files as file on file.id = event.file_id
          where event.organization_id = ${organizationId}::uuid
            and event.created_at::date between ${filters.from}::date and ${filters.to}::date
            and event.event_type in ('file.downloaded', 'file.previewed')
            and file.classification = 'restricted'
            and (
              (file.entity_type = 'legal_contract' and private.legal_contract_membership_access_allowed(
                file.entity_id, ${membershipId}::uuid, ${legalPermissionKeys.view}
              ))
              or (file.entity_type = 'legal_compliance_record' and private.legal_compliance_record_membership_access_allowed(
                file.entity_id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.view}
              ))
            )
          group by to_char(event.created_at, 'YYYY-MM'), to_char(event.created_at, 'Mon YYYY')
          order by id
        `
        : Promise.resolve([] as CountRow[]),
      canViewRecords
        ? database<CountRow[]>`
          select record.id::text as id, record.title as label, 1::bigint as count,
            record.expiry_date::text as secondary
          from public.legal_compliance_records as record
          where record.organization_id = ${organizationId}::uuid
            and record.status = 'active' and record.record_type = 'licence'
            and record.deleted_at is null
            and record.expiry_date between ${filters.from}::date and ${filters.to}::date
            and private.legal_compliance_record_membership_access_allowed(record.id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.view})
          order by record.expiry_date
          limit 250
        `
        : Promise.resolve([] as CountRow[]),
    ]);
  return {
    activeContracts: toNumber(summaryRows[0]?.active_contracts),
    expiringContracts: countRows(expiringRows),
    pendingSignatures: countRows(signatureRows),
    renewalObligations: countRows(renewalRows),
    restrictedAccessEvents: countRows(accessRows),
    licenceExpirations: countRows(licenceRows),
  };
}

async function comparisonRevenue(
  database: Sql,
  organizationId: string,
  period: { from: string; to: string } | null,
): Promise<number | null> {
  if (!period) return null;
  const rows = await database<SingleAggregateRow[]>`
    select coalesce(sum(invoice.subtotal_minor - invoice.discount_minor), 0)::bigint as amount_value
    from public.finance_invoices as invoice
    join public.organizations as organization on organization.id = invoice.organization_id
    where invoice.organization_id = ${organizationId}::uuid
      and invoice.issued_at is not null and invoice.status <> 'void'
      and invoice.currency = organization.default_currency
      and invoice.issue_date between ${period.from}::date and ${period.to}::date
  `;
  return toNumber(rows[0]?.amount_value);
}

function summaryMetrics(data: {
  crm: ReportsWorkspaceData["crm"];
  projects: ReportsWorkspaceData["projects"];
  finance: ReportsWorkspaceData["finance"];
  hr: ReportsWorkspaceData["hr"];
  support: ReportsWorkspaceData["support"];
  legal: ReportsWorkspaceData["legal"];
  comparisonRevenueMinor: number | null;
}): ReportMetric[] {
  const metrics: ReportMetric[] = [];
  if (data.finance) {
    metrics.push(
      {
        id: "revenue",
        label: "Revenue",
        value: data.finance.revenueMinor,
        unit: "minor",
        comparisonValue: data.comparisonRevenueMinor,
        href: "/reports?section=finance",
      },
      {
        id: "gross-profit",
        label: "Gross profit",
        value: data.finance.grossProfitMinor,
        unit: "minor",
        comparisonValue: null,
        href: "/reports?section=finance",
      },
      {
        id: "overdue-invoices",
        label: "Overdue invoices",
        value: data.finance.overdueMinor,
        unit: "minor",
        comparisonValue: null,
        href: "/finance?tab=invoices",
      },
    );
  }
  if (data.crm)
    metrics.push({
      id: "lead-conversion",
      label: "Lead conversion",
      value: data.crm.conversion.rateBps,
      unit: "bps",
      comparisonValue: null,
      href: "/reports?section=crm",
    });
  if (data.projects)
    metrics.push({
      id: "overdue-projects",
      label: "Projects needing attention",
      value: data.projects.overdueProjects,
      unit: "count",
      comparisonValue: null,
      href: "/reports?section=projects",
    });
  if (data.hr)
    metrics.push({
      id: "headcount",
      label: "Active headcount",
      value: data.hr.headcount,
      unit: "count",
      comparisonValue: null,
      href: "/reports?section=hr",
    });
  if (data.support)
    metrics.push({
      id: "open-support",
      label: "Open support tickets",
      value: data.support.openTickets,
      unit: "count",
      comparisonValue: null,
      href: "/reports?section=support",
    });
  if (data.legal)
    metrics.push({
      id: "active-contracts",
      label: "Active contracts",
      value: data.legal.activeContracts,
      unit: "count",
      comparisonValue: null,
      href: "/reports?section=legal",
    });
  return metrics.slice(0, 8);
}

export async function getReportsWorkspaceDataForContext(
  context: CurrentPermissionContext,
  filters: ReportsFilters,
  options: { widgetKeys?: readonly string[]; savedViewId?: string | null } = {},
): Promise<ReportsWorkspaceResult> {
  if (!context.permissions.has(reportsPermissionKeys.workspace)) {
    return { allowed: false, reason: "insufficient-permission" };
  }
  const database = getDatabaseClient();
  const period = resolveReportPeriod(filters);
  const comparisonPeriod = resolveComparisonPeriod(period, filters.comparison);
  const normalizedFilters: ReportsWorkspaceData["filters"] = {
    from: period.from,
    to: period.to,
    comparison: filters.comparison,
    section: filters.section,
    owner: filters.owner,
    team: filters.team,
    department: filters.department,
    project: filters.project,
    client: filters.client,
    status: filters.status,
  };
  const sections = availableSections(context);
  const organizationId = context.membership.organizationId;

  const result = await withInfrastructureRetry(
    async () => {
      const [
        organization,
        options,
        crm,
        projects,
        finance,
        hr,
        support,
        legal,
        priorRevenue,
        founderPack,
      ] = await Promise.all([
        loadOrganization(database, organizationId),
        loadOptions(database, context),
        sections.includes("crm")
          ? loadCrmReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("projects")
          ? loadProjectReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("finance")
          ? loadFinanceReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("hr")
          ? loadHrReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("support")
          ? loadSupportReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("legal")
          ? loadLegalReport(database, context, normalizedFilters)
          : Promise.resolve(null),
        sections.includes("finance")
          ? comparisonRevenue(database, organizationId, comparisonPeriod)
          : Promise.resolve(null),
        normalizedFilters.section === "founder_daily" ||
        normalizedFilters.section === "founder_weekly"
          ? getFounderReportPackForContext(
              context,
              normalizedFilters.section === "founder_daily" ? "daily" : "weekly",
            )
          : Promise.resolve(null),
      ]);
      return {
        organization,
        options,
        crm,
        projects,
        finance,
        hr,
        support,
        legal,
        priorRevenue,
        founderPack,
      };
    },
    { attempts: 2, operationName: "Reports workspace loading" },
  );

  return {
    allowed: true,
    data: {
      filters: normalizedFilters,
      comparisonPeriod,
      locale: result.organization.number_format,
      currency: result.organization.default_currency,
      generatedAt: new Date().toISOString(),
      activeWidgetKeys: normalizeReportWidgets(normalizedFilters.section, options.widgetKeys),
      savedViewId: options.savedViewId ?? null,
      options: result.options,
      capabilities: {
        canExport: context.permissions.has(reportsPermissionKeys.export),
        canManageSavedViews: context.permissions.has(reportsPermissionKeys.savedViewManage),
        canSchedule: context.permissions.has(reportsPermissionKeys.scheduleManage),
        canCreateSnapshot: context.permissions.has(reportsPermissionKeys.snapshotCreate),
        sections,
      },
      founderPack: result.founderPack,
      summary: summaryMetrics({
        crm: result.crm,
        projects: result.projects,
        finance: result.finance,
        hr: result.hr,
        support: result.support,
        legal: result.legal,
        comparisonRevenueMinor: result.priorRevenue,
      }),
      crm: result.crm,
      projects: result.projects,
      finance: result.finance,
      hr: result.hr,
      support: result.support,
      legal: result.legal,
    },
  };
}

export async function getReportsWorkspaceData(
  filters: ReportsFilters,
  options: { widgetKeys?: readonly string[]; savedViewId?: string | null } = {},
): Promise<ReportsWorkspaceResult> {
  const authorization = await authorizeCurrentUser([reportsPermissionKeys.workspace]);
  if (!authorization.allowed) return authorization;
  return getReportsWorkspaceDataForContext(authorization.context, filters, options);
}

export async function auditReportExport(
  database: Sql,
  context: CurrentPermissionContext,
  input: { section: ReportSection; filters: ReportsWorkspaceData["filters"]; rowCount: number },
): Promise<void> {
  await writeAuditEvent(database, context, {
    action: "reports.exported",
    entityType: "report",
    entityId: input.section,
    source: "api",
    metadata: {
      section: input.section,
      from: input.filters.from,
      to: input.filters.to,
      comparison: input.filters.comparison,
      owner: input.filters.owner,
      team: input.filters.team,
      department: input.filters.department,
      project: input.filters.project,
      client: input.filters.client,
      status: input.filters.status,
      rowCount: input.rowCount,
      format: "csv",
    },
  });
}
