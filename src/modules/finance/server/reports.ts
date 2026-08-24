import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import type { FinanceFilters } from "@/modules/finance/schemas/finance";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";
import { reportsPermissionKeys } from "@/modules/reports/reports";

export interface FinanceRevenueMonth {
  month: string;
  revenueMinor: number;
}

export interface FinanceRevenueClient {
  companyId: string;
  companyName: string;
  invoiceMinor: number;
  creditMinor: number;
  netRevenueMinor: number;
}

export interface FinanceProjectMargin {
  projectId: string | null;
  projectCode: string | null;
  projectName: string;
  revenueMinor: number;
  expenseMinor: number;
  grossProfitMinor: number;
}

export interface FinanceRevenueService {
  catalogItemId: string | null;
  itemName: string;
  quantityMilli: number;
  revenueMinor: number;
}

export interface FinanceExpenseReportRow {
  id: string;
  label: string;
  amountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface FinanceClientStatementEntry {
  id: string;
  date: string;
  entryType: "invoice" | "credit_note" | "payment" | "refund";
  reference: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}

export interface FinanceClientStatement {
  companyId: string;
  companyName: string;
  openingBalanceMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingBalanceMinor: number;
  isTruncated: boolean;
  entries: FinanceClientStatementEntry[];
  downloadHref: string;
}

export interface FinanceReportData {
  reportPeriod: {
    from: string;
    to: string;
  };
  revenueByMonth: FinanceRevenueMonth[];
  revenueByClient: FinanceRevenueClient[];
  projectMargins: FinanceProjectMargin[];
  revenueByService: FinanceRevenueService[];
  expenseByCategory: FinanceExpenseReportRow[];
  expenseByProject: FinanceExpenseReportRow[];
  paymentCollection: {
    paidInvoiceCount: number;
    averageDays: number | null;
    medianDays: number | null;
  };
  estimateConversion: {
    eligibleCount: number;
    convertedCount: number;
    rateBps: number;
    convertedValueMinor: number;
  };
  taxSummary: {
    invoiceTaxMinor: number;
    creditTaxMinor: number;
    expenseTaxMinor: number;
    netTaxMinor: number;
  };
  clientStatement: FinanceClientStatement | null;
}

export type FinanceClientStatementResult =
  | {
      allowed: true;
      statement: FinanceClientStatement;
      currency: string;
      locale: string;
      period: FinanceReportData["reportPeriod"];
    }
  | { allowed: false; reason: AuthorizationFailureReason | "company-required" | "not-found" };

interface OrganizationReportRow {
  default_currency: string;
  number_format: string;
}

interface RevenueMonthRow {
  month: string;
  revenue_minor: string | number;
}

interface RevenueClientRow {
  company_id: string;
  company_name: string;
  invoice_minor: string | number;
  credit_minor: string | number;
  net_revenue_minor: string | number;
}

interface ProjectMarginRow {
  project_id: string | null;
  project_code: string | null;
  project_name: string;
  revenue_minor: string | number;
  expense_minor: string | number;
  gross_profit_minor: string | number;
}

interface RevenueServiceRow {
  catalog_item_id: string | null;
  item_name: string;
  quantity_milli: string | number;
  revenue_minor: string | number;
}

interface ExpenseReportRow {
  id: string;
  label: string;
  amount_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
}

interface PaymentCollectionRow {
  paid_invoice_count: string | number;
  average_days: string | number | null;
  median_days: string | number | null;
}

interface EstimateConversionRow {
  eligible_count: string | number;
  converted_count: string | number;
  converted_value_minor: string | number;
}

interface TaxSummaryRow {
  invoice_tax_minor: string | number;
  credit_tax_minor: string | number;
  expense_tax_minor: string | number;
}

interface StatementCompanyRow {
  id: string;
  name: string;
}

interface StatementOpeningRow {
  opening_balance_minor: string | number;
}

interface StatementEntryRow {
  entry_id: string;
  entry_date: string;
  entry_type: FinanceClientStatementEntry["entryType"];
  reference: string;
  description: string;
  debit_minor: string | number;
  credit_minor: string | number;
  sort_order: number;
  total_entries: string | number;
  period_debit_minor: string | number;
  period_credit_minor: string | number;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function resolveFinanceReportPeriod(filters: FinanceFilters): { from: string; to: string } {
  const now = new Date();
  const today = isoDate(now);
  const yearStart = `${now.getUTCFullYear()}-01-01`;
  const from = filters.from ?? yearStart;
  const to = filters.to ?? today;

  if (from > to) return { from: yearStart, to: today };
  return { from, to };
}

function emptyReportData(period: FinanceReportData["reportPeriod"]): FinanceReportData {
  return {
    reportPeriod: period,
    revenueByMonth: [],
    revenueByClient: [],
    projectMargins: [],
    revenueByService: [],
    expenseByCategory: [],
    expenseByProject: [],
    paymentCollection: { paidInvoiceCount: 0, averageDays: null, medianDays: null },
    estimateConversion: {
      eligibleCount: 0,
      convertedCount: 0,
      rateBps: 0,
      convertedValueMinor: 0,
    },
    taxSummary: {
      invoiceTaxMinor: 0,
      creditTaxMinor: 0,
      expenseTaxMinor: 0,
      netTaxMinor: 0,
    },
    clientStatement: null,
  };
}

async function loadClientStatement(
  database: Sql,
  organizationId: string,
  companyId: string,
  from: string,
  to: string,
): Promise<FinanceClientStatement | null> {
  const [companyRows, openingRows, entryRows] = await Promise.all([
    database<StatementCompanyRow[]>`
      select company.id, coalesce(company.display_name, company.legal_name) as name
      from public.crm_companies as company
      where company.organization_id = ${organizationId}::uuid
        and company.id = ${companyId}::uuid
      limit 1
    `,
    database<StatementOpeningRow[]>`
      with movements as (
        select invoice.issue_date as movement_date,
          invoice.total_minor::bigint as debit_minor,
          0::bigint as credit_minor
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
        union all
        select credit.issue_date,
          0::bigint,
          (credit.subtotal_minor - credit.discount_minor)::bigint
        from public.finance_credit_notes as credit
        join public.finance_invoices as invoice on invoice.id = credit.original_invoice_id
        join public.organizations as organization on organization.id = credit.organization_id
        where credit.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
        union all
        select payment.payment_date,
          0::bigint,
          allocation.amount_minor::bigint
        from public.finance_payment_allocations as allocation
        join public.finance_payments as payment on payment.id = allocation.payment_id
        join public.finance_invoices as invoice on invoice.id = allocation.invoice_id
        join public.organizations as organization on organization.id = payment.organization_id
        where payment.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and payment.currency = organization.default_currency
        union all
        select refund.refund_date,
          refund.amount_minor::bigint,
          0::bigint
        from public.finance_payment_refunds as refund
        join public.finance_payments as payment on payment.id = refund.payment_id
        join public.organizations as organization on organization.id = refund.organization_id
        where refund.organization_id = ${organizationId}::uuid
          and payment.company_id = ${companyId}::uuid
          and payment.currency = organization.default_currency
      )
      select coalesce(sum(debit_minor - credit_minor), 0)::bigint as opening_balance_minor
      from movements
      where movement_date < ${from}::date
    `,
    database<StatementEntryRow[]>`
      with movements as (
        select invoice.id::text as entry_id,
          invoice.issue_date as entry_date,
          'invoice'::text as entry_type,
          coalesce(invoice.invoice_number, invoice.draft_reference) as reference,
          'Invoice issued'::text as description,
          invoice.total_minor::bigint as debit_minor,
          0::bigint as credit_minor,
          1 as sort_order
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${from}::date and ${to}::date
        union all
        select credit.id::text,
          credit.issue_date,
          'credit_note'::text,
          coalesce(credit.credit_note_number, 'Credit note'),
          'Credit note issued'::text,
          0::bigint,
          credit.total_minor::bigint,
          2
        from public.finance_credit_notes as credit
        join public.finance_invoices as invoice on invoice.id = credit.original_invoice_id
        join public.organizations as organization on organization.id = credit.organization_id
        where credit.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
          and credit.issue_date between ${from}::date and ${to}::date
        union all
        select allocation.id::text,
          payment.payment_date,
          'payment'::text,
          coalesce(payment.transaction_reference, 'Payment'),
          concat('Payment allocated to ', coalesce(invoice.invoice_number, invoice.draft_reference)),
          0::bigint,
          allocation.amount_minor::bigint,
          3
        from public.finance_payment_allocations as allocation
        join public.finance_payments as payment on payment.id = allocation.payment_id
        join public.finance_invoices as invoice on invoice.id = allocation.invoice_id
        join public.organizations as organization on organization.id = payment.organization_id
        where payment.organization_id = ${organizationId}::uuid
          and invoice.company_id = ${companyId}::uuid
          and payment.currency = organization.default_currency
          and payment.payment_date between ${from}::date and ${to}::date
        union all
        select refund.id::text,
          refund.refund_date,
          'refund'::text,
          coalesce(refund.transaction_reference, 'Refund'),
          refund.reason,
          refund.amount_minor::bigint,
          0::bigint,
          4
        from public.finance_payment_refunds as refund
        join public.finance_payments as payment on payment.id = refund.payment_id
        join public.organizations as organization on organization.id = refund.organization_id
        where refund.organization_id = ${organizationId}::uuid
          and payment.company_id = ${companyId}::uuid
          and payment.currency = organization.default_currency
          and refund.refund_date between ${from}::date and ${to}::date
      )
      select entry_id, entry_date::text, entry_type, reference, description,
        debit_minor, credit_minor, sort_order,
        count(*) over ()::bigint as total_entries,
        sum(debit_minor) over ()::bigint as period_debit_minor,
        sum(credit_minor) over ()::bigint as period_credit_minor
      from movements
      order by entry_date, sort_order, reference
      limit 5000
    `,
  ]);

  const company = companyRows[0];
  if (!company) return null;

  let balance = Number(openingRows[0]?.opening_balance_minor ?? 0);
  const periodDebitMinor = Number(entryRows[0]?.period_debit_minor ?? 0);
  const periodCreditMinor = Number(entryRows[0]?.period_credit_minor ?? 0);
  const entries = entryRows.map((row) => {
    const debitMinor = Number(row.debit_minor);
    const creditMinor = Number(row.credit_minor);
    balance += debitMinor - creditMinor;
    return {
      id: row.entry_id,
      date: row.entry_date,
      entryType: row.entry_type,
      reference: row.reference,
      description: row.description,
      debitMinor,
      creditMinor,
      balanceMinor: balance,
    } satisfies FinanceClientStatementEntry;
  });

  const params = new URLSearchParams({ company: company.id, from, to });
  return {
    companyId: company.id,
    companyName: company.name,
    openingBalanceMinor: Number(openingRows[0]?.opening_balance_minor ?? 0),
    periodDebitMinor,
    periodCreditMinor,
    closingBalanceMinor:
      Number(openingRows[0]?.opening_balance_minor ?? 0) + periodDebitMinor - periodCreditMinor,
    isTruncated: Number(entryRows[0]?.total_entries ?? 0) > entries.length,
    entries,
    downloadHref: `/api/finance/reports/client-statement?${params.toString()}`,
  };
}

export async function loadFinanceReportData(
  database: Sql,
  context: CurrentPermissionContext,
  filters: FinanceFilters,
): Promise<FinanceReportData> {
  const period = resolveFinanceReportPeriod(filters);
  if (filters.tab !== "reports" || !context.permissions.has(financePermissionKeys.reportView)) {
    return emptyReportData(period);
  }

  const organizationId = context.membership.organizationId;
  const { from, to } = period;

  const [
    revenueMonthRows,
    revenueClientRows,
    projectMarginRows,
    revenueServiceRows,
    expenseCategoryRows,
    expenseProjectRows,
    paymentCollectionRows,
    estimateConversionRows,
    taxSummaryRows,
    clientStatement,
  ] = await Promise.all([
    database<RevenueMonthRow[]>`
      with months as (
        select generate_series(
          date_trunc('month', ${from}::date),
          date_trunc('month', ${to}::date),
          interval '1 month'
        )::date as month
      ), movements as (
        select date_trunc('month', invoice.issue_date)::date as month,
          (invoice.subtotal_minor - invoice.discount_minor)::bigint as amount_minor
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${from}::date and ${to}::date
        union all
        select date_trunc('month', credit.issue_date)::date,
          -(credit.subtotal_minor - credit.discount_minor)::bigint
        from public.finance_credit_notes as credit
        join public.organizations as organization on organization.id = credit.organization_id
        where credit.organization_id = ${organizationId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
          and credit.issue_date between ${from}::date and ${to}::date
      )
      select to_char(months.month, 'YYYY-MM') as month,
        coalesce(sum(movements.amount_minor), 0)::bigint as revenue_minor
      from months
      left join movements on movements.month = months.month
      group by months.month
      order by months.month
    `,
    database<RevenueClientRow[]>`
      with movements as (
        select invoice.company_id,
          (invoice.subtotal_minor - invoice.discount_minor)::bigint as invoice_minor,
          0::bigint as credit_minor
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${from}::date and ${to}::date
        union all
        select invoice.company_id,
          0::bigint,
          credit.total_minor::bigint
        from public.finance_credit_notes as credit
        join public.finance_invoices as invoice on invoice.id = credit.original_invoice_id
        join public.organizations as organization on organization.id = credit.organization_id
        where credit.organization_id = ${organizationId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
          and credit.issue_date between ${from}::date and ${to}::date
      )
      select company.id as company_id,
        coalesce(company.display_name, company.legal_name) as company_name,
        sum(movements.invoice_minor)::bigint as invoice_minor,
        sum(movements.credit_minor)::bigint as credit_minor,
        sum(movements.invoice_minor - movements.credit_minor)::bigint as net_revenue_minor
      from movements
      join public.crm_companies as company on company.id = movements.company_id
      group by company.id, company.display_name, company.legal_name
      order by net_revenue_minor desc, lower(coalesce(company.display_name, company.legal_name))
      limit 100
    `,
    database<ProjectMarginRow[]>`
      with revenue as (
        select invoice.project_id,
          sum(invoice.subtotal_minor - invoice.discount_minor)::bigint as invoice_minor,
          0::bigint as credit_minor
        from public.finance_invoices as invoice
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${from}::date and ${to}::date
        group by invoice.project_id
        union all
        select invoice.project_id,
          0::bigint,
          sum(credit.subtotal_minor - credit.discount_minor)::bigint
        from public.finance_credit_notes as credit
        join public.finance_invoices as invoice on invoice.id = credit.original_invoice_id
        join public.organizations as organization on organization.id = credit.organization_id
        where credit.organization_id = ${organizationId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
          and credit.issue_date between ${from}::date and ${to}::date
        group by invoice.project_id
      ), revenue_totals as (
        select project_id, sum(invoice_minor - credit_minor)::bigint as revenue_minor
        from revenue
        group by project_id
      ), expense_totals as (
        select allocation.project_id,
          sum(allocation.amount_minor)::bigint as expense_minor
        from public.finance_expense_project_allocations as allocation
        join public.finance_expenses as expense on expense.id = allocation.expense_id
        join public.organizations as organization on organization.id = expense.organization_id
        where expense.organization_id = ${organizationId}::uuid
          and expense.approval_status in ('approved', 'not_required')
          and expense.currency = organization.default_currency
          and expense.expense_date between ${from}::date and ${to}::date
        group by allocation.project_id
      ), project_keys as (
        select project_id from revenue_totals
        union
        select project_id from expense_totals
      )
      select key.project_id,
        project.code as project_code,
        coalesce(project.name, 'Unassigned') as project_name,
        coalesce(revenue.revenue_minor, 0)::bigint as revenue_minor,
        coalesce(expense.expense_minor, 0)::bigint as expense_minor,
        (coalesce(revenue.revenue_minor, 0) - coalesce(expense.expense_minor, 0))::bigint
          as gross_profit_minor
      from project_keys as key
      left join public.projects as project on project.id = key.project_id
      left join revenue_totals as revenue on revenue.project_id is not distinct from key.project_id
      left join expense_totals as expense on expense.project_id is not distinct from key.project_id
      order by gross_profit_minor desc, lower(coalesce(project.name, 'Unassigned'))
      limit 250
    `,
    database<RevenueServiceRow[]>`
      with movements as (
        select line.catalog_item_id,
          coalesce(item.name, line.description) as item_name,
          line.quantity_milli::bigint as quantity_milli,
          (line.subtotal_minor - line.discount_minor)::bigint as revenue_minor
        from public.finance_invoice_lines as line
        join public.finance_invoices as invoice on invoice.id = line.invoice_id
        join public.organizations as organization on organization.id = invoice.organization_id
        left join public.finance_catalog_items as item on item.id = line.catalog_item_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issued_at is not null
          and invoice.status <> 'void'
          and invoice.currency = organization.default_currency
          and invoice.issue_date between ${from}::date and ${to}::date
        union all
        select line.catalog_item_id,
          coalesce(item.name, line.description),
          -line.quantity_milli::bigint,
          -(line.subtotal_minor - line.discount_minor)::bigint
        from public.finance_credit_note_lines as line
        join public.finance_credit_notes as credit on credit.id = line.credit_note_id
        join public.organizations as organization on organization.id = credit.organization_id
        left join public.finance_catalog_items as item on item.id = line.catalog_item_id
        where credit.organization_id = ${organizationId}::uuid
          and credit.issued_at is not null
          and credit.status <> 'void'
          and credit.currency = organization.default_currency
          and credit.issue_date between ${from}::date and ${to}::date
      )
      select catalog_item_id, item_name,
        sum(quantity_milli)::bigint as quantity_milli,
        sum(revenue_minor)::bigint as revenue_minor
      from movements
      group by catalog_item_id, item_name
      order by revenue_minor desc, lower(item_name)
      limit 100
    `,
    database<ExpenseReportRow[]>`
      select category.id, category.name as label,
        sum(expense.amount_minor)::bigint as amount_minor,
        sum(expense.tax_minor)::bigint as tax_minor,
        sum(expense.total_minor)::bigint as total_minor
      from public.finance_expenses as expense
      join public.finance_expense_categories as category on category.id = expense.category_id
      join public.organizations as organization on organization.id = expense.organization_id
      where expense.organization_id = ${organizationId}::uuid
        and expense.approval_status in ('approved', 'not_required')
        and expense.currency = organization.default_currency
        and expense.expense_date between ${from}::date and ${to}::date
      group by category.id, category.name
      order by total_minor desc, lower(category.name)
      limit 100
    `,
    database<ExpenseReportRow[]>`
      select project.id,
        concat(project.code, ' · ', project.name) as label,
        sum(allocation.amount_minor)::bigint as amount_minor,
        0::bigint as tax_minor,
        sum(allocation.amount_minor)::bigint as total_minor
      from public.finance_expense_project_allocations as allocation
      join public.finance_expenses as expense on expense.id = allocation.expense_id
      join public.projects as project on project.id = allocation.project_id
      join public.organizations as organization on organization.id = expense.organization_id
      where expense.organization_id = ${organizationId}::uuid
        and expense.approval_status in ('approved', 'not_required')
        and expense.currency = organization.default_currency
        and expense.expense_date between ${from}::date and ${to}::date
      group by project.id, project.code, project.name
      order by total_minor desc, lower(project.name)
      limit 250
    `,
    database<PaymentCollectionRow[]>`
      with collected as (
        select invoice.id,
          greatest(0, max(payment.payment_date) - invoice.issue_date)::integer as collection_days
        from public.finance_invoices as invoice
        join public.finance_payment_allocations as allocation on allocation.invoice_id = invoice.id
        join public.finance_payments as payment on payment.id = allocation.payment_id
        join public.organizations as organization on organization.id = invoice.organization_id
        where invoice.organization_id = ${organizationId}::uuid
          and invoice.issue_date between ${from}::date and ${to}::date
          and invoice.issued_at is not null
          and invoice.status = 'paid'
          and invoice.currency = organization.default_currency
        group by invoice.id, invoice.issue_date, invoice.total_minor
        having sum(allocation.amount_minor) >= invoice.total_minor
      )
      select count(*)::bigint as paid_invoice_count,
        round(avg(collection_days)::numeric, 1) as average_days,
        percentile_cont(0.5) within group (order by collection_days) as median_days
      from collected
    `,
    database<EstimateConversionRow[]>`
      select count(*)::bigint as eligible_count,
        count(*) filter (where estimate.status = 'converted')::bigint as converted_count,
        coalesce(sum(estimate.total_minor) filter (where estimate.status = 'converted'), 0)::bigint
          as converted_value_minor
      from public.finance_estimates as estimate
      join public.organizations as organization on organization.id = estimate.organization_id
      where estimate.organization_id = ${organizationId}::uuid
        and estimate.issue_date between ${from}::date and ${to}::date
        and estimate.currency = organization.default_currency
        and estimate.status in ('sent', 'accepted', 'rejected', 'expired', 'converted')
    `,
    database<TaxSummaryRow[]>`
      select
        coalesce((
          select sum(invoice.tax_minor)
          from public.finance_invoices as invoice
          join public.organizations as organization on organization.id = invoice.organization_id
          where invoice.organization_id = ${organizationId}::uuid
            and invoice.issued_at is not null
            and invoice.status <> 'void'
            and invoice.currency = organization.default_currency
            and invoice.issue_date between ${from}::date and ${to}::date
        ), 0)::bigint as invoice_tax_minor,
        coalesce((
          select sum(credit.tax_minor)
          from public.finance_credit_notes as credit
          join public.organizations as organization on organization.id = credit.organization_id
          where credit.organization_id = ${organizationId}::uuid
            and credit.issued_at is not null
            and credit.status <> 'void'
            and credit.currency = organization.default_currency
            and credit.issue_date between ${from}::date and ${to}::date
        ), 0)::bigint as credit_tax_minor,
        coalesce((
          select sum(expense.tax_minor)
          from public.finance_expenses as expense
          join public.organizations as organization on organization.id = expense.organization_id
          where expense.organization_id = ${organizationId}::uuid
            and expense.approval_status in ('approved', 'not_required')
            and expense.currency = organization.default_currency
            and expense.expense_date between ${from}::date and ${to}::date
        ), 0)::bigint as expense_tax_minor
    `,
    filters.company
      ? loadClientStatement(database, organizationId, filters.company, from, to)
      : Promise.resolve(null),
  ]);

  const paymentCollection = paymentCollectionRows[0];
  const estimateConversion = estimateConversionRows[0];
  const eligibleCount = Number(estimateConversion?.eligible_count ?? 0);
  const convertedCount = Number(estimateConversion?.converted_count ?? 0);
  const taxSummary = taxSummaryRows[0];
  const invoiceTaxMinor = Number(taxSummary?.invoice_tax_minor ?? 0);
  const creditTaxMinor = Number(taxSummary?.credit_tax_minor ?? 0);
  const expenseTaxMinor = Number(taxSummary?.expense_tax_minor ?? 0);

  return {
    reportPeriod: period,
    revenueByMonth: revenueMonthRows.map((row) => ({
      month: row.month,
      revenueMinor: Number(row.revenue_minor),
    })),
    revenueByClient: revenueClientRows.map((row) => ({
      companyId: row.company_id,
      companyName: row.company_name,
      invoiceMinor: Number(row.invoice_minor),
      creditMinor: Number(row.credit_minor),
      netRevenueMinor: Number(row.net_revenue_minor),
    })),
    projectMargins: projectMarginRows.map((row) => ({
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      revenueMinor: Number(row.revenue_minor),
      expenseMinor: Number(row.expense_minor),
      grossProfitMinor: Number(row.gross_profit_minor),
    })),
    revenueByService: revenueServiceRows.map((row) => ({
      catalogItemId: row.catalog_item_id,
      itemName: row.item_name,
      quantityMilli: Number(row.quantity_milli),
      revenueMinor: Number(row.revenue_minor),
    })),
    expenseByCategory: expenseCategoryRows.map((row) => ({
      id: row.id,
      label: row.label,
      amountMinor: Number(row.amount_minor),
      taxMinor: Number(row.tax_minor),
      totalMinor: Number(row.total_minor),
    })),
    expenseByProject: expenseProjectRows.map((row) => ({
      id: row.id,
      label: row.label,
      amountMinor: Number(row.amount_minor),
      taxMinor: Number(row.tax_minor),
      totalMinor: Number(row.total_minor),
    })),
    paymentCollection: {
      paidInvoiceCount: Number(paymentCollection?.paid_invoice_count ?? 0),
      averageDays:
        paymentCollection?.average_days === null || paymentCollection?.average_days === undefined
          ? null
          : Number(paymentCollection.average_days),
      medianDays:
        paymentCollection?.median_days === null || paymentCollection?.median_days === undefined
          ? null
          : Number(paymentCollection.median_days),
    },
    estimateConversion: {
      eligibleCount,
      convertedCount,
      rateBps: eligibleCount > 0 ? Math.round((convertedCount * 10_000) / eligibleCount) : 0,
      convertedValueMinor: Number(estimateConversion?.converted_value_minor ?? 0),
    },
    taxSummary: {
      invoiceTaxMinor,
      creditTaxMinor,
      expenseTaxMinor,
      netTaxMinor: invoiceTaxMinor - creditTaxMinor - expenseTaxMinor,
    },
    clientStatement,
  };
}

export async function getFinanceClientStatementExport(
  filters: FinanceFilters,
): Promise<FinanceClientStatementResult> {
  if (!filters.company) return { allowed: false, reason: "company-required" };
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const permissions = permissionResult.context.permissions;
  if (
    !permissions.has(financePermissionKeys.reportView) ||
    !permissions.has(reportsPermissionKeys.export)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = permissionResult.context.membership.organizationId;
  const period = resolveFinanceReportPeriod(filters);

  try {
    const [organizationRows, statement] = await withInfrastructureRetry(
      () =>
        Promise.all([
          database<OrganizationReportRow[]>`
            select default_currency, number_format
            from public.organizations
            where id = ${organizationId}::uuid
            limit 1
          `,
          loadClientStatement(
            database,
            organizationId,
            filters.company as string,
            period.from,
            period.to,
          ),
        ]),
      { attempts: 2, operationName: "Finance client statement export" },
    );

    const organization = organizationRows[0];
    if (!organization || !statement) return { allowed: false, reason: "not-found" };
    return {
      allowed: true,
      statement,
      currency: organization.default_currency,
      locale: organization.number_format,
      period,
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}

export async function auditFinanceClientStatementExport(
  database: Sql,
  context: CurrentPermissionContext,
  input: { companyId: string; from: string; to: string; rowCount: number },
): Promise<void> {
  await writeAuditEvent(database, context, {
    action: "reports.exported",
    entityType: "finance_client_statement",
    entityId: input.companyId,
    source: "api",
    metadata: {
      section: "finance",
      report: "client_statement",
      client: input.companyId,
      from: input.from,
      to: input.to,
      rowCount: input.rowCount,
      format: "csv",
    },
  });
}
