import "server-only";

import type { Sql, TransactionSql } from "postgres";

import { toJsonValue } from "@/lib/server/json-value";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

type QuerySql = Sql | TransactionSql;

export async function insertEstimateVersion(
  sql: QuerySql,
  context: CurrentPermissionContext,
  estimateId: string,
  reason: string,
): Promise<void> {
  const rows = await sql<
    Array<{
      version_number: number;
      snapshot: Record<string, unknown>;
    }>
  >`
    select estimate.version_number,
      jsonb_build_object(
        'estimateId', estimate.id,
        'estimateNumber', estimate.estimate_number,
        'companyId', estimate.company_id,
        'contactId', estimate.contact_id,
        'projectId', estimate.project_id,
        'issueDate', estimate.issue_date,
        'expiryDate', estimate.expiry_date,
        'currency', estimate.currency,
        'status', estimate.status,
        'approvalStatus', estimate.approval_status,
        'clientAcceptanceStatus', estimate.client_acceptance_status,
        'notes', estimate.notes,
        'terms', estimate.terms,
        'subtotalMinor', estimate.subtotal_minor,
        'discountMinor', estimate.discount_minor,
        'taxMinor', estimate.tax_minor,
        'totalMinor', estimate.total_minor,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', line.position,
            'catalogItemId', line.catalog_item_id,
            'description', line.description,
            'quantityMilli', line.quantity_milli,
            'unitRateMinor', line.unit_rate_minor,
            'discountBps', line.discount_bps,
            'taxBps', line.tax_bps,
            'subtotalMinor', line.subtotal_minor,
            'discountMinor', line.discount_minor,
            'taxMinor', line.tax_minor,
            'totalMinor', line.total_minor
          ) order by line.position)
          from public.finance_estimate_lines as line
          where line.estimate_id = estimate.id
        ), '[]'::jsonb)
      ) as snapshot
    from public.finance_estimates as estimate
    where estimate.id = ${estimateId}::uuid
      and estimate.organization_id = ${context.membership.organizationId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Estimate was not found.");

  await sql`
    insert into public.finance_estimate_versions (
      organization_id, estimate_id, version_number, snapshot, reason, created_by_membership_id
    ) values (
      ${context.membership.organizationId}::uuid,
      ${estimateId}::uuid,
      ${row.version_number},
      ${sql.json(toJsonValue(row.snapshot))},
      ${reason},
      ${context.membership.id}::uuid
    )
    on conflict (estimate_id, version_number) do nothing
  `;
}
