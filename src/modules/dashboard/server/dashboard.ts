import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import type {
  DashboardListItem,
  DashboardMetric,
  DashboardSection,
  DashboardWorkspaceData,
  FounderAttentionItem,
} from "@/modules/dashboard/dashboard";
import { loadDashboardContext } from "@/modules/dashboard/server/dashboard-context";
import { modulePermissionKeys } from "@/modules/permissions/module-access";
import { getCrmForecastDataForContext } from "@/modules/crm/server/forecast";
import { getProjectProfitabilityForContext } from "@/modules/projects/server/profitability";
import {
  appendFounderReportAutomationWarning,
  enrichFounderAttentionQueue,
  ensureFounderReportAutomation,
  loadDelegatedFounderWork,
  loadFounderWorkDelegates,
} from "@/modules/dashboard/server/founder-work";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export type DashboardWorkspaceResult =
  | { allowed: true; data: DashboardWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface AggregateRow {
  value_one: string | number;
  value_two?: string | number;
  value_three?: string | number;
  value_four?: string | number;
}
interface ItemRow {
  id: string;
  title: string;
  meta: string;
  href: string;
  due_at: string | null;
  status: string | null;
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function listItems(
  rows: readonly ItemRow[],
  tone: DashboardListItem["tone"] = "neutral",
): DashboardListItem[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    meta: row.meta,
    href: row.href,
    dueAt: row.due_at,
    status: row.status,
    tone,
  }));
}

async function founderAttentionQueue(
  database: Sql,
  context: CurrentPermissionContext,
  defaultCurrency: string,
): Promise<FounderAttentionItem[]> {
  if (!context.permissions.has("reports.founder_pack.view")) return [];
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const attention: FounderAttentionItem[] = [];

  if (context.permissions.has("finance.report.view")) {
    const [overdueRows, collectionRows] = await Promise.all([
      database<
        Array<{
          id: string;
          title: string;
          amount_minor: string | number;
          due_at: string;
          days_overdue: number;
        }>
      >`
        select invoice.id, coalesce(company.display_name, company.legal_name, invoice.invoice_number, 'Invoice') as title,
          invoice.balance_minor as amount_minor, invoice.due_date::text as due_at,
          (current_date - invoice.due_date)::int as days_overdue
        from public.finance_invoices invoice
        left join public.crm_companies company on company.id = invoice.company_id
        where invoice.organization_id = ${org}::uuid
          and invoice.currency = ${defaultCurrency}
          and invoice.balance_minor > 0
          and invoice.status not in ('paid','void','credited')
          and invoice.due_date < current_date - 30
        order by invoice.balance_minor desc, invoice.due_date
        limit 6
      `,
      database<Array<{ amount_minor: string | number }>>`
        select coalesce(sum(invoice.balance_minor), 0)::bigint as amount_minor
        from public.finance_invoices invoice
        where invoice.organization_id = ${org}::uuid
          and invoice.currency = ${defaultCurrency}
          and invoice.balance_minor > 0
          and invoice.status not in ('paid','void','credited')
          and invoice.due_date between current_date and current_date + 7
      `,
    ]);
    attention.push(
      ...overdueRows.map((row) => ({
        id: `overdue:${row.id}`,
        bucket: "critical" as const,
        title: `${row.title} is ${row.days_overdue} days overdue`,
        meta: "Receivable requires collection action",
        reason: "Invoice overdue more than 30 days",
        href: "/finance?tab=invoices",
        dueAt: row.due_at,
        status: "overdue",
        tone: "danger" as const,
        amountMinor: toNumber(row.amount_minor),
        currency: defaultCurrency,
      })),
    );
    const dueThisWeek = toNumber(collectionRows[0]?.amount_minor);
    if (dueThisWeek > 0)
      attention.push({
        id: "collections:this-week",
        bucket: "this_week",
        title: "Collections expected this week",
        meta: "Receivables due in the next seven days",
        reason: "Upcoming cash collection",
        href: "/finance?tab=invoices",
        tone: "neutral",
        amountMinor: dueThisWeek,
        currency: defaultCurrency,
      });
  }

  if (context.permissions.has("projects.project.view")) {
    const [profitability, projectRows] = await Promise.all([
      getProjectProfitabilityForContext(context),
      database<
        Array<{
          id: string;
          name: string;
          code: string;
          due_date: string | null;
          days_until: number | null;
          owner_name: string;
        }>
      >`
        select project.id, project.name, project.code, project.due_date::text,
          case when project.due_date is null then null else (project.due_date - current_date)::int end as days_until,
          coalesce(profile.display_name, auth_user.email, 'Unassigned') as owner_name
        from public.projects project
        join public.memberships owner on owner.id = project.owner_membership_id
        join public.identity_accounts auth_user on auth_user.id = owner.user_id
        left join public.profiles profile on profile.id = owner.user_id
        where project.organization_id = ${org}::uuid
          and project.archived_at is null and project.status in ('active','on_hold')
          and private.project_is_visible(
            project.id, ${member}::uuid,
            ${context.permissionScopes.get("projects.project.view") ?? "own"}
          )
      `,
    ]);
    const projectById = new Map(projectRows.map((row) => [row.id, row]));
    for (const [projectId, profit] of profitability.byProject) {
      const project = projectById.get(projectId);
      if (!project) continue;
      if (
        profit.invoicedRevenueMinor > 0 &&
        profit.marginPercent !== null &&
        profit.marginPercent < 20
      ) {
        attention.push({
          id: `margin:${projectId}`,
          bucket: "critical",
          title: `${project.name} margin is ${profit.marginPercent}%`,
          meta: `${project.code} · ${project.owner_name}`,
          reason: "Project gross contribution margin below 20%",
          href: `/projects?project=${projectId}`,
          tone: "danger",
          amountMinor: profit.grossContributionMinor,
          currency: profit.currency,
        });
      }
    }
    for (const project of projectRows) {
      if (project.due_date && project.days_until !== null && project.days_until >= 0) {
        const days = project.days_until;
        if (days <= 7)
          attention.push({
            id: `project-due:${project.id}`,
            bucket: "this_week",
            title: `${project.name} is due ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
            meta: `${project.code} · ${project.owner_name}`,
            reason: "Project delivery deadline",
            href: `/projects?project=${project.id}`,
            dueAt: project.due_date,
            tone: days <= 2 ? "warning" : "neutral",
          });
      }
    }
  }

  if (context.permissions.has("crm.lead.view")) {
    const forecast = await getCrmForecastDataForContext(context);
    for (const risk of forecast.topRisks.slice(0, 6)) {
      const overdueFollowUp = risk.reasons.includes("follow-up overdue");
      attention.push({
        id: `crm-risk:${risk.leadId}`,
        bucket: risk.riskScore >= 50 ? "critical" : overdueFollowUp ? "today" : "this_week",
        title: risk.name,
        meta: `${risk.currency} ${Math.round(risk.expectedRevenue).toLocaleString("en-US")} expected · ${risk.ownerName ?? "Unassigned"}`,
        reason: risk.reasons.join(", "),
        href: `/crm?tab=leads&lead=${risk.leadId}`,
        dueAt: risk.expectedCloseDate,
        tone: risk.riskScore >= 50 ? "danger" : "warning",
      });
    }
  }

  if (context.permissions.has("approvals.request.view")) {
    const approvalRows = await database<
      Array<{ id: string; title: string; due_at: string | null; source_module: string }>
    >`
      select request.id, request.title, request.due_at::text, request.source_module
      from public.approval_requests request
      where request.organization_id = ${org}::uuid and request.status = 'pending'
        and exists (
          select 1 from public.approval_request_steps step
          where step.request_id = request.id and step.approver_membership_id = ${member}::uuid
            and step.status in ('waiting','pending')
        )
      order by request.due_at nulls last, request.submitted_at
      limit 8
    `;
    attention.push(
      ...approvalRows.map((row) => ({
        id: `approval:${row.id}`,
        bucket: "today" as const,
        title: row.title,
        meta: `${row.source_module.replaceAll("_", " ")} approval`,
        reason: "Founder decision required",
        href: "/approvals",
        dueAt: row.due_at,
        status: "pending",
        tone: "warning" as const,
      })),
    );
  }

  if (context.permissions.has("legal.contract.view")) {
    const contractRows = await database<
      Array<{
        id: string;
        title: string;
        counterparty_name: string;
        renewal_date: string | null;
        end_date: string | null;
      }>
    >`
      select id, title, counterparty_name, renewal_date::text, end_date::text
      from public.legal_contracts
      where organization_id = ${org}::uuid and status = 'active'
        and private.legal_contract_membership_access_allowed(
          id, ${member}::uuid, 'legal.contract.view'
        )
        and coalesce(renewal_date, end_date) between current_date and current_date + 7
      order by coalesce(renewal_date, end_date)
      limit 8
    `;
    attention.push(
      ...contractRows.map((row) => ({
        id: `contract:${row.id}`,
        bucket: "this_week" as const,
        title: row.title,
        meta: row.counterparty_name,
        reason: "Contract renewal or expiry within seven days",
        href: "/legal?tab=contracts",
        dueAt: row.renewal_date ?? row.end_date,
        tone: "warning" as const,
      })),
    );
  }

  const visibleAttention = await enrichFounderAttentionQueue(database, context, attention);

  const bucketRank = { critical: 0, today: 1, this_week: 2 } as const;
  return visibleAttention
    .sort(
      (left, right) =>
        bucketRank[left.bucket] - bucketRank[right.bucket] ||
        (right.amountMinor ?? 0) - (left.amountMinor ?? 0) ||
        (left.dueAt ?? "9999-12-31").localeCompare(right.dueAt ?? "9999-12-31"),
    )
    .slice(0, 30);
}

async function ownerDashboard(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<{
  metrics: DashboardMetric[];
  sections: DashboardSection[];
  revenue: number;
  previousRevenue: number;
}> {
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const permissions = context.permissions;
  const metrics: DashboardMetric[] = [];
  const sections: DashboardSection[] = [];
  let revenue = 0;
  let previousRevenue = 0;

  if (permissions.has("finance.report.view")) {
    const rows = await database<AggregateRow[]>`
      select
        coalesce(sum(invoice.subtotal_minor - invoice.discount_minor) filter (
          where invoice.issue_date >= date_trunc('month', current_date)::date
        ), 0)::bigint as value_one,
        coalesce(sum(invoice.balance_minor) filter (
          where invoice.status not in ('paid', 'void', 'credited')
        ), 0)::bigint as value_two,
        coalesce(sum(invoice.balance_minor) filter (
          where invoice.status not in ('paid', 'void', 'credited') and invoice.due_date < current_date
        ), 0)::bigint as value_three,
        coalesce(sum(invoice.subtotal_minor - invoice.discount_minor) filter (
          where invoice.issue_date >= date_trunc('year', current_date)::date
        ), 0)::bigint as value_four
      from public.finance_invoices invoice
      join public.organizations organization on organization.id = invoice.organization_id
      where invoice.organization_id = ${org}::uuid
        and invoice.issued_at is not null and invoice.status <> 'void'
        and invoice.currency = organization.default_currency
    `;
    revenue = toNumber(rows[0]?.value_one);
    metrics.push(
      {
        id: "revenue",
        label: "Revenue this month",
        value: revenue,
        unit: "minor",
        detail: "Issued net revenue",
        href: "/reports?section=finance",
        tone: "success",
      },
      {
        id: "revenue-year",
        label: "Revenue this year",
        value: toNumber(rows[0]?.value_four),
        unit: "minor",
        detail: "Issued net revenue year to date",
        href: "/reports?section=finance",
        tone: "success",
      },
      {
        id: "outstanding",
        label: "Outstanding invoices",
        value: toNumber(rows[0]?.value_two),
        unit: "minor",
        detail: "Current receivables",
        href: "/finance?tab=invoices",
      },
      {
        id: "overdue",
        label: "Overdue invoices",
        value: toNumber(rows[0]?.value_three),
        unit: "minor",
        detail: "Past due and unpaid",
        href: "/finance?tab=invoices",
        tone: "danger",
      },
    );
    const comparison = await database<AggregateRow[]>`
      select coalesce(sum(invoice.subtotal_minor - invoice.discount_minor), 0)::bigint as value_one
      from public.finance_invoices invoice
      join public.organizations organization on organization.id = invoice.organization_id
      where invoice.organization_id = ${org}::uuid
        and invoice.issued_at is not null and invoice.status <> 'void'
        and invoice.currency = organization.default_currency
        and invoice.issue_date >= (date_trunc('month', current_date) - interval '1 month')::date
        and invoice.issue_date < date_trunc('month', current_date)::date
    `;
    previousRevenue = toNumber(comparison[0]?.value_one);
  }

  if (permissions.has("projects.project.view")) {
    const scope = context.permissionScopes.get("projects.project.view") ?? "own";
    const [counts, projectRows, taskRows] = await Promise.all([
      database<AggregateRow[]>`
        select count(*) filter (where project.status = 'active')::bigint as value_one,
          count(*) filter (where project.status in ('active', 'on_hold') and project.due_date < current_date)::bigint as value_two,
          coalesce((select count(*) from public.project_tasks task
            join public.project_task_statuses status on status.id = task.status_id
            join public.projects task_project on task_project.id = task.project_id
            where task.organization_id = ${org}::uuid and not status.is_terminal
              and task.due_date < current_date
              and private.project_is_visible(task_project.id, ${member}::uuid, ${scope})), 0)::bigint as value_three
        from public.projects project
        where project.organization_id = ${org}::uuid and project.archived_at is null
          and private.project_is_visible(project.id, ${member}::uuid, ${scope})
      `,
      database<ItemRow[]>`
        with task_stats as (
          select task.project_id,
            count(*)::bigint as total_tasks,
            count(*) filter (where status.is_terminal and not status.is_cancelled)::bigint as completed_tasks,
            count(*) filter (where not status.is_terminal and task.due_date < current_date)::bigint as overdue_tasks
          from public.project_tasks task
          join public.project_task_statuses status on status.id = task.status_id
          group by task.project_id
        )
        select project.id::text as id, project.name as title,
          concat(project.code, ' · ', coalesce(stats.completed_tasks, 0), '/', coalesce(stats.total_tasks, 0), ' tasks') as meta,
          concat('/projects/', project.id) as href,
          project.due_date::text as due_at, project.status
        from public.projects project
        left join task_stats stats on stats.project_id = project.id
        where project.organization_id = ${org}::uuid and project.archived_at is null
          and project.status in ('active', 'on_hold')
          and private.project_is_visible(project.id, ${member}::uuid, ${scope})
        order by coalesce(stats.overdue_tasks, 0) desc, project.due_date nulls last
        limit 8
      `,
      database<ItemRow[]>`
        select task.id::text as id, task.title,
          concat(project.code, ' · ', replace(task.priority, '_', ' ')) as meta,
          concat('/projects/', project.id, '?task=', task.id) as href,
          task.due_date::text as due_at, status.name as status
        from public.project_tasks task
        join public.projects project on project.id = task.project_id
        join public.project_task_statuses status on status.id = task.status_id
        where task.organization_id = ${org}::uuid and not status.is_terminal
          and task.due_date <= current_date + 7
          and private.project_is_visible(project.id, ${member}::uuid, ${scope})
        order by task.due_date nulls last, task.priority desc
        limit 10
      `,
    ]);
    metrics.push(
      {
        id: "active-projects",
        label: "Active projects",
        value: toNumber(counts[0]?.value_one),
        unit: "count",
        detail: "Currently in delivery",
        href: "/projects",
      },
      {
        id: "at-risk-projects",
        label: "Projects at risk",
        value: toNumber(counts[0]?.value_two),
        unit: "count",
        detail: "Late or on hold",
        href: "/projects",
        tone: "warning",
      },
      {
        id: "overdue-tasks",
        label: "Overdue tasks",
        value: toNumber(counts[0]?.value_three),
        unit: "count",
        detail: "Open tasks past due",
        href: "/projects",
        tone: "danger",
      },
    );
    sections.push(
      {
        id: "project-health",
        title: "Project health",
        description: "Delivery progress and projects needing intervention.",
        href: "/projects",
        items: listItems(projectRows),
      },
      {
        id: "work-queue",
        title: "Work queue",
        description: "Open work due within the next seven days.",
        href: "/projects",
        items: listItems(taskRows, "warning"),
      },
    );
  }

  if (permissions.has("approvals.request.view")) {
    const rows = await database<ItemRow[]>`
      select request.id::text as id, request.title,
        concat(replace(request.source_module, '_', ' '), ' · ', request.requester_membership_id::text) as meta,
        coalesce(request.deep_link, '/approvals') as href,
        request.due_at::text as due_at, request.status
      from public.approval_requests request
      where request.organization_id = ${org}::uuid and request.status = 'pending'
        and (request.requester_membership_id = ${member}::uuid or exists (
          select 1 from public.approval_request_steps step
          where step.request_id = request.id and step.approver_membership_id = ${member}::uuid
            and step.status in ('waiting', 'pending')
        ) or ${context.permissionScopes.get("approvals.request.view") ?? "own"} = 'organization')
      order by request.due_at nulls last, request.submitted_at
      limit 10
    `;
    metrics.push({
      id: "pending-approvals",
      label: "Pending approvals",
      value: rows.length,
      unit: "count",
      detail: "Requests awaiting decision",
      href: "/approvals",
      tone: rows.length ? "warning" : "neutral",
    });
    sections.push({
      id: "approvals",
      title: "Approval queue",
      description: "Requests awaiting action or oversight.",
      href: "/approvals",
      items: listItems(rows, "warning"),
    });
  }

  if (permissions.has("hr.leave_request.view")) {
    const rows = await database<AggregateRow[]>`
      select count(*)::bigint as value_one from public.hr_leave_requests request
      where request.organization_id = ${org}::uuid and request.status = 'pending'
    `;
    metrics.push({
      id: "pending-leave",
      label: "Pending leave",
      value: toNumber(rows[0]?.value_one),
      unit: "count",
      detail: "Requests awaiting review",
      href: "/hr?tab=leave",
    });
  }
  if (permissions.has("support.ticket.view")) {
    const rows = await database<AggregateRow[]>`
      select count(*)::bigint as value_one from public.support_tickets ticket
      where ticket.organization_id = ${org}::uuid and ticket.status not in ('resolved', 'closed')
        and private.support_ticket_membership_access_allowed(ticket.id, ${member}::uuid, 'support.ticket.view')
    `;
    metrics.push({
      id: "open-support",
      label: "Open support",
      value: toNumber(rows[0]?.value_one),
      unit: "count",
      detail: "Unresolved client tickets",
      href: "/support",
    });
  }

  if (permissions.has("projects.time.view") && permissions.has("hr.employee.view")) {
    const utilizationRows = await database<AggregateRow[]>`
      with members as (
        select membership.id, coalesce(profile.weekly_hours, 40)::numeric as weekly_hours
        from public.memberships membership
        left join public.hr_employee_profiles profile on profile.membership_id = membership.id
        where membership.organization_id = ${org}::uuid and membership.status = 'active'
      ), submitted as (
        select entry.membership_id, coalesce(sum(entry.minutes), 0)::bigint as minutes
        from public.project_time_entries entry
        where entry.organization_id = ${org}::uuid
          and entry.work_date >= date_trunc('month', current_date)::date
          and entry.work_date <= current_date
        group by entry.membership_id
      )
      select coalesce(sum(submitted.minutes), 0)::bigint as value_one,
        round(sum(members.weekly_hours * 60 * greatest(1, current_date - date_trunc('month', current_date)::date + 1) / 7.0))::bigint as value_two
      from members left join submitted on submitted.membership_id = members.id
    `;
    const actual = toNumber(utilizationRows[0]?.value_one);
    const expected = toNumber(utilizationRows[0]?.value_two);
    metrics.push({
      id: "employee-utilization",
      label: "Employee utilization",
      value: expected > 0 ? Math.round((actual / expected) * 10_000) : 0,
      unit: "bps",
      detail: "Submitted time against available hours",
      href: "/reports?section=projects",
    });
  }

  const attentionRows = await database<ItemRow[]>`
    select notification.id::text as id, notification.title,
      notification.message as meta, coalesce(notification.deep_link, '/notifications') as href,
      notification.last_occurred_at::text as due_at, notification.severity as status
    from public.notifications notification
    where notification.organization_id = ${org}::uuid
      and notification.recipient_membership_id = ${member}::uuid
      and notification.archived_at is null
      and notification.category in ('security_alert', 'contract_expiry', 'licence_expiry', 'asset_return', 'invoice_overdue', 'integration_failure')
    order by notification.read_at nulls first, notification.last_occurred_at desc
    limit 12
  `;
  sections.push({
    id: "alerts",
    title: "Alerts",
    description: "Security, expiry, collection, return, and integration notices.",
    href: "/notifications",
    items: listItems(attentionRows, "danger"),
  });

  if (permissions.has("legal.contract.view")) {
    const rows = await database<ItemRow[]>`
      select contract.id::text as id, contract.title,
        concat(contract.counterparty_name, ' · ', replace(contract.status, '_', ' ')) as meta,
        concat('/legal?contract=', contract.id) as href,
        coalesce(contract.renewal_date, contract.end_date)::text as due_at, contract.status
      from public.legal_contracts contract
      where contract.organization_id = ${org}::uuid and contract.deleted_at is null
        and contract.status = 'active'
        and coalesce(contract.renewal_date, contract.end_date) between current_date and current_date + 90
        and private.legal_contract_membership_access_allowed(contract.id, ${member}::uuid, 'legal.contract.view')
      order by coalesce(contract.renewal_date, contract.end_date)
      limit 8
    `;
    metrics.push({
      id: "expiring-contracts",
      label: "Contracts expiring",
      value: rows.length,
      unit: "count",
      detail: "Due within 90 days",
      href: "/legal",
      tone: rows.length ? "warning" : "neutral",
    });
    sections.push({
      id: "contracts",
      title: "Contract renewals",
      description: "Active agreements nearing renewal or end dates.",
      href: "/legal",
      items: listItems(rows, "warning"),
    });
  }

  if (permissions.has("assets.asset.view")) {
    const rows = await database<AggregateRow[]>`
      select count(*)::bigint as value_one
      from public.asset_assignments assignment
      where assignment.organization_id = ${org}::uuid and assignment.returned_at is null
        and assignment.expected_return_at is not null and assignment.expected_return_at < now()
        and private.asset_membership_access_allowed(assignment.asset_id, ${member}::uuid, 'assets.asset.view')
    `;
    metrics.push({
      id: "asset-returns",
      label: "Assets awaiting return",
      value: toNumber(rows[0]?.value_one),
      unit: "count",
      detail: "Past expected return",
      href: "/assets",
      tone: "warning",
    });
  }

  if (permissions.has("vendors.bill.view")) {
    const billRows = await database<ItemRow[]>`
      select bill.id::text as id, bill.bill_reference as title,
        concat(vendor.display_name, ' · ', bill.total_minor, ' ', bill.currency) as meta,
        concat('/vendors?bill=', bill.id) as href, bill.due_date::text as due_at, bill.status
      from public.procurement_vendor_bills bill
      join public.vendors vendor on vendor.id = bill.vendor_id
      where bill.organization_id = ${org}::uuid
        and bill.status not in ('paid', 'void') and bill.due_date <= current_date + 30
      order by bill.due_date nulls last
      limit 8
    `;
    metrics.push({
      id: "vendor-bills",
      label: "Vendor bills due",
      value: billRows.length,
      unit: "count",
      detail: "Due within 30 days",
      href: "/vendors",
      tone: billRows.length ? "warning" : "neutral",
    });
    sections.push({
      id: "vendor-bills",
      title: "Vendor bills",
      description: "Upcoming procurement payment obligations.",
      href: "/vendors",
      items: listItems(billRows, "warning"),
    });
  }
  if (permissions.has("settings.audit.view")) {
    const activityRows = await database<ItemRow[]>`
      select event.id::text as id, replace(event.action, '.', ' ') as title,
        concat(replace(event.entity_type, '_', ' '), coalesce(' · ' || event.entity_id, '')) as meta,
        '/settings/audit' as href, event.occurred_at::text as due_at, event.source as status
      from public.audit_events event
      where event.organization_id = ${org}::uuid
      order by event.occurred_at desc
      limit 12
    `;
    sections.push({
      id: "recent-activity",
      title: "Recent activity",
      description: "Latest authorized organization audit events.",
      href: "/settings/audit",
      items: listItems(activityRows),
    });
  }

  return {
    metrics: metrics.slice(0, 14),
    sections: sections.filter((section) => section.items.length > 0).slice(0, 7),
    revenue,
    previousRevenue,
  };
}

async function employeeDashboard(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<{ metrics: DashboardMetric[]; sections: DashboardSection[] }> {
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const permissions = context.permissions;
  const metrics: DashboardMetric[] = [];
  const sections: DashboardSection[] = [];

  if (permissions.has("projects.task.view")) {
    const taskRows = await database<ItemRow[]>`
      select task.id::text as id, task.title, concat(project.code, ' · ', status.name) as meta,
        concat('/projects/', project.id, '?task=', task.id) as href, task.due_date::text as due_at, status.slug as status
      from public.project_task_assignees assignee
      join public.project_tasks task on task.id = assignee.task_id
      join public.projects project on project.id = task.project_id
      join public.project_task_statuses status on status.id = task.status_id
      where assignee.membership_id = ${member}::uuid and not status.is_terminal
      order by task.due_date nulls last, task.priority desc
      limit 12
    `;
    metrics.push({
      id: "my-tasks",
      label: "My open tasks",
      value: taskRows.length,
      unit: "count",
      detail: "Assigned and not complete",
      href: "/projects",
    });
    sections.push({
      id: "tasks",
      title: "My tasks",
      description: "Assigned work ordered by due date.",
      href: "/projects",
      items: listItems(taskRows, "warning"),
    });
  }
  if (permissions.has("projects.project.view")) {
    const projectRows = await database<ItemRow[]>`
      select project.id::text as id, project.name as title, concat(project.code, ' · ', replace(project.status, '_', ' ')) as meta,
        concat('/projects/', project.id) as href, project.due_date::text as due_at, project.status
      from public.projects project
      where project.organization_id = ${org}::uuid and project.archived_at is null
        and (project.owner_membership_id = ${member}::uuid or exists (select 1 from public.project_members pm where pm.project_id = project.id and pm.membership_id = ${member}::uuid))
        and project.status not in ('completed', 'cancelled')
      order by project.due_date nulls last
      limit 8
    `;
    metrics.push({
      id: "my-projects",
      label: "My active projects",
      value: projectRows.length,
      unit: "count",
      detail: "Owned or member projects",
      href: "/projects",
    });
    sections.push({
      id: "projects",
      title: "My projects",
      description: "Projects where you are an owner or member.",
      href: "/projects",
      items: listItems(projectRows),
    });
  }
  if (permissions.has("calendar.event.view")) {
    const meetingRows = await database<ItemRow[]>`
      select event.id::text as id, event.title, concat(replace(event.event_type, '_', ' '), coalesce(' · ' || event.location, '')) as meta,
        concat('/calendar?anchor=', event.starts_at::date) as href, event.starts_at::text as due_at, event.visibility as status
      from public.calendar_events event
      where event.organization_id = ${org}::uuid and event.status = 'active'
        and event.starts_at between now() and now() + interval '14 days'
        and (event.owner_membership_id = ${member}::uuid or exists (select 1 from public.calendar_event_attendees attendee where attendee.event_id = event.id and attendee.membership_id = ${member}::uuid))
      order by event.starts_at
      limit 10
    `;
    sections.push({
      id: "meetings",
      title: "Upcoming meetings",
      description: "Your next meetings and agency events.",
      href: "/calendar",
      items: listItems(meetingRows),
    });
  }
  if (permissions.has("hr.leave_balance.view")) {
    const balanceRows = await database<AggregateRow[]>`
      select coalesce(sum(balance.opening_days + balance.accrued_days + balance.carried_forward_days + balance.adjustment_days - balance.reserved_days - balance.used_days), 0)::numeric as value_one
      from public.hr_leave_balances balance
      where balance.organization_id = ${org}::uuid and balance.membership_id = ${member}::uuid
        and balance.balance_year = extract(year from current_date)::integer
    `;
    metrics.push({
      id: "leave-balance",
      label: "Leave balance",
      value: Math.round(toNumber(balanceRows[0]?.value_one) * 100),
      unit: "bps",
      detail: "Available days × 100",
      href: "/hr?tab=leave",
    });
  }
  if (permissions.has("hr.leave_request.view")) {
    const requestRows = await database<ItemRow[]>`
      select request.id::text as id, leave_type.name as title,
        concat(request.requested_days, ' days · ', replace(request.status, '_', ' ')) as meta,
        '/hr?tab=leave' as href, request.start_date::text as due_at, request.status
      from public.hr_leave_requests request
      join public.hr_leave_types leave_type on leave_type.id = request.leave_type_id
      where request.organization_id = ${org}::uuid and request.membership_id = ${member}::uuid
        and request.status in ('draft', 'pending', 'revision_requested', 'approved')
      order by request.start_date desc
      limit 8
    `;
    sections.push({
      id: "requests",
      title: "Leave and requests",
      description: "Your current leave requests and decisions.",
      href: "/hr?tab=leave",
      items: listItems(requestRows),
    });
  }
  if (permissions.has("assets.asset.view")) {
    const assetRows = await database<ItemRow[]>`
      select asset.id::text as id, asset.name as title,
        concat(asset.asset_tag, ' · ', assignment.checkout_condition) as meta,
        concat('/assets?asset=', asset.id) as href, assignment.expected_return_at::text as due_at, asset.status
      from public.asset_assignments assignment
      join public.assets asset on asset.id = assignment.asset_id
      where assignment.organization_id = ${org}::uuid and assignment.membership_id = ${member}::uuid and assignment.returned_at is null
      order by assignment.checkout_at desc
      limit 12
    `;
    metrics.push({
      id: "assigned-assets",
      label: "Assigned assets",
      value: assetRows.length,
      unit: "count",
      detail: "Currently checked out",
      href: "/assets",
    });
    sections.push({
      id: "assets",
      title: "Assigned assets",
      description: "Equipment currently assigned to you.",
      href: "/assets",
      items: listItems(assetRows),
    });
  }
  if (permissions.has("documents.document.view")) {
    const documentRows = await database<ItemRow[]>`
      select document.id::text as id, document.title,
        concat(replace(document.classification, '_', ' '), ' · ', replace(document.status, '_', ' ')) as meta,
        concat('/documents?document=', document.id) as href,
        coalesce(document.review_date, document.expiry_date)::text as due_at, document.status
      from public.documents document
      where document.organization_id = ${org}::uuid and document.status = 'active'
        and private.document_membership_access_allowed(document.id, ${member}::uuid, 'documents.document.view')
      order by document.updated_at desc
      limit 8
    `;
    sections.push({
      id: "documents",
      title: "Recent documents",
      description: "Documents visible to your account.",
      href: "/documents",
      items: listItems(documentRows),
    });
  }
  const notificationRows = await database<ItemRow[]>`
    select notification.id::text as id, notification.title, notification.message as meta,
      coalesce(notification.deep_link, '/notifications') as href, notification.last_occurred_at::text as due_at, notification.severity as status
    from public.notifications notification
    where notification.organization_id = ${org}::uuid and notification.recipient_membership_id = ${member}::uuid
      and notification.archived_at is null
    order by notification.read_at nulls first, notification.last_occurred_at desc
    limit 10
  `;
  metrics.push({
    id: "notifications",
    label: "Unread notifications",
    value: context.unreadNotificationCount,
    unit: "count",
    detail: "Items needing review",
    href: "/notifications",
  });
  sections.push({
    id: "notifications",
    title: "Notifications",
    description: "Assignments, decisions, due dates, and alerts.",
    href: "/notifications",
    items: listItems(notificationRows),
  });

  if (permissions.has("projects.time.view")) {
    const timeRows = await database<AggregateRow[]>`
      select coalesce(sum(entry.minutes) filter (where entry.work_date >= date_trunc('week', current_date)::date), 0)::bigint as value_one
      from public.project_time_entries entry
      where entry.organization_id = ${org}::uuid and entry.membership_id = ${member}::uuid
    `;
    metrics.push({
      id: "time-week",
      label: "Time this week",
      value: toNumber(timeRows[0]?.value_one),
      unit: "minutes",
      detail: "Submitted project time",
      href: "/projects",
    });
  }
  return {
    metrics: metrics.slice(0, 8),
    sections: sections.filter((section) => section.items.length > 0).slice(0, 7),
  };
}

async function managerDashboard(database: Sql, context: CurrentPermissionContext) {
  const employee = await employeeDashboard(database, context);
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const managedScope = context.permissionScopes.get("hr.employee.view") ?? "managed_employees";
  const metrics = [...employee.metrics];
  const sections = [...employee.sections];

  if (context.permissions.has("projects.task.view")) {
    const workloadRows = await database<ItemRow[]>`
      with reports as (
        select membership.id, auth_user.email,
          coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email) as name
        from public.memberships membership
        join public.identity_accounts auth_user on auth_user.id = membership.user_id
        where membership.organization_id = ${org}::uuid and membership.status = 'active'
          and private.crm_scope_allows_membership(${member}::uuid, ${managedScope}, membership.id, membership.id)
      ), work as (
        select report.id, report.name,
          count(distinct task.id) filter (where not status.is_terminal)::bigint as open_tasks,
          count(distinct task.id) filter (where not status.is_terminal and task.due_date < current_date)::bigint as overdue_tasks,
          coalesce(sum(entry.minutes) filter (where entry.work_date >= date_trunc('week', current_date)::date), 0)::bigint as minutes
        from reports report
        left join public.project_task_assignees assignee on assignee.membership_id = report.id
        left join public.project_tasks task on task.id = assignee.task_id
        left join public.project_task_statuses status on status.id = task.status_id
        left join public.project_time_entries entry on entry.membership_id = report.id
        group by report.id, report.name
      )
      select id::text, name as title,
        concat(open_tasks, ' open · ', overdue_tasks, ' overdue · ', minutes, ' min this week') as meta,
        '/reports?section=projects&owner=' || id::text as href,
        null::text as due_at, case when overdue_tasks > 0 then 'attention' else 'on_track' end as status
      from work order by overdue_tasks desc, open_tasks desc, lower(name) limit 20
    `;
    metrics.push({
      id: "team-overdue",
      label: "Team overdue tasks",
      value: workloadRows.filter((row) => row.status === "attention").length,
      unit: "count",
      detail: "People with overdue work",
      href: "/reports?section=projects",
      tone: "warning",
    });
    sections.unshift({
      id: "team-workload",
      title: "Team workload",
      description: "Open work, overdue tasks, and submitted time.",
      href: "/reports?section=projects",
      items: listItems(workloadRows, "warning"),
    });
  }
  if (context.permissions.has("approvals.request.view")) {
    const approvalRows = await database<ItemRow[]>`
      select request.id::text as id, request.title,
        replace(request.source_module, '_', ' ') as meta,
        coalesce(request.deep_link, '/approvals') as href,
        request.due_at::text as due_at, request.status
      from public.approval_requests request
      where request.organization_id = ${org}::uuid and request.status = 'pending'
        and exists (
          select 1 from public.approval_request_steps step
          where step.request_id = request.id and step.approver_membership_id = ${member}::uuid
            and step.status in ('waiting', 'pending')
        )
      order by request.due_at nulls last, request.submitted_at
      limit 10
    `;
    metrics.push({
      id: "pending-approvals",
      label: "Pending approvals",
      value: approvalRows.length,
      unit: "count",
      detail: "Requests awaiting your decision",
      href: "/approvals",
      tone: approvalRows.length ? "warning" : "neutral",
    });
    sections.push({
      id: "approvals",
      title: "Pending approvals",
      description: "Requests assigned to your approval queue.",
      href: "/approvals",
      items: listItems(approvalRows, "warning"),
    });
  }

  if (context.permissions.has("projects.project.view")) {
    const projectScope = context.permissionScopes.get("projects.project.view") ?? "own";
    const projectRows = await database<ItemRow[]>`
      with task_stats as (
        select task.project_id, count(*)::bigint as total_tasks,
          count(*) filter (where status.is_terminal and not status.is_cancelled)::bigint as completed_tasks,
          count(*) filter (where not status.is_terminal and task.due_date < current_date)::bigint as overdue_tasks
        from public.project_tasks task
        join public.project_task_statuses status on status.id = task.status_id
        group by task.project_id
      )
      select project.id::text as id, project.name as title,
        concat(project.code, ' · ', coalesce(stats.completed_tasks, 0), '/', coalesce(stats.total_tasks, 0),
          ' complete · ', coalesce(stats.overdue_tasks, 0), ' overdue') as meta,
        concat('/projects/', project.id) as href, project.due_date::text as due_at,
        case when coalesce(stats.overdue_tasks, 0) > 0 or project.status = 'on_hold' then 'attention' else project.status end as status
      from public.projects project
      left join task_stats stats on stats.project_id = project.id
      where project.organization_id = ${org}::uuid and project.archived_at is null
        and project.status in ('planned', 'active', 'on_hold')
        and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})
      order by coalesce(stats.overdue_tasks, 0) desc, project.due_date nulls last
      limit 12
    `;
    sections.push({
      id: "project-status",
      title: "Project status",
      description: "Visible delivery progress and overdue work.",
      href: "/projects",
      items: listItems(projectRows),
    });

    if (context.permissions.has("finance.report.view")) {
      const budgetRows = await database<ItemRow[]>`
        with visible_projects as (
          select project.id, project.name, project.code
          from public.projects project
          where project.organization_id = ${org}::uuid and project.archived_at is null
            and project.status in ('planned', 'active', 'on_hold')
            and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})
        ), budgets as (
          select estimate.project_id, max(estimate.total_minor)::bigint as budget_minor
          from public.finance_estimates estimate
          join visible_projects project on project.id = estimate.project_id
          where estimate.status in ('approved', 'sent', 'accepted', 'converted')
          group by estimate.project_id
        ), spend as (
          select allocation.project_id, coalesce(sum(allocation.amount_minor), 0)::bigint as spend_minor
          from public.finance_expense_project_allocations allocation
          join public.finance_expenses expense on expense.id = allocation.expense_id
          join visible_projects project on project.id = allocation.project_id
          where expense.approval_status = 'approved' and expense.status <> 'void'
          group by allocation.project_id
        )
        select project.id::text as id, project.name as title,
          concat(project.code, ' · ', case when coalesce(budget.budget_minor, 0) > 0
            then round(coalesce(spend.spend_minor, 0) * 100.0 / budget.budget_minor)::text || '% of accepted estimate'
            else 'No accepted estimate' end) as meta,
          concat('/reports?section=projects&project=', project.id) as href,
          null::text as due_at,
          case when coalesce(budget.budget_minor, 0) > 0 and coalesce(spend.spend_minor, 0) > budget.budget_minor
            then 'attention' else 'on_track' end as status
        from visible_projects project
        left join budgets budget on budget.project_id = project.id
        left join spend on spend.project_id = project.id
        order by (coalesce(spend.spend_minor, 0) > coalesce(budget.budget_minor, 0) and coalesce(budget.budget_minor, 0) > 0) desc,
          lower(project.name)
        limit 12
      `;
      sections.push({
        id: "project-budget",
        title: "Project budget status",
        description: "Approved spend against the latest accepted project estimate.",
        href: "/reports?section=projects",
        items: listItems(budgetRows, "warning"),
      });
    }
  }

  if (
    context.permissions.has("projects.time.view") &&
    context.permissions.has("hr.employee.view")
  ) {
    const missingRows = await database<ItemRow[]>`
      select membership.id::text as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email) as title,
        concat(coalesce(department.name, 'No department'), ' · no submitted time this week') as meta,
        concat('/reports?section=projects&owner=', membership.id) as href,
        null::text as due_at, 'missing' as status
      from public.memberships membership
      join public.identity_accounts auth_user on auth_user.id = membership.user_id
      left join public.departments department on department.id = membership.department_id
      where membership.organization_id = ${org}::uuid and membership.status = 'active'
        and private.crm_scope_allows_membership(${member}::uuid, ${managedScope}, membership.id, membership.id)
        and not exists (
          select 1 from public.project_time_entries entry
          where entry.membership_id = membership.id
            and entry.work_date >= date_trunc('week', current_date)::date
        )
      order by title
      limit 20
    `;
    metrics.push({
      id: "unsubmitted-time",
      label: "Unsubmitted time",
      value: missingRows.length,
      unit: "count",
      detail: "Managed members with no time this week",
      href: "/reports?section=projects",
      tone: missingRows.length ? "warning" : "neutral",
    });
    sections.push({
      id: "unsubmitted-time",
      title: "Unsubmitted time entries",
      description: "Managed members with no project time recorded this week.",
      href: "/reports?section=projects",
      items: listItems(missingRows, "warning"),
    });
  }

  if (context.permissions.has("projects.task.view")) {
    const projectScope = context.permissionScopes.get("projects.project.view") ?? "own";
    const activityRows = await database<ItemRow[]>`
      select comment.id::text as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email) as title,
        concat('Commented on ', task.title, ' · ', project.code) as meta,
        concat('/projects/', project.id, '?task=', task.id) as href,
        comment.created_at::text as due_at, 'comment' as status
      from public.project_task_comments comment
      join public.project_tasks task on task.id = comment.task_id
      join public.projects project on project.id = task.project_id
      join public.memberships membership on membership.id = comment.created_by_membership_id
      join public.identity_accounts auth_user on auth_user.id = membership.user_id
      where comment.organization_id = ${org}::uuid
        and comment.created_at >= now() - interval '14 days'
        and private.crm_scope_allows_membership(${member}::uuid, ${managedScope}, membership.id, membership.id)
        and private.project_is_visible(project.id, ${member}::uuid, ${projectScope})
      order by comment.created_at desc
      limit 12
    `;
    sections.push({
      id: "team-activity",
      title: "Recent team activity",
      description: "Recent task comments from managed members, without comment contents.",
      href: "/projects",
      items: listItems(activityRows),
    });
  }

  if (context.permissions.has("hr.leave_request.view")) {
    const leaveRows = await database<ItemRow[]>`
      select request.id::text as id,
        coalesce(nullif(auth_user.raw_user_meta_data ->> 'full_name', ''), auth_user.email) as title,
        concat(leave_type.name, ' · ', request.requested_days, ' days') as meta,
        '/hr?tab=leave' as href, request.start_date::text as due_at, request.status
      from public.hr_leave_requests request
      join public.hr_leave_types leave_type on leave_type.id = request.leave_type_id
      join public.memberships membership on membership.id = request.membership_id
      join public.identity_accounts auth_user on auth_user.id = membership.user_id
      where request.organization_id = ${org}::uuid and request.status in ('pending', 'approved')
        and request.end_date >= current_date
        and private.crm_scope_allows_membership(${member}::uuid, ${managedScope}, membership.id, membership.id)
      order by request.start_date limit 12
    `;
    sections.push({
      id: "leave-calendar",
      title: "Team leave",
      description: "Pending and approved upcoming leave.",
      href: "/hr?tab=leave",
      items: listItems(leaveRows),
    });
  }
  return {
    metrics: metrics.slice(0, 12),
    sections: sections.filter((section) => section.items.length > 0).slice(0, 12),
  };
}

export async function getDashboardWorkspaceData(): Promise<DashboardWorkspaceResult> {
  const authorization = await authorizeCurrentUser([modulePermissionKeys.dashboard]);
  if (!authorization.allowed) return authorization;
  const context = authorization.context;
  const database = getDatabaseClient();
  const basic = await withInfrastructureRetry(() => loadDashboardContext(database, context), {
    attempts: 2,
    operationName: "Dashboard context loading",
  });
  const [loaded, attention, founderReportsReady, attentionDelegates, delegatedFounderWork] =
    await Promise.all([
      withInfrastructureRetry(
        async () => {
          if (basic.mode === "owner") return ownerDashboard(database, context);
          if (basic.mode === "manager") return managerDashboard(database, context);
          return employeeDashboard(database, context);
        },
        { attempts: 2, operationName: "Dashboard data loading" },
      ),
      basic.mode === "owner"
        ? withInfrastructureRetry(
            () => founderAttentionQueue(database, context, basic.organization.default_currency),
            { attempts: 2, operationName: "Founder attention queue loading" },
          )
        : Promise.resolve([] as FounderAttentionItem[]),
      basic.mode === "owner"
        ? withInfrastructureRetry(() => ensureFounderReportAutomation(context), {
            attempts: 2,
            operationName: "Founder report automation setup",
          })
        : Promise.resolve(true),
      basic.mode === "owner" ? loadFounderWorkDelegates(database, context) : Promise.resolve([]),
      loadDelegatedFounderWork(database, context),
    ]);
  appendFounderReportAutomationWarning(attention, founderReportsReady);

  const revenueMinor =
    "revenue" in loaded && typeof loaded.revenue === "number" ? loaded.revenue : null;
  const previousRevenueMinor =
    "previousRevenue" in loaded && typeof loaded.previousRevenue === "number"
      ? loaded.previousRevenue
      : null;
  const metadataName = context.user.metadata.full_name ?? context.user.metadata.name;
  const greetingName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().split(/\s+/)[0]
      : context.user.email.split("@")[0];
  return {
    allowed: true,
    data: {
      mode: basic.mode,
      locale: basic.organization.number_format,
      currency: basic.organization.default_currency,
      generatedAt: new Date().toISOString(),
      greetingName,
      metrics: loaded.metrics,
      sections: delegatedFounderWork.length
        ? [
            {
              id: "delegated-founder-work",
              title: "Delegated founder work",
              description: "Founder attention items assigned to you.",
              href: "/dashboard",
              items: delegatedFounderWork,
            },
            ...loaded.sections,
          ].slice(0, 12)
        : loaded.sections,
      attention,
      attentionDelegates,
      comparison: {
        periodLabel: "Previous month",
        revenueMinor,
        previousRevenueMinor,
      },
    },
  };
}
