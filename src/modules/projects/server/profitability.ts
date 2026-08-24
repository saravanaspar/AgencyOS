import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";

export interface ProjectProfitability {
  projectId: string;
  currency: string;
  invoicedRevenueMinor: number;
  laborCostMinor: number;
  vendorCostMinor: number;
  projectExpenseMinor: number;
  committedVendorMinor: number;
  grossContributionMinor: number;
  marginPercent: number | null;
  expectedBillableMinor: number;
  unbilledMinor: number;
  budgetMinor: number | null;
  budgetVarianceMinor: number | null;
}

export interface ProjectProfitabilityRollup {
  dimension: "project" | "client" | "project_manager" | "department" | "month";
  key: string;
  label: string;
  currency: string;
  invoicedRevenueMinor: number;
  laborCostMinor: number;
  vendorCostMinor: number;
  projectExpenseMinor: number;
  grossContributionMinor: number;
  marginPercent: number | null;
}

interface ProfitRow {
  project_id: string;
  project_name: string;
  company_id: string | null;
  company_name: string | null;
  owner_membership_id: string;
  owner_name: string;
  department_id: string | null;
  department_name: string | null;
  currency: string;
  budget_minor: string | number | null;
  billing_method: "none" | "hourly" | "fixed" | "retainer";
  hourly_rate_minor: string | number | null;
  fixed_price_minor: string | number | null;
  retainer_amount_minor: string | number | null;
  invoiced_revenue_minor: string | number;
  labor_cost_minor: string | number;
  vendor_cost_minor: string | number;
  project_expense_minor: string | number;
  committed_vendor_minor: string | number;
  billable_minutes: string | number;
}

interface MonthRow {
  month: string;
  currency: string;
  invoiced_revenue_minor: string | number;
  labor_cost_minor: string | number;
  vendor_cost_minor: string | number;
  project_expense_minor: string | number;
}

function amount(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : Math.round(parsed);
}

function margin(revenue: number, contribution: number): number | null {
  return revenue > 0 ? Math.round((contribution / revenue) * 10_000) / 100 : null;
}

function calculateExpectedBillable(row: ProfitRow): number {
  if (row.billing_method === "fixed") return amount(row.fixed_price_minor);
  if (row.billing_method === "retainer") return amount(row.retainer_amount_minor);
  if (row.billing_method === "hourly") {
    return Math.round((amount(row.billable_minutes) * amount(row.hourly_rate_minor)) / 60);
  }
  return 0;
}

function toProfitability(row: ProfitRow): ProjectProfitability {
  const revenue = amount(row.invoiced_revenue_minor);
  const labor = amount(row.labor_cost_minor);
  const vendor = amount(row.vendor_cost_minor);
  const expenses = amount(row.project_expense_minor);
  const contribution = revenue - labor - vendor - expenses;
  const expected = calculateExpectedBillable(row);
  const budget = row.budget_minor === null ? null : amount(row.budget_minor);
  const actualCost = labor + vendor + expenses;
  return {
    projectId: row.project_id,
    currency: row.currency,
    invoicedRevenueMinor: revenue,
    laborCostMinor: labor,
    vendorCostMinor: vendor,
    projectExpenseMinor: expenses,
    committedVendorMinor: amount(row.committed_vendor_minor),
    grossContributionMinor: contribution,
    marginPercent: margin(revenue, contribution),
    expectedBillableMinor: expected,
    unbilledMinor: Math.max(expected - revenue, 0),
    budgetMinor: budget,
    budgetVarianceMinor: budget === null ? null : budget - actualCost,
  };
}

function aggregate(
  rows: ProfitRow[],
  dimension: ProjectProfitabilityRollup["dimension"],
  keyOf: (row: ProfitRow) => string,
  labelOf: (row: ProfitRow) => string,
): ProjectProfitabilityRollup[] {
  const buckets = new Map<string, ProjectProfitabilityRollup>();
  for (const row of rows) {
    const key = `${row.currency}:${keyOf(row)}`;
    const current = buckets.get(key) ?? {
      dimension,
      key: keyOf(row),
      label: labelOf(row),
      currency: row.currency,
      invoicedRevenueMinor: 0,
      laborCostMinor: 0,
      vendorCostMinor: 0,
      projectExpenseMinor: 0,
      grossContributionMinor: 0,
      marginPercent: null,
    };
    const p = toProfitability(row);
    current.invoicedRevenueMinor += p.invoicedRevenueMinor;
    current.laborCostMinor += p.laborCostMinor;
    current.vendorCostMinor += p.vendorCostMinor;
    current.projectExpenseMinor += p.projectExpenseMinor;
    current.grossContributionMinor += p.grossContributionMinor;
    current.marginPercent = margin(current.invoicedRevenueMinor, current.grossContributionMinor);
    buckets.set(key, current);
  }
  return [...buckets.values()].sort(
    (left, right) => right.grossContributionMinor - left.grossContributionMinor,
  );
}

export async function getProjectProfitabilityForContext(
  context: CurrentPermissionContext,
): Promise<{
  byProject: Map<string, ProjectProfitability>;
  rollups: ProjectProfitabilityRollup[];
}> {
  if (!context.permissions.has(projectPermissionKeys.projectView)) {
    return { byProject: new Map(), rollups: [] };
  }
  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const scope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";

  const [rows, monthRows] = await Promise.all([
    database<ProfitRow[]>`
      with invoice_credit as (
        select credit.original_invoice_id,
          coalesce(sum(greatest(credit.subtotal_minor - credit.discount_minor, 0)) filter (
            where credit.status in ('issued', 'sent')
          ), 0)::bigint as credited_minor
        from public.finance_credit_notes credit
        where credit.organization_id = ${organizationId}::uuid
        group by credit.original_invoice_id
      ), invoice_summary as (
        select invoice.project_id,
          coalesce(sum(greatest(invoice.subtotal_minor - invoice.discount_minor, 0) - coalesce(invoice_credit.credited_minor, 0)) filter (
            where invoice.status in ('issued', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'disputed', 'credited')
          ), 0)::bigint as revenue_minor
        from public.finance_invoices invoice
        left join invoice_credit on invoice_credit.original_invoice_id = invoice.id
        where invoice.organization_id = ${organizationId}::uuid
        group by invoice.project_id
      ), labor_summary as (
        select entry.project_id,
          coalesce(sum(round(entry.minutes * entry.hourly_cost_rate_minor / 60.0)), 0)::bigint as labor_cost_minor,
          coalesce(sum(entry.minutes) filter (where entry.submission_status = 'submitted'), 0)::bigint as billable_minutes
        from public.project_time_entries entry
        where entry.organization_id = ${organizationId}::uuid
        group by entry.project_id
      ), expense_summary as (
        select allocation.project_id,
          coalesce(sum(allocation.amount_minor) filter (where expense.expense_type = 'vendor' and expense.approval_status <> 'rejected'), 0)::bigint as vendor_cost_minor,
          coalesce(sum(allocation.amount_minor) filter (where expense.expense_type <> 'vendor' and expense.approval_status <> 'rejected'), 0)::bigint as project_expense_minor
        from public.finance_expense_project_allocations allocation
        join public.finance_expenses expense on expense.id = allocation.expense_id
        where allocation.organization_id = ${organizationId}::uuid
        group by allocation.project_id
      ), committed_vendor as (
        select request.project_id,
          coalesce(sum(purchase_order.total_minor) filter (where purchase_order.status <> 'cancelled'), 0)::bigint as committed_vendor_minor
        from public.procurement_purchase_requests request
        join public.procurement_purchase_orders purchase_order on purchase_order.purchase_request_id = request.id
        where request.organization_id = ${organizationId}::uuid
        group by request.project_id
      )
      select project.id as project_id, project.name as project_name,
        project.company_id, coalesce(company.display_name, company.legal_name) as company_name,
        project.owner_membership_id,
        coalesce(owner_profile.display_name, owner_user.email, 'AgencyOS user') as owner_name,
        owner.department_id, department.name as department_name,
        project.currency, project.budget_minor, project.billing_method,
        project.hourly_rate_minor, project.fixed_price_minor, project.retainer_amount_minor,
        coalesce(invoice_summary.revenue_minor, 0)::bigint as invoiced_revenue_minor,
        coalesce(labor_summary.labor_cost_minor, 0)::bigint as labor_cost_minor,
        coalesce(expense_summary.vendor_cost_minor, 0)::bigint as vendor_cost_minor,
        coalesce(expense_summary.project_expense_minor, 0)::bigint as project_expense_minor,
        coalesce(committed_vendor.committed_vendor_minor, 0)::bigint as committed_vendor_minor,
        coalesce(labor_summary.billable_minutes, 0)::bigint as billable_minutes
      from public.projects project
      join public.memberships owner on owner.id = project.owner_membership_id
      join public.identity_accounts owner_user on owner_user.id = owner.user_id
      left join public.profiles owner_profile on owner_profile.id = owner.user_id
      left join public.departments department on department.id = owner.department_id
      left join public.crm_companies company on company.id = project.company_id
      left join invoice_summary on invoice_summary.project_id = project.id
      left join labor_summary on labor_summary.project_id = project.id
      left join expense_summary on expense_summary.project_id = project.id
      left join committed_vendor on committed_vendor.project_id = project.id
      where project.organization_id = ${organizationId}::uuid
        and private.project_is_visible(project.id, ${membershipId}::uuid, ${scope})
    `,
    database<MonthRow[]>`
      with months as (
        select date_trunc('month', source.month_date)::date as month, source.currency,
          sum(source.revenue_minor)::bigint as invoiced_revenue_minor,
          sum(source.labor_minor)::bigint as labor_cost_minor,
          sum(source.vendor_minor)::bigint as vendor_cost_minor,
          sum(source.expense_minor)::bigint as project_expense_minor
        from (
          select coalesce(invoice.issue_date, invoice.created_at::date) as month_date, invoice.currency,
            greatest(invoice.subtotal_minor - invoice.discount_minor, 0)::bigint as revenue_minor,
            0::bigint as labor_minor, 0::bigint as vendor_minor, 0::bigint as expense_minor,
            invoice.project_id
          from public.finance_invoices invoice
          where invoice.organization_id = ${organizationId}::uuid
            and invoice.project_id is not null
            and invoice.status in ('issued','sent','viewed','partially_paid','paid','overdue','disputed','credited')
          union all
          select coalesce(credit.issue_date, credit.created_at::date), credit.currency,
            -greatest(credit.subtotal_minor - credit.discount_minor, 0)::bigint,
            0::bigint, 0::bigint, 0::bigint, invoice.project_id
          from public.finance_credit_notes credit
          join public.finance_invoices invoice on invoice.id = credit.original_invoice_id
          where credit.organization_id = ${organizationId}::uuid
            and invoice.project_id is not null
            and credit.status in ('issued','sent')
          union all
          select entry.work_date, project.currency, 0,
            round(entry.minutes * entry.hourly_cost_rate_minor / 60.0)::bigint, 0, 0, entry.project_id
          from public.project_time_entries entry
          join public.projects project on project.id = entry.project_id
          where entry.organization_id = ${organizationId}::uuid
          union all
          select expense.expense_date, expense.currency, 0, 0,
            case when expense.expense_type = 'vendor' then allocation.amount_minor else 0 end,
            case when expense.expense_type <> 'vendor' then allocation.amount_minor else 0 end,
            allocation.project_id
          from public.finance_expense_project_allocations allocation
          join public.finance_expenses expense on expense.id = allocation.expense_id
          where allocation.organization_id = ${organizationId}::uuid and expense.approval_status <> 'rejected'
        ) source
        join public.projects visible_project on visible_project.id = source.project_id
        where private.project_is_visible(visible_project.id, ${membershipId}::uuid, ${scope})
        group by date_trunc('month', source.month_date)::date, source.currency
      )
      select month::text as month, currency, invoiced_revenue_minor, labor_cost_minor,
        vendor_cost_minor, project_expense_minor
      from months order by month desc, currency
      limit 120
    `,
  ]);

  const byProject = new Map(rows.map((row) => [row.project_id, toProfitability(row)]));
  const rollups = [
    ...aggregate(
      rows,
      "project",
      (row) => row.project_id,
      (row) => row.project_name,
    ),
    ...aggregate(
      rows,
      "client",
      (row) => row.company_id ?? "internal",
      (row) => row.company_name ?? "Internal",
    ),
    ...aggregate(
      rows,
      "project_manager",
      (row) => row.owner_membership_id,
      (row) => row.owner_name,
    ),
    ...aggregate(
      rows,
      "department",
      (row) => row.department_id ?? "unassigned",
      (row) => row.department_name ?? "No department",
    ),
    ...monthRows.map((row): ProjectProfitabilityRollup => {
      const revenue = amount(row.invoiced_revenue_minor);
      const labor = amount(row.labor_cost_minor);
      const vendor = amount(row.vendor_cost_minor);
      const expenses = amount(row.project_expense_minor);
      const contribution = revenue - labor - vendor - expenses;
      return {
        dimension: "month",
        key: row.month,
        label: row.month.slice(0, 7),
        currency: row.currency,
        invoicedRevenueMinor: revenue,
        laborCostMinor: labor,
        vendorCostMinor: vendor,
        projectExpenseMinor: expenses,
        grossContributionMinor: contribution,
        marginPercent: margin(revenue, contribution),
      };
    }),
  ];

  return { byProject, rollups };
}
