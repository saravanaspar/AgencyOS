import "server-only";

import type { Sql, TransactionSql } from "postgres";

import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  privateFileContentDisposition,
  type PrivateFilePolicy,
} from "@/modules/private-files/server/file-policy";

export const FINANCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const FINANCE_ATTACHMENT_POLICY: PrivateFilePolicy = {
  maxBytes: FINANCE_ATTACHMENT_MAX_BYTES,
  allowedMimeTypes: new Map([
    ["image/png", new Set([".png"])],
    ["image/jpeg", new Set([".jpg", ".jpeg"])],
    ["application/pdf", new Set([".pdf"])],
    ["text/plain", new Set([".txt"])],
    ["text/csv", new Set([".csv"])],
  ]),
  description: "Only PNG, JPEG, PDF, TXT, and CSV attachments are accepted.",
};

type QuerySql = Sql | TransactionSql;

export interface AuthorizedFinanceInvoice {
  id: string;
  organizationId: string;
  displayNumber: string;
  status: string;
  issuedAt: Date | null;
}

export interface AuthorizedFinanceExpense {
  id: string;
  organizationId: string;
  expenseType: string;
  approvalStatus: string;
  paymentStatus: string;
}

export function financeAttachmentValidationMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.startsWith("private-file-invalid:")) return null;
  return error.message.slice("private-file-invalid:".length);
}

export const financeAttachmentContentDisposition = privateFileContentDisposition;

export async function getAuthorizedFinanceInvoice(
  sql: QuerySql,
  context: CurrentPermissionContext,
  invoiceId: string,
  options: { writableOnly?: boolean } = {},
): Promise<AuthorizedFinanceInvoice | null> {
  const rows = await sql<
    Array<{
      id: string;
      organization_id: string;
      display_number: string;
      status: string;
      issued_at: Date | null;
    }>
  >`
    select id, organization_id, coalesce(invoice_number, draft_reference) as display_number,
      status, issued_at
    from public.finance_invoices
    where id = ${invoiceId}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
      and (${options.writableOnly ?? false} = false or status <> 'void')
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        displayNumber: row.display_number,
        status: row.status,
        issuedAt: row.issued_at,
      }
    : null;
}

export async function getAuthorizedFinanceExpense(
  sql: QuerySql,
  context: CurrentPermissionContext,
  expenseId: string,
  permissionKey: string,
  options: { mutableOnly?: boolean } = {},
): Promise<AuthorizedFinanceExpense | null> {
  const scope = context.permissionScopes.get(permissionKey) ?? "own";
  const rows = await sql<
    Array<{
      id: string;
      organization_id: string;
      expense_type: string;
      approval_status: string;
      payment_status: string;
    }>
  >`
    select id, organization_id, expense_type, approval_status, payment_status
    from public.finance_expenses
    where id = ${expenseId}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid,
        ${scope},
        employee_membership_id,
        created_by_membership_id
      )
      and (
        ${options.mutableOnly ?? false} = false
        or (
          payment_status in ('unpaid', 'scheduled')
          and approval_status <> 'approved'
        )
      )
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        expenseType: row.expense_type,
        approvalStatus: row.approval_status,
        paymentStatus: row.payment_status,
      }
    : null;
}
