import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";

const MAX_OVERDUE_ROWS = 200;

interface OverdueInvoiceRow {
  id: string;
  organization_id: string;
  previous_status: string;
  invoice_number: string;
  due_date: string;
  balance_minor: string | number;
}

export interface FinanceOverdueWorkerSummary {
  markedOverdue: number;
}

export async function runFinanceOverdueWorker(): Promise<FinanceOverdueWorkerSummary> {
  const database = getDatabaseClient();
  return database.begin(async (sql) => {
    const rows = await sql<OverdueInvoiceRow[]>`
      with due as (
        select invoice.id, invoice.status as previous_status
        from public.finance_invoices as invoice
        join public.organizations as organization
          on organization.id = invoice.organization_id
         and organization.status = 'active'
        where invoice.issued_at is not null
          and invoice.due_date < current_date
          and invoice.balance_minor > 0
          and invoice.status in ('issued', 'sent', 'viewed', 'partially_paid')
        order by invoice.due_date, invoice.id
        limit ${MAX_OVERDUE_ROWS}
        for update of invoice skip locked
      )
      update public.finance_invoices as invoice
      set status = 'overdue', updated_at = now()
      from due
      where invoice.id = due.id
      returning invoice.id, invoice.organization_id, due.previous_status,
        invoice.invoice_number, invoice.due_date::text, invoice.balance_minor
    `;

    for (const invoice of rows) {
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${invoice.organization_id}::uuid, ${invoice.id}::uuid, 'overdue',
          ${sql.json({
            previousStatus: invoice.previous_status,
            dueDate: invoice.due_date,
            balanceMinor: Number(invoice.balance_minor),
          })},
          null
        )
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_type, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${invoice.organization_id}::uuid,
          'system',
          'finance.invoice.overdue',
          'finance_invoice',
          ${invoice.id},
          'finance_overdue_worker',
          ${sql.json({ status: invoice.previous_status })},
          ${sql.json({ status: "overdue" })},
          ${["status"]},
          ${sql.json({
            invoiceNumber: invoice.invoice_number,
            dueDate: invoice.due_date,
            balanceMinor: Number(invoice.balance_minor),
          })}
        )
      `;
    }

    return { markedOverdue: rows.length };
  });
}
