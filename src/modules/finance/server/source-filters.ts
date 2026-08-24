import type { Sql } from "postgres";

import type { FinanceFilters } from "@/modules/finance/schemas/finance";

export function invoiceSourceFilter(database: Sql, filters: FinanceFilters) {
  return database`
    and (${filters.currency}::text is null or invoice.currency = ${filters.currency})
    and (
      ${filters.scope}::text is null
      or (${filters.scope} = 'issued_revenue' and invoice.issued_at is not null and invoice.status <> 'void')
      or (${filters.scope} = 'open_receivables' and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited'))
      or (${filters.scope} = 'overdue_receivables' and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited') and invoice.due_date < current_date)
      or (${filters.scope} = 'actionable_issue' and invoice.status in ('draft','approved'))
      or (${filters.scope} = 'collections_due' and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited') and invoice.due_date <= current_date)
      or (${filters.scope} = 'expected_issue' and invoice.status in ('draft','pending_approval','approved'))
      or (${filters.scope} = 'expected_collection' and invoice.issued_at is not null and invoice.balance_minor > 0 and invoice.status not in ('paid','void','credited'))
    )
    and (
      ${filters.from}::date is null
      or (${filters.scope} = 'expected_collection' and invoice.due_date >= ${filters.from}::date)
      or (${filters.scope} <> 'expected_collection' and invoice.issue_date >= ${filters.from}::date)
      or (${filters.scope}::text is null and invoice.issue_date >= ${filters.from}::date)
    )
    and (
      ${filters.to}::date is null
      or (${filters.scope} = 'expected_collection' and invoice.due_date <= ${filters.to}::date)
      or (${filters.scope} <> 'expected_collection' and invoice.issue_date <= ${filters.to}::date)
      or (${filters.scope}::text is null and invoice.issue_date <= ${filters.to}::date)
    )
  `;
}

export function paymentSourceFilter(database: Sql, filters: FinanceFilters) {
  return database`
    and (${filters.currency}::text is null or payment.currency = ${filters.currency})
    and (${filters.from}::date is null or payment.payment_date >= ${filters.from}::date)
    and (${filters.to}::date is null or payment.payment_date <= ${filters.to}::date)
  `;
}
