import "server-only";

import type { Sql } from "postgres";

import { financePermissionKeys } from "@/modules/finance/finance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface MonthlyFinancialTrendRow {
  revenue_last_month: string | number;
  revenue_previous_month: string | number;
  cash_last_month: string | number;
  cash_previous_month: string | number;
  expenses_last_month: string | number;
  expenses_previous_month: string | number;
}

export async function monthlyFinancialTrend(
  database: Sql,
  context: CurrentPermissionContext,
  currency: string,
): Promise<MonthlyFinancialTrendRow> {
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const canFinance = context.permissions.has(financePermissionKeys.reportView);
  const canPayments = context.permissions.has(financePermissionKeys.paymentView);
  const canExpenses = context.permissions.has(financePermissionKeys.expenseView);
  const expenseScope = context.permissionScopes.get(financePermissionKeys.expenseView) ?? "own";
  const rows = await database<MonthlyFinancialTrendRow[]>`
    with bounds as (
      select date_trunc('month', (now() at time zone organization.timezone)::date)::date as this_month
      from public.organizations organization where organization.id = ${org}::uuid
    )
    select
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor) from public.finance_invoices invoice, bounds
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.issue_date >= bounds.this_month - interval '1 month'
          and invoice.issue_date < bounds.this_month), 0)::bigint as revenue_last_month,
      coalesce((select sum(invoice.subtotal_minor - invoice.discount_minor) from public.finance_invoices invoice, bounds
        where ${canFinance} and invoice.organization_id = ${org}::uuid and invoice.currency = ${currency}
          and invoice.issued_at is not null and invoice.status <> 'void'
          and invoice.issue_date >= bounds.this_month - interval '2 months'
          and invoice.issue_date < bounds.this_month - interval '1 month'), 0)::bigint as revenue_previous_month,
      coalesce((select sum(payment.amount_minor) from public.finance_payments payment, bounds
        where ${canPayments} and payment.organization_id = ${org}::uuid and payment.currency = ${currency}
          and payment.payment_date >= bounds.this_month - interval '1 month'
          and payment.payment_date < bounds.this_month), 0)::bigint as cash_last_month,
      coalesce((select sum(payment.amount_minor) from public.finance_payments payment, bounds
        where ${canPayments} and payment.organization_id = ${org}::uuid and payment.currency = ${currency}
          and payment.payment_date >= bounds.this_month - interval '2 months'
          and payment.payment_date < bounds.this_month - interval '1 month'), 0)::bigint as cash_previous_month,
      coalesce((select sum(expense.total_minor) from public.finance_expenses expense, bounds
        where ${canExpenses} and expense.organization_id = ${org}::uuid and expense.currency = ${currency}
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${expenseScope}, expense.employee_membership_id, expense.created_by_membership_id
          )
          and expense.approval_status <> 'rejected'
          and expense.expense_date >= bounds.this_month - interval '1 month'
          and expense.expense_date < bounds.this_month), 0)::bigint as expenses_last_month,
      coalesce((select sum(expense.total_minor) from public.finance_expenses expense, bounds
        where ${canExpenses} and expense.organization_id = ${org}::uuid and expense.currency = ${currency}
          and private.crm_scope_allows_membership(
            ${member}::uuid, ${expenseScope}, expense.employee_membership_id, expense.created_by_membership_id
          )
          and expense.approval_status <> 'rejected'
          and expense.expense_date >= bounds.this_month - interval '2 months'
          and expense.expense_date < bounds.this_month - interval '1 month'), 0)::bigint as expenses_previous_month
  `;
  return (
    rows[0] ?? {
      revenue_last_month: 0,
      revenue_previous_month: 0,
      cash_last_month: 0,
      cash_previous_month: 0,
      expenses_last_month: 0,
      expenses_previous_month: 0,
    }
  );
}
