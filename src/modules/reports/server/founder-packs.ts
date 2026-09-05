import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { financePermissionKeys } from "@/modules/finance/finance";
import { getCashForecastForContext } from "@/modules/finance/server/cash-forecast";
import { getCrmForecastDataForContext } from "@/modules/crm/server/forecast";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { getProjectProfitabilityForContext } from "@/modules/projects/server/profitability";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { resolveReportPeriod, type FounderReportPack } from "@/modules/reports/reports";
import { supportPermissionKeys } from "@/modules/support/support";
import { getClientConcentrationForContext } from "@/modules/reports/server/client-concentration";
import {
  block,
  concentrationRows,
  crmHref,
  financeHref,
  majorMoney,
  number,
  percent,
  previousCalendarMonth,
  reportHref,
  row,
  shiftPeriod,
} from "@/modules/reports/server/founder-pack-helpers";
import { monthlyFinancialTrend } from "@/modules/reports/server/founder-monthly-trend";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";

interface OrganizationRow {
  default_currency: string;
  number_format: string;
  timezone: string;
}

interface FinanceDailyRow {
  revenue_mtd: string | number;
  revenue_ytd: string | number;
  cash_collected_mtd: string | number;
  receivables: string | number;
  overdue_receivables: string | number;
  upcoming_expenses: string | number;
  paid_expenses_all_time: string | number;
  cash_collected_all_time: string | number;
}

interface VendorCashRow {
  upcoming_vendor: string | number;
  paid_vendor_all_time: string | number;
}

interface DeliveryRow {
  rag_red: string | number;
  rag_amber: string | number;
  rag_green: string | number;
  deadlines_next_7: string | number;
  overdue_tasks: string | number;
  unsubmitted_time: string | number;
}

interface PeopleRow {
  away_today: string | number;
  attendance_exceptions: string | number;
  onboarding_open: string | number;
  offboarding_open: string | number;
  pending_hr_approvals: string | number;
}

interface ActionRow {
  approvals_waiting: string | number;
  invoices_to_issue: string | number;
  collections_due: string | number;
  contracts_expiring: string | number;
  vendor_payment_approvals: string | number;
  security_integration_issues: string | number;
}

interface WeeklyRow {
  revenue_previous_week: string | number;
  cash_previous_week: string | number;
  expenses_previous_week: string | number;
  new_pipeline_previous_week: string | number;
  deals_won_previous_week: string | number;
  deals_lost_previous_week: string | number;
  submitted_minutes_previous_week: string | number;
  active_members: string | number;
  client_issues: string | number;
  expected_invoices_next_week: string | number;
  expected_collections_next_week: string | number;
  deals_closing_next_week: string | number;
  critical_delivery_dates: string | number;
  resource_constraints: string | number;
  contracts_renewing_next_week: string | number;
  founder_decisions: string | number;
}

async function organization(database: Sql, organizationId: string): Promise<OrganizationRow> {
  const rows = await database<OrganizationRow[]>`
    select default_currency, number_format, timezone
    from public.organizations
    where id = ${organizationId}::uuid
    limit 1
  `;
  return rows[0] ?? { default_currency: "USD", number_format: "en-US", timezone: "UTC" };
}

async function dailyFinance(
  database: Sql,
  context: CurrentPermissionContext,
  currency: string,
): Promise<FinanceDailyRow | null> {
  if (!context.permissions.has(financePermissionKeys.reportView)) return null;
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const canPayments = context.permissions.has(financePermissionKeys.paymentView);
  const canExpenses = context.permissions.has(financePermissionKeys.expenseView);
  const expenseScope = context.permissionScopes.get(financePermissionKeys.expenseView) ?? "own";
  const rows = await database<FinanceDailyRow[]>`
    with local_day as (
      select (now() at time zone organization.timezone)::date as today
      from public.organizations organization
      where organization.id = ${org}::uuid
    )
    select
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor)
        from public.finance_invoices invoice, local_day
        where invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.issue_date >= date_trunc('month', local_day.today)::date), 0)::bigint as revenue_mtd,
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor)
        from public.finance_invoices invoice, local_day
        where invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.issue_date >= date_trunc('year', local_day.today)::date), 0)::bigint as revenue_ytd,
      coalesce((select sum(payment.amount_minor)
        from public.finance_payments payment, local_day
        where ${canPayments} and payment.organization_id = ${org}::uuid and payment.currency = ${currency}
          and payment.payment_date >= date_trunc('month', local_day.today)::date), 0)::bigint as cash_collected_mtd,
      coalesce((select sum(invoice.balance_minor)
        from public.finance_invoices invoice
        where invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited')), 0)::bigint as receivables,
      coalesce((select sum(invoice.balance_minor)
        from public.finance_invoices invoice, local_day
        where invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited')
          and invoice.due_date < local_day.today), 0)::bigint as overdue_receivables,
      coalesce((select sum(expense.total_minor)
        from public.finance_expenses expense, local_day
        where ${canExpenses} and expense.organization_id = ${org}::uuid and expense.currency = ${currency}
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${expenseScope}, expense.employee_membership_id, expense.created_by_membership_id
          )
          and expense.approval_status in ('not_required','approved')
          and expense.payment_status in ('unpaid','scheduled')
          and expense.expense_date between local_day.today and local_day.today + 7), 0)::bigint as upcoming_expenses,
      coalesce((select sum(expense.total_minor)
        from public.finance_expenses expense
        where ${canExpenses} and expense.organization_id = ${org}::uuid and expense.currency = ${currency}
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${expenseScope}, expense.employee_membership_id, expense.created_by_membership_id
          )
          and expense.payment_status in ('paid','reimbursed')), 0)::bigint as paid_expenses_all_time,
      coalesce((select sum(payment.amount_minor)
        from public.finance_payments payment
        where ${canPayments} and payment.organization_id = ${org}::uuid and payment.currency = ${currency}), 0)::bigint as cash_collected_all_time
  `;
  return rows[0] ?? null;
}

async function vendorCash(
  database: Sql,
  context: CurrentPermissionContext,
  currency: string,
): Promise<VendorCashRow | null> {
  if (!context.permissions.has(vendorPermissionKeys.billView)) return null;
  const org = context.membership.organizationId;
  const rows = await database<VendorCashRow[]>`
    with local_day as (
      select (now() at time zone organization.timezone)::date as today
      from public.organizations organization where organization.id = ${org}::uuid
    )
    select
      coalesce(sum(bill.total_minor) filter (
        where bill.status in ('received','matched','pending_approval','approved','partially_paid')
          and bill.due_date between local_day.today and local_day.today + 7
      ), 0)::bigint as upcoming_vendor,
      coalesce(sum(bill.total_minor) filter (where bill.status = 'paid'), 0)::bigint as paid_vendor_all_time
    from public.procurement_vendor_bills bill, local_day
    where bill.organization_id = ${org}::uuid and bill.currency = ${currency}
  `;
  return rows[0] ?? null;
}

async function dailyDelivery(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<DeliveryRow | null> {
  if (!context.permissions.has(projectPermissionKeys.projectView)) return null;
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
  const rows = await database<DeliveryRow[]>`
    with visible_projects as (
      select project.id, project.status, project.due_date
      from public.projects project
      where project.organization_id = ${org}::uuid and project.archived_at is null
        and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})
    ), task_stats as (
      select task.project_id,
        count(*) filter (where not status.is_terminal and task.due_date < current_date)::int as overdue
      from public.project_tasks task
      join public.project_task_statuses status on status.id = task.status_id
      join visible_projects project on project.id = task.project_id
      group by task.project_id
    )
    select
      count(*) filter (where project.status = 'on_hold' or coalesce(task_stats.overdue, 0) > 0 or project.due_date < current_date)::int as rag_red,
      count(*) filter (where project.status = 'active' and coalesce(task_stats.overdue, 0) = 0
        and project.due_date between current_date and current_date + 7)::int as rag_amber,
      count(*) filter (where project.status in ('planned','active') and coalesce(task_stats.overdue, 0) = 0
        and (project.due_date is null or project.due_date > current_date + 7))::int as rag_green,
      count(*) filter (where project.status in ('planned','active','on_hold')
        and project.due_date between current_date and current_date + 7)::int as deadlines_next_7,
      coalesce((select count(*) from public.project_tasks task
        join public.project_task_statuses status on status.id = task.status_id
        join visible_projects visible on visible.id = task.project_id
        where not status.is_terminal and task.due_date < current_date), 0)::int as overdue_tasks,
      coalesce((select count(*) from public.project_time_entries entry
        join visible_projects visible on visible.id = entry.project_id
        where entry.submission_status = 'draft' and entry.work_date >= date_trunc('week', current_date)::date), 0)::int as unsubmitted_time
    from visible_projects project
    left join task_stats on task_stats.project_id = project.id
  `;
  return rows[0] ?? null;
}

async function dailyPeople(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<PeopleRow | null> {
  const canEmployee = context.permissions.has(hrPermissionKeys.employeeView);
  const canAttendance = context.permissions.has(hrPermissionKeys.attendanceView);
  const canLeave = context.permissions.has(hrPermissionKeys.leaveRequestView);
  const canOnboarding = context.permissions.has(hrPermissionKeys.onboardingView);
  const canOffboarding = context.permissions.has(hrPermissionKeys.offboardingView);
  if (!canEmployee && !canAttendance && !canLeave && !canOnboarding && !canOffboarding) return null;
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const leaveScope = context.permissionScopes.get(hrPermissionKeys.leaveRequestView) ?? "own";
  const attendanceScope = context.permissionScopes.get(hrPermissionKeys.attendanceView) ?? "own";
  const onboardingScope = context.permissionScopes.get(hrPermissionKeys.onboardingView) ?? "own";
  const offboardingScope = context.permissionScopes.get(hrPermissionKeys.offboardingView) ?? "own";
  const canApprovals = context.permissions.has("approvals.request.view");
  const approvalScope = context.permissionScopes.get("approvals.request.view") ?? "own";
  const rows = await database<PeopleRow[]>`
    with local_day as (
      select (now() at time zone organization.timezone)::date as today
      from public.organizations organization where organization.id = ${org}::uuid
    )
    select
      coalesce((select count(distinct request.membership_id) from public.hr_leave_requests request, local_day
        where ${canLeave} and request.organization_id = ${org}::uuid and request.status = 'approved'
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${leaveScope}, request.membership_id, request.membership_id
          )
          and local_day.today between request.start_date and request.end_date), 0)::int as away_today,
      coalesce((select count(*) from public.hr_attendance_records attendance, local_day
        where ${canAttendance} and attendance.organization_id = ${org}::uuid
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${attendanceScope}, attendance.membership_id, attendance.membership_id
          )
          and attendance.attendance_date = local_day.today
          and (attendance.attendance_status in ('absent','half_day') or attendance.late_minutes > 0 or attendance.early_departure_minutes > 0)), 0)::int as attendance_exceptions,
      coalesce((select count(*) from public.hr_onboarding_plans plan
        where ${canOnboarding} and plan.organization_id = ${org}::uuid
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${onboardingScope}, plan.membership_id, plan.membership_id
          )
          and plan.status not in ('completed','cancelled')), 0)::int as onboarding_open,
      coalesce((select count(*) from public.hr_offboarding_plans plan
        where ${canOffboarding} and plan.organization_id = ${org}::uuid
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${offboardingScope}, plan.membership_id, plan.membership_id
          )
          and plan.status not in ('completed','cancelled')), 0)::int as offboarding_open,
      coalesce((select count(*) from public.approval_requests request
        where ${canApprovals} and request.organization_id = ${org}::uuid and request.status = 'pending'
          and request.source_module like 'hr%'
          and (
            request.requester_membership_id = ${member}::uuid
            or exists (
              select 1 from public.approval_request_steps step
              where step.request_id = request.id and step.approver_membership_id = ${member}::uuid
            )
            or private.crm_scope_allows_membership(
              ${member}::uuid, ${approvalScope}, request.requester_membership_id, request.requester_membership_id
            )
          )), 0)::int as pending_hr_approvals
  `;
  return rows[0] ?? null;
}

async function dailyActions(database: Sql, context: CurrentPermissionContext): Promise<ActionRow> {
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const canFinance = context.permissions.has(financePermissionKeys.invoiceView);
  const canLegal = context.permissions.has("legal.contract.view");
  const canBills = context.permissions.has(vendorPermissionKeys.billView);
  const canApprovals = context.permissions.has("approvals.request.view");
  const canNotifications = context.permissions.has("notifications.notification.view");
  const rows = await database<ActionRow[]>`
    select
      coalesce((select count(*) from public.approval_requests request
        where ${canApprovals} and request.organization_id = ${org}::uuid and request.status = 'pending'
          and exists (select 1 from public.approval_request_steps step where step.request_id = request.id
            and step.approver_membership_id = ${member}::uuid and step.status in ('waiting','pending'))), 0)::int as approvals_waiting,
      coalesce((select count(*) from public.finance_invoices invoice
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.status in ('draft','approved')), 0)::int as invoices_to_issue,
      coalesce((select count(*) from public.finance_invoices invoice
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.balance_minor > 0
          and invoice.status not in ('paid','void','credited') and invoice.due_date <= current_date), 0)::int as collections_due,
      coalesce((select count(*) from public.legal_contracts contract
        where ${canLegal} and contract.organization_id = ${org}::uuid and contract.status = 'active'
          and private.legal_contract_membership_access_allowed(
            contract.id, ${member}::uuid, 'legal.contract.view'
          )
          and coalesce(contract.renewal_date, contract.end_date) between current_date and current_date + 30), 0)::int as contracts_expiring,
      coalesce((select count(*) from public.procurement_vendor_bills bill
        where ${canBills} and bill.organization_id = ${org}::uuid and bill.status = 'pending_approval'), 0)::int as vendor_payment_approvals,
      coalesce((select count(*) from public.notifications notification
        where ${canNotifications} and notification.organization_id = ${org}::uuid and notification.recipient_membership_id = ${member}::uuid
          and notification.read_at is null and notification.category in ('security_alert','integration_failure')), 0)::int as security_integration_issues
  `;
  return (
    rows[0] ?? {
      approvals_waiting: 0,
      invoices_to_issue: 0,
      collections_due: 0,
      contracts_expiring: 0,
      vendor_payment_approvals: 0,
      security_integration_issues: 0,
    }
  );
}

async function weeklyMetrics(
  database: Sql,
  context: CurrentPermissionContext,
  currency: string,
): Promise<WeeklyRow> {
  const org = context.membership.organizationId;
  const canFinance = context.permissions.has(financePermissionKeys.reportView);
  const canPayments = context.permissions.has(financePermissionKeys.paymentView);
  const canExpenses = context.permissions.has(financePermissionKeys.expenseView);
  const expenseScope = context.permissionScopes.get(financePermissionKeys.expenseView) ?? "own";
  const canCrm = context.permissions.has("crm.lead.view");
  const canProject = context.permissions.has(projectPermissionKeys.projectView);
  const canTime = context.permissions.has(projectPermissionKeys.timeView);
  const canSupport = context.permissions.has(supportPermissionKeys.view);
  const canLegal = context.permissions.has("legal.contract.view");
  const canApprovals = context.permissions.has("approvals.request.view");
  const crmScope = context.permissionScopes.get("crm.lead.view") ?? "own";
  const projectScope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
  const approvalScope = context.permissionScopes.get("approvals.request.view") ?? "own";
  const member = context.membership.id;
  const rows = await database<WeeklyRow[]>`
    with bounds as (
      select date_trunc('week', (now() at time zone organization.timezone)::date)::date as this_week
      from public.organizations organization where organization.id = ${org}::uuid
    )
    select
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor) from public.finance_invoices invoice, bounds
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.issue_date >= bounds.this_week - 7 and invoice.issue_date < bounds.this_week), 0)::bigint as revenue_previous_week,
      coalesce((select sum(payment.amount_minor) from public.finance_payments payment, bounds
        where ${canPayments} and payment.organization_id = ${org}::uuid and payment.currency = ${currency}
          and payment.payment_date >= bounds.this_week - 7 and payment.payment_date < bounds.this_week), 0)::bigint as cash_previous_week,
      coalesce((select sum(expense.total_minor) from public.finance_expenses expense, bounds
        where ${canExpenses} and expense.organization_id = ${org}::uuid and expense.currency = ${currency}
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${expenseScope}, expense.employee_membership_id, expense.created_by_membership_id
          )
          and expense.approval_status <> 'rejected' and expense.expense_date >= bounds.this_week - 7
          and expense.expense_date < bounds.this_week), 0)::bigint as expenses_previous_week,
      coalesce((select sum(lead.estimated_value) from public.crm_leads lead, bounds
        where ${canCrm} and lead.organization_id = ${org}::uuid and lead.currency = ${currency}
          and private.crm_scope_allows_membership(${member}::uuid, ${crmScope}, lead.owner_membership_id, lead.created_by_membership_id)
          and lead.created_at >= bounds.this_week - interval '7 days' and lead.created_at < bounds.this_week), 0) as new_pipeline_previous_week,
      coalesce((select count(*) from public.crm_leads lead, bounds
        where ${canCrm} and lead.organization_id = ${org}::uuid and lead.status = 'converted'
          and private.crm_scope_allows_membership(${member}::uuid, ${crmScope}, lead.owner_membership_id, lead.created_by_membership_id)
          and lead.converted_at >= bounds.this_week - interval '7 days' and lead.converted_at < bounds.this_week), 0)::int as deals_won_previous_week,
      coalesce((select count(*) from public.crm_leads lead, bounds
        where ${canCrm} and lead.organization_id = ${org}::uuid and lead.status = 'lost'
          and private.crm_scope_allows_membership(${member}::uuid, ${crmScope}, lead.owner_membership_id, lead.created_by_membership_id)
          and lead.closed_at >= bounds.this_week - interval '7 days' and lead.closed_at < bounds.this_week), 0)::int as deals_lost_previous_week,
      coalesce((select sum(entry.minutes) from public.project_time_entries entry, bounds
        where ${canTime} and entry.organization_id = ${org}::uuid and entry.submission_status = 'submitted'
          and private.project_is_visible(entry.project_id, ${member}::uuid, ${projectScope})
          and entry.work_date >= bounds.this_week - 7 and entry.work_date < bounds.this_week), 0)::bigint as submitted_minutes_previous_week,
      coalesce((select count(distinct project_member.membership_id)
        from public.project_members project_member
        join public.projects project on project.id = project_member.project_id
        join public.memberships membership on membership.id = project_member.membership_id
        where ${canTime} and project.organization_id = ${org}::uuid and project.archived_at is null
          and membership.status = 'active'
          and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})), 0)::int as active_members,
      coalesce((select count(*) from public.support_tickets ticket, bounds
        where ${canSupport} and ticket.organization_id = ${org}::uuid
          and private.support_ticket_membership_access_allowed(
            ticket.id, ${member}::uuid, 'support.ticket.view'
          )
          and ticket.status not in ('resolved','closed') and ticket.priority in ('high','urgent')), 0)::int as client_issues,
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor) from public.finance_invoices invoice, bounds
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.status in ('draft','pending_approval','approved')
          and invoice.issue_date >= bounds.this_week + 7 and invoice.issue_date < bounds.this_week + 14), 0)::bigint as expected_invoices_next_week,
      coalesce((select sum(invoice.balance_minor) from public.finance_invoices invoice, bounds
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited')
          and invoice.due_date >= bounds.this_week + 7 and invoice.due_date < bounds.this_week + 14), 0)::bigint as expected_collections_next_week,
      coalesce((select count(*) from public.crm_leads lead, bounds
        where ${canCrm} and lead.organization_id = ${org}::uuid and lead.status in ('new','qualified')
          and private.crm_scope_allows_membership(${member}::uuid, ${crmScope}, lead.owner_membership_id, lead.created_by_membership_id)
          and lead.expected_close_date >= bounds.this_week + 7 and lead.expected_close_date < bounds.this_week + 14), 0)::int as deals_closing_next_week,
      coalesce((select count(*) from public.projects project, bounds
        where ${canProject} and project.organization_id = ${org}::uuid and project.archived_at is null
          and project.status in ('planned','active','on_hold')
          and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})
          and project.due_date >= bounds.this_week + 7 and project.due_date < bounds.this_week + 14), 0)::int as critical_delivery_dates,
      coalesce((select count(*) from public.project_tasks task
        join public.project_task_statuses status on status.id = task.status_id
        where ${canProject} and task.organization_id = ${org}::uuid and not status.is_terminal
          and private.project_is_visible(task.project_id, ${member}::uuid, ${projectScope})
          and task.due_date < current_date), 0)::int as resource_constraints,
      coalesce((select count(*) from public.legal_contracts contract, bounds
        where ${canLegal} and contract.organization_id = ${org}::uuid and contract.status = 'active'
          and private.legal_contract_membership_access_allowed(
            contract.id, ${member}::uuid, 'legal.contract.view'
          )
          and coalesce(contract.renewal_date, contract.end_date) >= bounds.this_week + 7
          and coalesce(contract.renewal_date, contract.end_date) < bounds.this_week + 14), 0)::int as contracts_renewing_next_week,
      coalesce((select count(*) from public.approval_requests request
        where ${canApprovals} and request.organization_id = ${org}::uuid and request.status = 'pending'
          and (
            request.requester_membership_id = ${member}::uuid
            or exists (
              select 1 from public.approval_request_steps step
              where step.request_id = request.id and step.approver_membership_id = ${member}::uuid
            )
            or private.crm_scope_allows_membership(
              ${member}::uuid, ${approvalScope}, request.requester_membership_id, request.requester_membership_id
            )
          )), 0)::int as founder_decisions
  `;
  return rows[0] as WeeklyRow;
}

export async function getFounderReportPackForContext(
  context: CurrentPermissionContext,
  kind: "daily" | "weekly" | "monthly",
): Promise<FounderReportPack | null> {
  if (!context.permissions.has("reports.founder_pack.view")) return null;
  const database = getDatabaseClient();
  const org = await organization(database, context.membership.organizationId);
  const currency = org.default_currency;
  const locale = org.number_format;
  const thisMonth = resolveReportPeriod({ periodMode: "this_month", timezone: org.timezone });
  const lastMonth = resolveReportPeriod({ periodMode: "last_month", timezone: org.timezone });
  const previousMonth = previousCalendarMonth(lastMonth);
  const yearToDate = resolveReportPeriod({ periodMode: "year_to_date", timezone: org.timezone });
  const lastWeek = resolveReportPeriod({ periodMode: "last_week", timezone: org.timezone });
  const thisWeek = resolveReportPeriod({ periodMode: "this_week", timezone: org.timezone });
  const nextWeek = shiftPeriod(thisWeek, 7);

  if (kind === "monthly") {
    const [daily, weekly, trend, profitability, cashForecast, concentration] = await Promise.all([
      getFounderReportPackForContext(context, "daily"),
      getFounderReportPackForContext(context, "weekly"),
      monthlyFinancialTrend(database, context, currency),
      getProjectProfitabilityForContext(context),
      context.permissions.has(financePermissionKeys.reportView)
        ? getCashForecastForContext(context)
        : Promise.resolve(null),
      getClientConcentrationForContext(database, context, lastMonth),
    ]);
    if (!daily || !weekly) return null;
    const dailyBlock = (id: string) => daily.blocks.find((item) => item.id === id)?.rows ?? [];
    const weeklyBlock = (id: string) => weekly.blocks.find((item) => item.id === id)?.rows ?? [];
    const money = dailyBlock("founder_daily.money");
    const sales = dailyBlock("founder_daily.sales");
    const delivery = dailyBlock("founder_daily.delivery");
    const people = dailyBlock("founder_daily.people");
    const actions = dailyBlock("founder_daily.actions");
    const previous = weeklyBlock("founder_weekly.previous");
    const next = weeklyBlock("founder_weekly.next");
    const lastMonthContribution =
      number(trend.revenue_last_month) - number(trend.expenses_last_month);
    const previousMonthContribution =
      number(trend.revenue_previous_month) - number(trend.expenses_previous_month);
    const trendRows = [
      row(
        "revenue-last-month",
        "Issued revenue · last month",
        formatMinorMoney(number(trend.revenue_last_month), currency, locale),
        `Previous month ${formatMinorMoney(number(trend.revenue_previous_month), currency, locale)}`,
        financeHref("invoices", lastMonth, { scope: "issued_revenue", currency }),
      ),
      row(
        "cash-last-month",
        "Recorded cash · last month",
        formatMinorMoney(number(trend.cash_last_month), currency, locale),
        `Previous month ${formatMinorMoney(number(trend.cash_previous_month), currency, locale)}; recorded payments are not reconciled bank cash.`,
        financeHref("payments", lastMonth, { currency }),
      ),
      row(
        "expenses-last-month",
        "Recorded expenses · last month",
        formatMinorMoney(number(trend.expenses_last_month), currency, locale),
        `Previous month ${formatMinorMoney(number(trend.expenses_previous_month), currency, locale)}`,
        financeHref("expenses", lastMonth, { currency }),
      ),
      row(
        "contribution-last-month",
        "Operational contribution · last month",
        formatMinorMoney(lastMonthContribution, currency, locale),
        `Previous month ${formatMinorMoney(previousMonthContribution, currency, locale)}; invoiced revenue less visible recorded expenses, not general-ledger profit.`,
        reportHref("finance", lastMonth),
        lastMonthContribution < 0 ? "warning" : "neutral",
      ),
      row(
        "revenue-previous-month",
        "Issued revenue · prior month",
        formatMinorMoney(number(trend.revenue_previous_month), currency, locale),
        null,
        financeHref("invoices", previousMonth, { scope: "issued_revenue", currency }),
      ),
    ].map((item) => ({ ...item, definitionKey: `founder_monthly.financial.${item.id}` }));
    const forecastCurrency =
      cashForecast?.currencies.find((item) => item.currency === currency) ?? null;
    const baseForecast =
      forecastCurrency?.scenarios.find((item) => item.scenario === "base") ?? null;
    const forecastRows = (baseForecast?.horizons ?? []).map((horizon) => ({
      ...row(
        `cash-forecast-${horizon.days}`,
        `Base cash movement · ${horizon.days} days`,
        formatMinorMoney(horizon.netMinor, currency, locale),
        `${formatMinorMoney(horizon.inflowMinor, currency, locale)} expected in · ${formatMinorMoney(horizon.outflowMinor, currency, locale)} expected out. This is forward movement, not bank balance.`,
        "/finance?tab=reports",
        horizon.netMinor < 0 ? "warning" : "neutral",
      ),
      definitionKey: "founder_monthly.financial.cash-forecast",
    }));
    const lastMonthProfitability =
      profitability.rollups.find(
        (item) =>
          item.dimension === "month" &&
          item.currency === currency &&
          item.label === lastMonth.from.slice(0, 7),
      ) ?? null;
    const projectRows = lastMonthProfitability
      ? [
          {
            ...row(
              "project-contribution-last-month",
              "Project gross contribution · last month",
              formatMinorMoney(lastMonthProfitability.grossContributionMinor, currency, locale),
              `${formatMinorMoney(lastMonthProfitability.invoicedRevenueMinor, currency, locale)} project revenue with recorded labor, vendor, and project-expense costs.`,
              reportHref("projects", lastMonth),
              lastMonthProfitability.grossContributionMinor < 0 ? "warning" : "neutral",
            ),
            definitionKey: "founder_monthly.delivery.project-contribution-last-month",
          },
          {
            ...row(
              "project-margin-last-month",
              "Project contribution margin · last month",
              percent(lastMonthProfitability.marginPercent),
              "Permission-filtered project profitability rollup for the last calendar month.",
              reportHref("projects", lastMonth),
            ),
            definitionKey: "founder_monthly.delivery.project-margin-last-month",
          },
        ]
      : [];
    const currentReceivables = money.filter((item) => ["receivables", "overdue"].includes(item.id));
    const executiveRows = [
      ...trendRows.slice(0, 4),
      ...sales.filter((item) => item.id === "weighted-pipeline"),
      ...currentReceivables,
      ...concentrationRows(concentration)
        .filter((item) => item.id.includes("revenue"))
        .slice(0, 1),
    ];
    return {
      kind: "monthly",
      blocks: [
        block("founder_monthly.executive", "Executive summary", executiveRows),
        block("founder_monthly.financial", "Financial trend", [
          ...trendRows,
          ...currentReceivables,
          ...forecastRows,
        ]),
        block("founder_monthly.sales", "Pipeline, forecast, and client concentration", [
          ...sales,
          ...concentrationRows(concentration),
        ]),
        block("founder_monthly.delivery", "Project profitability, delivery, and people", [
          ...projectRows,
          ...delivery,
          ...people,
          ...previous.filter((item) => ["utilization", "client-issues"].includes(item.id)),
        ]),
        block("founder_monthly.outlook", "Risks, decisions, and outlook", [...actions, ...next]),
      ],
    };
  }

  if (kind === "daily") {
    const [finance, vendor, forecast, delivery, profitability, people, actions, concentration] =
      await Promise.all([
        dailyFinance(database, context, currency),
        vendorCash(database, context, currency),
        getCrmForecastDataForContext(context),
        dailyDelivery(database, context),
        getProjectProfitabilityForContext(context),
        dailyPeople(database, context),
        dailyActions(database, context),
        getClientConcentrationForContext(database, context, yearToDate),
      ]);
    const currencyForecast = forecast.currencies.find((item) => item.currency === currency) ?? null;
    const projectValues = [...profitability.byProject.values()].filter(
      (item) => item.currency === currency,
    );
    const budgetOverruns = projectValues.filter(
      (item) => item.budgetVarianceMinor !== null && item.budgetVarianceMinor < 0,
    ).length;
    const estimatedCash = finance
      ? number(finance.cash_collected_all_time) -
        number(finance.paid_expenses_all_time) -
        number(vendor?.paid_vendor_all_time)
      : 0;
    const upcomingPayments = number(finance?.upcoming_expenses) + number(vendor?.upcoming_vendor);
    const lostCount = forecast.lostReasons.reduce((sum, item) => sum + item.opportunities, 0);

    return {
      kind,
      blocks: [
        block("founder_daily.money", "Money", [
          row(
            "revenue-mtd",
            "Revenue MTD",
            formatMinorMoney(number(finance?.revenue_mtd), currency, locale),
            null,
            financeHref("invoices", thisMonth, { scope: "issued_revenue", currency }),
          ),
          row(
            "revenue-ytd",
            "Revenue YTD",
            formatMinorMoney(number(finance?.revenue_ytd), currency, locale),
            null,
            financeHref("invoices", yearToDate, { scope: "issued_revenue", currency }),
          ),
          row(
            "cash-mtd",
            "Cash collected MTD",
            formatMinorMoney(number(finance?.cash_collected_mtd), currency, locale),
            null,
            financeHref("payments", thisMonth, { currency }),
          ),
          row(
            "receivables",
            "Receivables",
            formatMinorMoney(number(finance?.receivables), currency, locale),
            null,
            financeHref("invoices", undefined, { scope: "open_receivables", currency }),
          ),
          row(
            "overdue",
            "Overdue receivables",
            formatMinorMoney(number(finance?.overdue_receivables), currency, locale),
            null,
            financeHref("invoices", undefined, { scope: "overdue_receivables", currency }),
            number(finance?.overdue_receivables) > 0 ? "danger" : "neutral",
          ),
          row(
            "upcoming-payments",
            "Upcoming payments",
            formatMinorMoney(upcomingPayments, currency, locale),
            null,
            financeHref("expenses"),
          ),
          row(
            "cash-estimate",
            "Estimated cash balance",
            formatMinorMoney(estimatedCash, currency, locale),
            null,
            financeHref("reports"),
          ),
        ]),
        block("founder_daily.sales", "Sales", [
          row(
            "open-pipeline",
            "Open pipeline",
            String(currencyForecast?.openOpportunities ?? 0),
            currencyForecast
              ? majorMoney(currencyForecast.unweightedPipeline, currency, locale)
              : "No accessible pipeline",
            crmHref({ currency, scope: "open_opportunities" }),
          ),
          row(
            "weighted-pipeline",
            "Weighted pipeline",
            currencyForecast
              ? majorMoney(currencyForecast.weightedPipeline, currency, locale)
              : "No data",
            null,
            crmHref({ currency, scope: "open_opportunities" }),
          ),
          row(
            "closing-month",
            "Deals closing this month",
            currencyForecast
              ? majorMoney(currencyForecast.forecastThisMonth, currency, locale)
              : "No data",
            null,
            crmHref({ tab: "forecast" }),
          ),
          row(
            "stale",
            "Stale opportunities",
            String(forecast.staleOpportunities.length),
            null,
            crmHref({ tab: "forecast" }),
            forecast.staleOpportunities.length ? "warning" : "neutral",
          ),
          row("lost", "Lost opportunities", String(lostCount), null, crmHref({ tab: "forecast" })),
          row(
            "followups",
            "Required follow-ups",
            String(forecast.overdueFollowUps.length),
            null,
            crmHref({ tab: "forecast" }),
            forecast.overdueFollowUps.length ? "danger" : "neutral",
          ),
        ]),
        block(
          "founder_daily.concentration",
          "Client concentration risk",
          concentrationRows(concentration),
        ),
        block("founder_daily.delivery", "Delivery", [
          row(
            "rag",
            "Projects red / amber / green",
            `${number(delivery?.rag_red)} / ${number(delivery?.rag_amber)} / ${number(delivery?.rag_green)}`,
            null,
            "/projects",
          ),
          row(
            "deadlines",
            "Deadlines next 7 days",
            String(number(delivery?.deadlines_next_7)),
            null,
            "/projects",
          ),
          row(
            "overdue-tasks",
            "Overdue tasks",
            String(number(delivery?.overdue_tasks)),
            null,
            "/projects?mine=1",
            number(delivery?.overdue_tasks) ? "danger" : "neutral",
          ),
          row(
            "unsubmitted-time",
            "Unsubmitted time",
            String(number(delivery?.unsubmitted_time)),
            null,
            "/projects",
            number(delivery?.unsubmitted_time) ? "warning" : "neutral",
          ),
          row(
            "budget-overruns",
            "Budget overruns",
            String(budgetOverruns),
            null,
            "/projects",
            budgetOverruns ? "danger" : "neutral",
          ),
        ]),
        block("founder_daily.people", "People", [
          row("away", "Who is away", String(number(people?.away_today)), null, "/hr?tab=leave"),
          row(
            "attendance",
            "Attendance exceptions",
            String(number(people?.attendance_exceptions)),
            null,
            "/hr?tab=attendance",
          ),
          row(
            "onboarding",
            "Upcoming onboarding",
            String(number(people?.onboarding_open)),
            null,
            "/hr?tab=onboarding",
          ),
          row(
            "offboarding",
            "Upcoming offboarding",
            String(number(people?.offboarding_open)),
            null,
            "/hr?tab=offboarding",
          ),
          row(
            "hr-approvals",
            "Pending HR approvals",
            String(number(people?.pending_hr_approvals)),
            null,
            "/approvals",
          ),
        ]),
        block("founder_daily.actions", "Founder actions", [
          row(
            "approvals",
            "Approvals waiting",
            String(number(actions.approvals_waiting)),
            null,
            "/approvals",
            number(actions.approvals_waiting) ? "warning" : "neutral",
          ),
          row(
            "invoices",
            "Invoices to issue",
            String(number(actions.invoices_to_issue)),
            null,
            financeHref("invoices", undefined, { scope: "actionable_issue", currency }),
          ),
          row(
            "collections",
            "Collections requiring follow-up",
            String(number(actions.collections_due)),
            null,
            financeHref("invoices", undefined, { scope: "collections_due", currency }),
            number(actions.collections_due) ? "danger" : "neutral",
          ),
          row(
            "contracts",
            "Contracts expiring",
            String(number(actions.contracts_expiring)),
            null,
            "/legal",
          ),
          row(
            "vendor",
            "Vendor payments requiring approval",
            String(number(actions.vendor_payment_approvals)),
            null,
            "/vendors",
          ),
          row(
            "security",
            "Security / integration issues",
            String(number(actions.security_integration_issues)),
            null,
            "/notifications",
            number(actions.security_integration_issues) ? "danger" : "neutral",
          ),
        ]),
      ],
    };
  }

  const [weekly, profitability] = await Promise.all([
    weeklyMetrics(database, context, currency),
    getProjectProfitabilityForContext(context),
  ]);
  const projectValues = [...profitability.byProject.values()].filter(
    (item) => item.currency === currency && item.invoicedRevenueMinor > 0,
  );
  const margin = projectValues.length
    ? (projectValues.reduce((sum, item) => sum + item.grossContributionMinor, 0) /
        projectValues.reduce((sum, item) => sum + item.invoicedRevenueMinor, 0)) *
      100
    : null;
  const utilization =
    number(weekly.active_members) > 0
      ? Math.min(
          100,
          (number(weekly.submitted_minutes_previous_week) /
            (number(weekly.active_members) * 40 * 60)) *
            100,
        )
      : null;

  return {
    kind,
    blocks: [
      block("founder_weekly.previous", "Previous week", [
        row(
          "revenue",
          "Revenue",
          formatMinorMoney(number(weekly.revenue_previous_week), currency, locale),
          null,
          financeHref("invoices", lastWeek, { scope: "issued_revenue", currency }),
        ),
        row(
          "cash",
          "Cash collected",
          formatMinorMoney(number(weekly.cash_previous_week), currency, locale),
          null,
          financeHref("payments", lastWeek, { currency }),
        ),
        row(
          "expenses",
          "Expenses",
          formatMinorMoney(number(weekly.expenses_previous_week), currency, locale),
          null,
          financeHref("expenses", lastWeek, { currency }),
        ),
        row(
          "pipeline",
          "New pipeline",
          majorMoney(number(weekly.new_pipeline_previous_week), currency, locale),
          null,
          reportHref("crm", lastWeek),
        ),
        row(
          "won-lost",
          "Deals won / lost",
          `${number(weekly.deals_won_previous_week)} / ${number(weekly.deals_lost_previous_week)}`,
          null,
          reportHref("crm", lastWeek),
        ),
        row(
          "utilization",
          "Utilization",
          percent(utilization),
          null,
          reportHref("projects", lastWeek),
        ),
        row("margin", "Project margin", percent(margin), null, "/projects"),
        row(
          "client-issues",
          "Client issues",
          String(number(weekly.client_issues)),
          null,
          "/support",
        ),
      ]),
      block("founder_weekly.next", "Next week", [
        row(
          "expected-invoices",
          "Expected invoices",
          formatMinorMoney(number(weekly.expected_invoices_next_week), currency, locale),
          null,
          financeHref("invoices", nextWeek, { scope: "expected_issue", currency }),
        ),
        row(
          "expected-collections",
          "Expected collections",
          formatMinorMoney(number(weekly.expected_collections_next_week), currency, locale),
          null,
          financeHref("invoices", nextWeek, { scope: "expected_collection", currency }),
        ),
        row(
          "deals-close",
          "Deals expected to close",
          String(number(weekly.deals_closing_next_week)),
          null,
          crmHref({ tab: "forecast" }),
        ),
        row(
          "delivery",
          "Critical delivery dates",
          String(number(weekly.critical_delivery_dates)),
          null,
          reportHref("projects", nextWeek),
          number(weekly.critical_delivery_dates) ? "warning" : "neutral",
        ),
        row(
          "constraints",
          "Resource constraints",
          String(number(weekly.resource_constraints)),
          null,
          "/projects",
          number(weekly.resource_constraints) ? "warning" : "neutral",
        ),
        row(
          "renewals",
          "Contracts / renewals",
          String(number(weekly.contracts_renewing_next_week)),
          null,
          "/legal",
        ),
        row(
          "decisions",
          "Founder decisions",
          String(number(weekly.founder_decisions)),
          null,
          "/approvals",
          number(weekly.founder_decisions) ? "warning" : "neutral",
        ),
      ]),
    ],
  };
}

export interface FounderSystemReports {
  dailyViewId: string;
  weeklyViewId: string;
  monthlyViewId: string;
}

export async function ensureFounderReportSchedulesForContext(
  context: CurrentPermissionContext,
): Promise<FounderSystemReports | null> {
  const required = [
    "reports.founder_pack.view",
    "reports.workspace.view",
    "reports.saved_view.manage",
    "reports.schedule.manage",
    "reports.snapshot.create",
  ];
  if (required.some((permission) => !context.permissions.has(permission))) return null;

  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    await sql`
      select pg_advisory_xact_lock(hashtextextended(
        ${`founder-reports:${context.membership.organizationId}:${context.membership.id}`}, 0
      ))
    `;
    const orgRows = await sql<Array<{ timezone: string }>>`
      select timezone from public.organizations
      where id = ${context.membership.organizationId}::uuid
      limit 1
    `;
    const timezone = orgRows[0]?.timezone ?? "UTC";

    const ensureView = async (input: {
      systemKey: string;
      name: string;
      description: string;
      section: "founder_daily" | "founder_weekly" | "founder_monthly";
      periodMode: "today" | "last_week" | "last_month";
      widgetKeys: string[];
      cadence: "daily" | "weekly" | "monthly";
      weekday: number | null;
      monthDay?: number | null;
      localTime?: string;
    }): Promise<string> => {
      const existing = await sql<Array<{ id: string }>>`
        select id from public.report_saved_views
        where organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
          and system_key = ${input.systemKey}
          and status = 'active'
        limit 1
      `;
      let viewId = existing[0]?.id;
      if (!viewId) {
        const inserted = await sql<Array<{ id: string }>>`
          insert into public.report_saved_views (
            organization_id, owner_membership_id, name, description, section, filters,
            widget_keys, period_mode, visibility, system_key, status
          ) values (
            ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
            ${input.name}, ${input.description}, ${input.section},
            ${sql.json({
              comparison: "none",
              section: input.section,
              owner: null,
              team: null,
              department: null,
              project: null,
              client: null,
              status: null,
            })},
            ${input.widgetKeys}, ${input.periodMode}, 'founder', ${input.systemKey}, 'active'
          )
          returning id
        `;
        viewId = inserted[0]?.id;
      }
      if (!viewId) throw new Error("founder-report-view-create-failed");
      await sql`
        update public.report_saved_views
        set name = ${input.name}, description = ${input.description}, widget_keys = ${input.widgetKeys},
          period_mode = ${input.periodMode}, updated_at = now()
        where id = ${viewId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and owner_membership_id = ${context.membership.id}::uuid
          and system_key = ${input.systemKey}
      `;

      const scheduleRows = await sql<Array<{ id: string }>>`
        select id from public.report_schedules
        where saved_view_id = ${viewId}::uuid and status in ('active','paused')
        limit 1
      `;
      if (!scheduleRows[0]) {
        const nextRows = await sql<Array<{ next_run_at: Date }>>`
          select private.report_schedule_next_run(
            ${input.cadence}, ${input.localTime ?? "08:00"}::time, ${timezone},
            ${input.cadence === "weekly" ? input.weekday : null}::smallint,
            ${input.cadence === "monthly" ? (input.monthDay ?? 1) : null}::smallint, now()
          ) as next_run_at
        `;
        const nextRun = nextRows[0]?.next_run_at;
        if (!nextRun) throw new Error("founder-report-next-run-failed");
        await sql`
          insert into public.report_schedules (
            organization_id, saved_view_id, owner_membership_id, cadence, local_time,
            timezone, weekday, month_day, format, audience, delivery_channels,
            grace_seconds, status, next_run_at
          ) values (
            ${context.membership.organizationId}::uuid, ${viewId}::uuid,
            ${context.membership.id}::uuid, ${input.cadence}, ${input.localTime ?? "08:00"}::time,
            ${timezone}, ${input.cadence === "weekly" ? input.weekday : null}::smallint,
            ${input.cadence === "monthly" ? (input.monthDay ?? 1) : null}::smallint, 'pdf', 'owner', ${["in_app", "email"]}, 5, 'active',
            ${nextRun}::timestamptz
          )
        `;
      }
      return viewId;
    };

    const dailyViewId = await ensureView({
      systemKey: "founder.daily.v1",
      name: "Founder Daily Brief",
      description:
        "Automatic founder brief covering money, sales, client concentration, delivery, people, and decisions.",
      section: "founder_daily",
      periodMode: "today",
      widgetKeys: [
        "founder_daily.money",
        "founder_daily.sales",
        "founder_daily.concentration",
        "founder_daily.delivery",
        "founder_daily.people",
        "founder_daily.actions",
      ],
      cadence: "daily",
      weekday: null,
    });
    const weeklyViewId = await ensureView({
      systemKey: "founder.weekly.v1",
      name: "Founder Weekly Review",
      description: "Automatic Monday review of the previous week and the operating week ahead.",
      section: "founder_weekly",
      periodMode: "last_week",
      widgetKeys: ["founder_weekly.previous", "founder_weekly.next"],
      cadence: "weekly",
      weekday: 1,
    });
    const monthlyViewId = await ensureView({
      systemKey: "founder.monthly.v1",
      name: "Founder Monthly / Board Pack",
      description:
        "Versioned monthly executive pack covering financial position, cash and receivables, sales concentration, delivery, people, risks, decisions, and evidence links.",
      section: "founder_monthly",
      periodMode: "last_month",
      widgetKeys: [
        "founder_monthly.executive",
        "founder_monthly.financial",
        "founder_monthly.sales",
        "founder_monthly.delivery",
        "founder_monthly.outlook",
      ],
      cadence: "monthly",
      weekday: null,
      monthDay: 1,
      localTime: "08:15",
    });
    return { dailyViewId, weeklyViewId, monthlyViewId };
  });
}
