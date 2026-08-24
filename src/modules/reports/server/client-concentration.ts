import "server-only";

import type { Sql } from "postgres";

import { crmPermissionKeys } from "@/modules/crm/crm";
import { financePermissionKeys } from "@/modules/finance/finance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type {
  ClientConcentrationKind,
  ClientConcentrationMetric,
} from "@/modules/reports/reports";

interface ConcentrationSourceRow {
  kind: ClientConcentrationKind;
  currency: string;
  entity_id: string;
  label: string;
  amount: string | number;
}

function basisPoints(part: number, total: number): number {
  if (part <= 0 || total <= 0) return 0;
  return Math.max(0, Math.min(10_000, Math.round((part / total) * 10_000)));
}

function financeEntityHref(
  kind: "revenue" | "receivables",
  companyId: string,
  currency: string,
  period: { from: string; to: string },
): string {
  const params = new URLSearchParams({
    tab: "invoices",
    company: companyId,
    currency,
    scope: kind === "revenue" ? "issued_revenue" : "open_receivables",
  });
  if (kind === "revenue") {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return `/finance?${params.toString()}`;
}

function financeSourceHref(
  kind: "revenue" | "receivables",
  currency: string,
  period: { from: string; to: string },
): string {
  const params = new URLSearchParams({
    tab: "invoices",
    currency,
    scope: kind === "revenue" ? "issued_revenue" : "open_receivables",
  });
  if (kind === "revenue") {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return `/finance?${params.toString()}`;
}

function pipelineEntityHref(label: string, currency: string): string {
  const params = new URLSearchParams({
    q: label,
    tab: "pipeline",
    currency,
    scope: "open_opportunities",
  });
  return `/crm?${params.toString()}`;
}

function pipelineSourceHref(currency: string): string {
  return `/crm?${new URLSearchParams({
    tab: "pipeline",
    currency,
    scope: "open_opportunities",
  }).toString()}`;
}

export function summarizeClientConcentration(
  rows: readonly ConcentrationSourceRow[],
  period: { from: string; to: string },
): ClientConcentrationMetric[] {
  const groups = new Map<string, ConcentrationSourceRow[]>();
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = `${row.kind}:${row.currency}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([id, group]) => {
      const ordered = [...group].sort((left, right) => Number(right.amount) - Number(left.amount));
      const total = ordered.reduce((sum, row) => sum + Number(row.amount), 0);
      const top = ordered.slice(0, 3);
      const kind = top[0]?.kind;
      const currency = top[0]?.currency;
      if (!kind || !currency || total <= 0) return null;
      const entries = top.map((row) => ({
        id: row.entity_id,
        label: row.label,
        shareBps: basisPoints(Number(row.amount), total),
        href:
          kind === "pipeline"
            ? pipelineEntityHref(row.label, currency)
            : financeEntityHref(kind, row.entity_id, currency, period),
      }));
      const largestShareBps = entries[0]?.shareBps ?? 0;
      const topThreeAmount = top.reduce((sum, row) => sum + Number(row.amount), 0);
      return {
        id,
        kind,
        currency,
        largestShareBps,
        topThreeShareBps: basisPoints(topThreeAmount, total),
        entries,
        sourceHref:
          kind === "pipeline"
            ? pipelineSourceHref(currency)
            : financeSourceHref(kind, currency, period),
        definitionKey: `client_concentration.${kind}`,
      } satisfies ClientConcentrationMetric;
    })
    .filter((metric): metric is ClientConcentrationMetric => metric !== null)
    .sort((left, right) => {
      const kindOrder: Record<ClientConcentrationKind, number> = {
        revenue: 0,
        receivables: 1,
        pipeline: 2,
      };
      return kindOrder[left.kind] - kindOrder[right.kind] || left.currency.localeCompare(right.currency);
    });
}

export async function getClientConcentrationForContext(
  database: Sql,
  context: CurrentPermissionContext,
  period: { from: string; to: string },
): Promise<ClientConcentrationMetric[]> {
  const organizationId = context.membership.organizationId;
  const sourceRows: ConcentrationSourceRow[] = [];

  if (context.permissions.has(financePermissionKeys.reportView)) {
    const financeRows = await database<ConcentrationSourceRow[]>`
      select 'revenue'::text as kind, invoice.currency,
        company.id::text as entity_id,
        coalesce(company.display_name, company.legal_name) as label,
        sum(invoice.subtotal_minor - invoice.discount_minor)::numeric as amount
      from public.finance_invoices as invoice
      join public.crm_companies as company on company.id = invoice.company_id
      where invoice.organization_id = ${organizationId}::uuid
        and invoice.issued_at is not null
        and invoice.status <> 'void'
        and invoice.issue_date between ${period.from}::date and ${period.to}::date
      group by invoice.currency, company.id, company.display_name, company.legal_name
      having sum(invoice.subtotal_minor - invoice.discount_minor) > 0

      union all

      select 'receivables'::text as kind, invoice.currency,
        company.id::text as entity_id,
        coalesce(company.display_name, company.legal_name) as label,
        sum(invoice.balance_minor)::numeric as amount
      from public.finance_invoices as invoice
      join public.crm_companies as company on company.id = invoice.company_id
      where invoice.organization_id = ${organizationId}::uuid
        and invoice.issued_at is not null
        and invoice.balance_minor > 0
        and invoice.status not in ('paid', 'void', 'credited')
      group by invoice.currency, company.id, company.display_name, company.legal_name
      having sum(invoice.balance_minor) > 0
    `;
    sourceRows.push(...financeRows);
  }

  if (context.permissions.has(crmPermissionKeys.leadView)) {
    const membershipId = context.membership.id;
    const leadScope = context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
    const pipelineRows = await database<ConcentrationSourceRow[]>`
      select 'pipeline'::text as kind, lead.currency,
        md5(lower(coalesce(nullif(btrim(lead.company_name), ''), btrim(lead.name)))) as entity_id,
        min(coalesce(nullif(btrim(lead.company_name), ''), btrim(lead.name))) as label,
        sum(coalesce(lead.estimated_value, 0) * lead.probability / 100.0)::numeric as amount
      from public.crm_leads as lead
      join public.crm_pipeline_stages as stage on stage.id = lead.stage_id
      where lead.organization_id = ${organizationId}::uuid
        and lead.status in ('new', 'qualified')
        and stage.state = 'open'
        and private.crm_scope_allows_membership(
          ${membershipId}::uuid,
          ${leadScope},
          lead.owner_membership_id,
          lead.created_by_membership_id
        )
      group by lead.currency, lower(coalesce(nullif(btrim(lead.company_name), ''), btrim(lead.name)))
      having sum(coalesce(lead.estimated_value, 0) * lead.probability / 100.0) > 0
    `;
    sourceRows.push(...pipelineRows);
  }

  return summarizeClientConcentration(sourceRows, period);
}
