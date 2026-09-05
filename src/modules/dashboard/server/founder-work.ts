import "server-only";

import type { Sql } from "postgres";

import type { DashboardListItem, FounderAttentionItem } from "@/modules/dashboard/dashboard";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { ensureFounderReportSchedulesForContext } from "@/modules/reports/server/founder-packs";

export interface FounderWorkDelegateOption {
  membershipId: string;
  name: string;
}

export async function enrichFounderAttentionQueue(
  database: Sql,
  context: CurrentPermissionContext,
  attention: FounderAttentionItem[],
): Promise<FounderAttentionItem[]> {
  const org = context.membership.organizationId;
  const member = context.membership.id;

  if (context.permissions.has("finance.report.view")) {
    const rows = await database<
      Array<{
        id: string;
        company_name: string;
        invoice_number: string | null;
        amount_minor: string | number;
        currency: string;
        due_at: string | null;
        stage: string;
      }>
    >`
      select collection_case.id, coalesce(company.display_name, company.legal_name) as company_name,
        invoice.invoice_number, invoice.balance_minor as amount_minor, invoice.currency,
        coalesce(collection_case.next_action_at::date, invoice.due_date)::text as due_at, collection_case.stage
      from public.finance_collection_cases collection_case
      join public.finance_invoices invoice on invoice.id = collection_case.invoice_id
      join public.crm_companies company on company.id = invoice.company_id
      where collection_case.organization_id = ${org}::uuid
        and collection_case.status in ('open','promise_to_pay','disputed')
        and (collection_case.next_action_at is null or collection_case.next_action_at <= now() + interval '7 days')
      order by invoice.balance_minor desc limit 8
    `;
    attention.push(
      ...rows.map((row) => ({
        id: `collection-case:${row.id}`,
        bucket: "today" as const,
        title: `Collect ${row.company_name}`,
        meta: `${row.invoice_number ?? "Invoice"} · ${row.stage.replaceAll("_", " ")}`,
        reason: "Collection workflow has a due or upcoming action",
        href: "/finance?tab=reports",
        dueAt: row.due_at,
        tone: "warning" as const,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
      })),
    );
  }

  if (context.permissions.has("projects.task.view")) {
    const rows = await database<
      Array<{
        id: string;
        title: string;
        project_name: string;
        due_at: string | null;
        priority: string;
      }>
    >`
      select task.id, task.title, project.name as project_name, task.due_date::text as due_at, task.priority
      from public.project_tasks task
      join public.projects project on project.id = task.project_id
      join public.project_task_statuses status on status.id = task.status_id
      join public.project_task_assignees assignee on assignee.task_id = task.id
      where task.organization_id = ${org}::uuid and assignee.membership_id = ${member}::uuid
        and not status.is_terminal and (task.due_date is null or task.due_date <= current_date + 7)
      order by task.due_date nulls last,
        case task.priority when 'urgent' then 0 when 'high' then 1 else 2 end limit 8
    `;
    const today = new Date().toISOString().slice(0, 10);
    attention.push(
      ...rows.map((row) => ({
        id: `task:${row.id}`,
        bucket: row.due_at && row.due_at <= today ? ("today" as const) : ("this_week" as const),
        title: row.title,
        meta: row.project_name,
        reason: "Assigned project task needs action",
        href: `/projects?task=${row.id}`,
        dueAt: row.due_at,
        tone:
          row.priority === "urgent"
            ? ("danger" as const)
            : row.priority === "high"
              ? ("warning" as const)
              : ("neutral" as const),
      })),
    );
  }

  if (context.permissions.has("support.ticket.view")) {
    const rows = await database<
      Array<{
        id: string;
        ticket_number: number;
        subject: string;
        priority: string;
        due_at: string;
      }>
    >`
      select id, ticket_number, subject, priority, resolution_due_at as due_at
      from public.support_tickets
      where organization_id = ${org}::uuid and status not in ('resolved','closed')
        and private.support_ticket_membership_access_allowed(id, ${member}::uuid, 'support.ticket.view')
        and (priority in ('high','urgent') or resolution_due_at <= now() + interval '4 hours')
      order by case priority when 'urgent' then 0 else 1 end, resolution_due_at limit 8
    `;
    attention.push(
      ...rows.map((row) => ({
        id: `support:${row.id}`,
        bucket: row.priority === "urgent" ? ("critical" as const) : ("today" as const),
        title: `SUP-${String(row.ticket_number).padStart(6, "0")}: ${row.subject}`,
        meta: `${row.priority} priority`,
        reason: "Support escalation needs attention",
        href: `/support?ticket=${row.id}`,
        dueAt: row.due_at,
        tone: row.priority === "urgent" ? ("danger" as const) : ("warning" as const),
      })),
    );
  }

  if (context.permissions.has("vendors.bill.view")) {
    const rows = await database<
      Array<{
        id: string;
        bill_reference: string;
        vendor_name: string;
        total_minor: string | number;
        currency: string;
        due_at: string | null;
      }>
    >`
      select bill.id, bill.bill_reference, vendor.display_name as vendor_name, bill.total_minor, bill.currency,
        bill.due_date::text as due_at
      from public.procurement_vendor_bills bill
      join public.vendors vendor on vendor.id = bill.vendor_id
      where bill.organization_id = ${org}::uuid and bill.status in ('approved','partially_paid')
        and coalesce(bill.due_date, current_date) <= current_date + 7
      order by bill.due_date nulls first, bill.total_minor desc limit 8
    `;
    attention.push(
      ...rows.map((row) => ({
        id: `vendor-bill:${row.id}`,
        bucket: "this_week" as const,
        title: `Vendor bill ${row.bill_reference}`,
        meta: row.vendor_name,
        reason: "Approved vendor payment is due",
        href: "/vendors?tab=procurement",
        dueAt: row.due_at,
        tone: "warning" as const,
        amountMinor: Number(row.total_minor),
        currency: row.currency,
      })),
    );
  }

  if (context.permissions.has("settings.security.view")) {
    const rows = await database<
      Array<{ id: string; event_type: string; occurred_at: string; severity: string }>
    >`
      select id::text, event_type, occurred_at::text, severity
      from public.security_events
      where organization_id = ${org}::uuid and severity in ('warning','critical')
        and occurred_at >= now() - interval '24 hours'
      order by occurred_at desc limit 8
    `;
    attention.push(
      ...rows.map((row) => ({
        id: `security:${row.id}`,
        bucket: row.severity === "critical" ? ("critical" as const) : ("today" as const),
        title: row.event_type.replaceAll("_", " ").replaceAll(".", " "),
        meta: "Security event",
        reason: "Recent security signal requires review",
        href: "/settings/security",
        dueAt: row.occurred_at,
        tone: row.severity === "critical" ? ("danger" as const) : ("warning" as const),
      })),
    );
  }

  const stateRows = await database<
    Array<{
      item_key: string;
      state: string;
      snoozed_until: Date | null;
      delegated_to_name: string | null;
    }>
  >`
    select state.item_key, state.state, state.snoozed_until,
      coalesce(profile.display_name, auth_user.email) as delegated_to_name
    from public.founder_work_item_states state
    left join public.memberships delegated on delegated.id = state.delegated_to_membership_id
    left join public.identity_accounts auth_user on auth_user.id = delegated.user_id
    left join public.profiles profile on profile.id = delegated.user_id
    where state.organization_id = ${org}::uuid and state.owner_membership_id = ${member}::uuid
  `;
  const states = new Map(stateRows.map((row) => [row.item_key, row]));
  return attention.filter((item) => {
    const state = states.get(item.id);
    if (!state) return true;
    if (state.state === "handled") return false;
    if (state.state === "snoozed" && state.snoozed_until && state.snoozed_until > new Date())
      return false;
    if (state.state === "delegated") {
      item.workState = "delegated";
      item.delegatedToName = state.delegated_to_name;
    }
    return true;
  });
}

export async function ensureFounderReportAutomation(
  context: CurrentPermissionContext,
): Promise<boolean> {
  return ensureFounderReportSchedulesForContext(context)
    .then((result) => result !== null)
    .catch(() => false);
}

export function appendFounderReportAutomationWarning(
  attention: FounderAttentionItem[],
  ready: boolean,
): void {
  if (ready) return;
  attention.unshift({
    id: "founder-report-automation",
    bucket: "today",
    title: "Founder report automation needs attention",
    meta: "Daily, weekly, and monthly report schedules could not be verified",
    reason: "Reporting automation setup failed",
    href: "/reports?section=founder_daily",
    tone: "warning",
  });
}

export async function loadFounderWorkDelegates(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<FounderWorkDelegateOption[]> {
  const rows = await database<Array<{ membership_id: string; name: string }>>`
    select membership.id as membership_id, coalesce(profile.display_name, auth_user.email) as name
    from public.memberships membership
    join public.identity_accounts auth_user on auth_user.id = membership.user_id
    left join public.profiles profile on profile.id = membership.user_id
    where membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active' and membership.id <> ${context.membership.id}::uuid
    order by name limit 100
  `;
  return rows.map((row) => ({ membershipId: row.membership_id, name: row.name }));
}

export async function loadDelegatedFounderWork(
  database: Sql,
  context: CurrentPermissionContext,
): Promise<DashboardListItem[]> {
  const rows = await database<
    Array<{
      id: string;
      title: string;
      meta: string;
      href: string;
      reason: string;
      due_at: Date | null;
      tone: DashboardListItem["tone"];
      amount_minor: string | number | null;
      currency: string | null;
    }>
  >`
    select state.item_key as id, state.item_title as title, state.source_meta as meta,
      state.source_href as href, state.source_reason as reason, state.source_due_at as due_at,
      state.source_tone as tone, state.source_amount_minor as amount_minor, state.source_currency as currency
    from public.founder_work_item_states state
    where state.organization_id = ${context.membership.organizationId}::uuid
      and state.delegated_to_membership_id = ${context.membership.id}::uuid and state.state = 'delegated'
    order by state.updated_at desc limit 20
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    meta: row.meta,
    href: row.href,
    reason: row.reason,
    dueAt: row.due_at?.toISOString() ?? null,
    status: "delegated",
    tone: row.tone ?? "warning",
    amountMinor: row.amount_minor == null ? null : Number(row.amount_minor),
    currency: row.currency,
  }));
}
