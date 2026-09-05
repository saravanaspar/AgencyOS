import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { currencyMinorUnits } from "@/modules/finance/calculations";
import type {
  CashForecastCurrencyResult,
  CashForecastData,
  CashForecastHorizon,
  CashForecastRecurringItem,
  CashForecastScenario,
  CashForecastSettings,
  CashForecastSourceAmount,
} from "@/modules/finance/cash-forecast";
import { cashForecastHorizons, cashForecastScenarios } from "@/modules/finance/cash-forecast";
import { financePermissionKeys } from "@/modules/finance/finance";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

interface SettingsRow {
  payroll_day: number;
  pipeline_enabled: boolean;
  historical_collection_enabled: boolean;
  base_collection_delay_days: number;
  conservative_collection_delay_days: number;
  optimistic_collection_delay_days: number;
  base_pipeline_multiplier_bps: number;
  conservative_pipeline_multiplier_bps: number;
  optimistic_pipeline_multiplier_bps: number;
}
interface DatedAmountRow {
  currency: string;
  amount_minor: string | number;
  due_on: string;
}
interface PipelineRow {
  currency: string;
  estimated_value: string | number;
  probability: number;
  due_on: string;
}
interface PayrollRow {
  currency: string;
  net_minor: string | number;
}
interface RecurringRow {
  id: string;
  label: string;
  direction: "inflow" | "outflow";
  item_kind: CashForecastRecurringItem["itemKind"];
  amount_minor: string | number;
  currency: string;
  cadence: CashForecastRecurringItem["cadence"];
  next_due_on: string;
  end_on: string | null;
  probability_bps: number;
  project_id: string | null;
  active: boolean;
}

const DAY_MS = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}
function majorToMinor(value: string | number, currency: string): number {
  return Math.round(Number(value) * 10 ** currencyMinorUnits(currency));
}
function scenarioDelay(settings: CashForecastSettings, scenario: CashForecastScenario): number {
  if (scenario === "conservative") return settings.conservativeCollectionDelayDays;
  if (scenario === "optimistic") return settings.optimisticCollectionDelayDays;
  return settings.baseCollectionDelayDays;
}
function pipelineMultiplier(
  settings: CashForecastSettings,
  scenario: CashForecastScenario,
): number {
  if (scenario === "conservative") return settings.conservativePipelineMultiplierBps;
  if (scenario === "optimistic") return settings.optimisticPipelineMultiplierBps;
  return settings.basePipelineMultiplierBps;
}
function clampedUtcDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}
function recurringOccurrence(
  start: Date,
  cadence: CashForecastRecurringItem["cadence"],
  periods: number,
): Date {
  if (cadence === "weekly") return addDays(start, periods * 7);
  if (cadence === "annual") {
    return clampedUtcDate(
      start.getUTCFullYear() + periods,
      start.getUTCMonth(),
      start.getUTCDate(),
    );
  }
  const monthOffset = periods * (cadence === "quarterly" ? 3 : 1);
  const absoluteMonth = start.getUTCFullYear() * 12 + start.getUTCMonth() + monthOffset;
  return clampedUtcDate(Math.floor(absoluteMonth / 12), absoluteMonth % 12, start.getUTCDate());
}
function firstRecurringOccurrenceOnOrAfter(
  start: Date,
  cadence: CashForecastRecurringItem["cadence"],
  lowerBound: Date,
): { due: Date; period: number } {
  if (start >= lowerBound) return { due: start, period: 0 };
  let period: number;
  if (cadence === "weekly") {
    period = Math.ceil((lowerBound.getTime() - start.getTime()) / (7 * DAY_MS));
  } else if (cadence === "annual") {
    period = Math.max(0, lowerBound.getUTCFullYear() - start.getUTCFullYear());
  } else {
    const elapsedMonths =
      (lowerBound.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      lowerBound.getUTCMonth() -
      start.getUTCMonth();
    period = Math.max(0, Math.floor(elapsedMonths / (cadence === "quarterly" ? 3 : 1)));
  }
  let due = recurringOccurrence(start, cadence, period);
  if (due < lowerBound) {
    period += 1;
    due = recurringOccurrence(start, cadence, period);
  }
  return { due, period };
}
function noEarlierThan(date: Date, lowerBound: Date): Date {
  return date < lowerBound ? lowerBound : date;
}
function pushAmount(
  map: Map<
    string,
    Array<{
      due: Date;
      source: CashForecastSourceAmount["source"];
      inflow: number;
      outflow: number;
    }>
  >,
  currency: string,
  due: Date,
  source: CashForecastSourceAmount["source"],
  inflow: number,
  outflow: number,
) {
  const rows = map.get(currency) ?? [];
  rows.push({ due, source, inflow, outflow });
  map.set(currency, rows);
}

export async function getCashForecastForContext(
  context: CurrentPermissionContext,
): Promise<CashForecastData> {
  if (!context.permissions.has(financePermissionKeys.reportView)) {
    throw new Error("Cash forecast requires finance report access.");
  }
  const database = getDatabaseClient();
  const org = context.membership.organizationId;
  const member = context.membership.id;
  const today = new Date(`${iso(new Date())}T00:00:00Z`);
  const cutoff = iso(addDays(today, 120));

  const [
    settingsRows,
    medianRows,
    receivables,
    expenses,
    vendorBills,
    purchaseOrders,
    payroll,
    pipeline,
    recurringRows,
  ] = await Promise.all([
    database<SettingsRow[]>`
      select payroll_day, pipeline_enabled, historical_collection_enabled,
        base_collection_delay_days, conservative_collection_delay_days, optimistic_collection_delay_days,
        base_pipeline_multiplier_bps, conservative_pipeline_multiplier_bps, optimistic_pipeline_multiplier_bps
      from public.finance_cash_forecast_settings where organization_id = ${org}::uuid limit 1
    `,
    database<Array<{ median_days: string | number | null }>>`
      select percentile_cont(0.5) within group (order by greatest(0, payment.payment_date - invoice.due_date)) as median_days
      from public.finance_payment_allocations allocation
      join public.finance_payments payment on payment.id = allocation.payment_id
      join public.finance_invoices invoice on invoice.id = allocation.invoice_id
      where ${context.permissions.has(financePermissionKeys.paymentView)}::boolean
        and allocation.organization_id = ${org}::uuid
        and invoice.due_date is not null and payment.payment_date >= current_date - 365
    `,
    database<DatedAmountRow[]>`
      select currency, balance_minor as amount_minor, coalesce(due_date, current_date)::text as due_on
      from public.finance_invoices
      where organization_id = ${org}::uuid and balance_minor > 0 and status not in ('paid','void','credited')
        and issued_at is not null and coalesce(due_date, current_date) <= ${cutoff}::date
    `,
    database<DatedAmountRow[]>`
      select currency, total_minor as amount_minor,
        case when payment_status = 'scheduled' then coalesce(paid_at::date, expense_date) else expense_date end::text as due_on
      from public.finance_expenses
      where ${context.permissions.has(financePermissionKeys.expenseView)}::boolean
        and organization_id = ${org}::uuid and approval_status = 'approved'
        and private.crm_scope_allows_membership(
          ${member}::uuid, ${context.permissionScopes.get(financePermissionKeys.expenseView) ?? "own"},
          employee_membership_id, created_by_membership_id
        )
        and payment_status in ('unpaid','scheduled') and expense_date <= ${cutoff}::date
    `,
    database<DatedAmountRow[]>`
      select currency, total_minor as amount_minor, coalesce(due_date, invoice_date)::text as due_on
      from public.procurement_vendor_bills
      where ${context.permissions.has("vendors.bill.view")}::boolean
        and organization_id = ${org}::uuid and status in ('approved','matched','partially_paid')
        and coalesce(due_date, invoice_date) <= ${cutoff}::date
    `,
    database<DatedAmountRow[]>`
      select purchase_order.currency, purchase_order.total_minor as amount_minor,
        coalesce(purchase_order.expected_delivery_date, purchase_order.issue_date)::text as due_on
      from public.procurement_purchase_orders purchase_order
      where ${context.permissions.has("vendors.purchase_order.view")}::boolean
        and purchase_order.organization_id = ${org}::uuid
        and purchase_order.status in ('issued','acknowledged','partially_received')
        and coalesce(purchase_order.expected_delivery_date, purchase_order.issue_date) <= ${cutoff}::date
        and not exists (
          select 1 from public.procurement_vendor_bills bill
          where bill.purchase_order_id = purchase_order.id and bill.status <> 'void'
        )
    `,
    database<PayrollRow[]>`
      with current_structures as (
        select distinct on (structure.membership_id) structure.id, structure.currency, structure.base_salary_minor
        from public.hr_salary_structures structure
        join public.memberships membership on membership.id = structure.membership_id
        where ${context.permissions.has("hr.salary.view")}::boolean
          and structure.organization_id = ${org}::uuid and membership.status = 'active'
          and structure.effective_from <= current_date
          and (structure.effective_to is null or structure.effective_to >= current_date)
        order by structure.membership_id, structure.effective_from desc, structure.revision_number desc
      )
      select structure.currency,
        sum(structure.base_salary_minor + coalesce(component.allowances,0) - coalesce(component.deductions,0))::bigint as net_minor
      from current_structures structure
      left join lateral (
        select sum(amount_minor) filter (where component_type='allowance') as allowances,
          sum(amount_minor) filter (where component_type='deduction') as deductions
        from public.hr_salary_structure_components component where component.salary_structure_id = structure.id
      ) component on true
      group by structure.currency
    `,
    database<PipelineRow[]>`
      select lead.currency, lead.estimated_value, lead.probability, lead.expected_close_date::text as due_on
      from public.crm_leads lead
      join public.crm_pipeline_stages stage on stage.id = lead.stage_id
      where ${context.permissions.has("crm.lead.view")}::boolean
        and lead.organization_id = ${org}::uuid and lead.status in ('new','qualified') and stage.state = 'open'
        and lead.estimated_value is not null and lead.expected_close_date between current_date and ${cutoff}::date
        and private.crm_scope_allows_membership(
          ${member}::uuid, ${context.permissionScopes.get("crm.lead.view") ?? "own"},
          lead.owner_membership_id, lead.created_by_membership_id
        )
    `,
    database<RecurringRow[]>`
      select id, label, direction, item_kind, amount_minor, currency, cadence,
        next_due_on::text, end_on::text, probability_bps, project_id, active
      from public.finance_cash_recurring_items
      where organization_id = ${org}::uuid order by active desc, next_due_on, lower(label)
    `,
  ]);

  const raw = settingsRows[0];
  const historicalMedianCollectionDays =
    medianRows[0]?.median_days == null ? null : Math.round(Number(medianRows[0].median_days));
  const settings: CashForecastSettings = {
    payrollDay: raw?.payroll_day ?? 25,
    pipelineEnabled: raw?.pipeline_enabled ?? false,
    historicalCollectionEnabled: raw?.historical_collection_enabled ?? true,
    baseCollectionDelayDays: raw?.base_collection_delay_days ?? 0,
    conservativeCollectionDelayDays: raw?.conservative_collection_delay_days ?? 14,
    optimisticCollectionDelayDays: raw?.optimistic_collection_delay_days ?? 0,
    basePipelineMultiplierBps: raw?.base_pipeline_multiplier_bps ?? 10_000,
    conservativePipelineMultiplierBps: raw?.conservative_pipeline_multiplier_bps ?? 5_000,
    optimisticPipelineMultiplierBps: raw?.optimistic_pipeline_multiplier_bps ?? 12_500,
    historicalMedianCollectionDays,
  };
  const recurringItems: CashForecastRecurringItem[] = recurringRows.map((row) => ({
    id: row.id,
    label: row.label,
    direction: row.direction,
    itemKind: row.item_kind,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    cadence: row.cadence,
    nextDueOn: row.next_due_on,
    endOn: row.end_on,
    probabilityBps: row.probability_bps,
    projectId: row.project_id,
    active: row.active,
  }));

  const currencies = new Set<string>();
  for (const collection of [receivables, expenses, vendorBills, purchaseOrders])
    for (const row of collection) currencies.add(row.currency);
  for (const row of payroll) currencies.add(row.currency);
  for (const row of pipeline) currencies.add(row.currency);
  for (const row of recurringItems) currencies.add(row.currency);

  const results: CashForecastCurrencyResult[] = [];
  for (const currency of [...currencies].sort()) {
    const scenarios = cashForecastScenarios.map((scenario) => {
      const entries = new Map<
        string,
        Array<{
          due: Date;
          source: CashForecastSourceAmount["source"];
          inflow: number;
          outflow: number;
        }>
      >();
      const collectionLag =
        (settings.historicalCollectionEnabled ? (historicalMedianCollectionDays ?? 0) : 0) +
        scenarioDelay(settings, scenario);
      for (const item of receivables.filter((row) => row.currency === currency)) {
        pushAmount(
          entries,
          currency,
          noEarlierThan(addDays(parseDate(item.due_on), collectionLag), today),
          "receivables",
          Number(item.amount_minor),
          0,
        );
      }
      for (const item of expenses.filter((row) => row.currency === currency))
        pushAmount(
          entries,
          currency,
          noEarlierThan(parseDate(item.due_on), today),
          "approved_expenses",
          0,
          Number(item.amount_minor),
        );
      for (const item of vendorBills.filter((row) => row.currency === currency))
        pushAmount(
          entries,
          currency,
          noEarlierThan(parseDate(item.due_on), today),
          "vendor_bills",
          0,
          Number(item.amount_minor),
        );
      for (const item of purchaseOrders.filter((row) => row.currency === currency))
        pushAmount(
          entries,
          currency,
          noEarlierThan(parseDate(item.due_on), today),
          "purchase_commitments",
          0,
          Number(item.amount_minor),
        );
      if (settings.pipelineEnabled) {
        for (const item of pipeline.filter((row) => row.currency === currency)) {
          const weighted = (majorToMinor(item.estimated_value, currency) * item.probability) / 100;
          const adjusted = Math.round((weighted * pipelineMultiplier(settings, scenario)) / 10_000);
          pushAmount(entries, currency, parseDate(item.due_on), "pipeline", adjusted, 0);
        }
      }
      for (const item of payroll.filter((row) => row.currency === currency)) {
        for (let monthOffset = 0; monthOffset <= 3; monthOffset += 1) {
          const absoluteMonth = today.getUTCFullYear() * 12 + today.getUTCMonth() + monthOffset;
          const due = clampedUtcDate(
            Math.floor(absoluteMonth / 12),
            absoluteMonth % 12,
            settings.payrollDay,
          );
          if (due >= today && due <= addDays(today, 90))
            pushAmount(entries, currency, due, "payroll", 0, Number(item.net_minor));
        }
      }
      for (const item of recurringItems.filter((row) => row.active && row.currency === currency)) {
        const start = parseDate(item.nextDueOn);
        let { due, period } = firstRecurringOccurrenceOnOrAfter(start, item.cadence, today);
        const end = item.endOn ? parseDate(item.endOn) : addDays(today, 90);
        let safety = 0;
        while (due <= addDays(today, 90) && due <= end && safety < 60) {
          const amount = Math.round((item.amountMinor * item.probabilityBps) / 10_000);
          pushAmount(
            entries,
            currency,
            due,
            item.direction === "inflow" ? "recurring_income" : "recurring_obligations",
            item.direction === "inflow" ? amount : 0,
            item.direction === "outflow" ? amount : 0,
          );
          period += 1;
          due = recurringOccurrence(start, item.cadence, period);
          safety += 1;
        }
      }
      const rows = entries.get(currency) ?? [];
      const horizons = cashForecastHorizons.map((days: CashForecastHorizon) => {
        const cutoffDate = addDays(today, days);
        const bySource = new Map<CashForecastSourceAmount["source"], CashForecastSourceAmount>();
        for (const entry of rows) {
          if (entry.due < today || entry.due > cutoffDate) continue;
          const current = bySource.get(entry.source) ?? {
            source: entry.source,
            inflowMinor: 0,
            outflowMinor: 0,
          };
          current.inflowMinor += entry.inflow;
          current.outflowMinor += entry.outflow;
          bySource.set(entry.source, current);
        }
        const sources = [...bySource.values()];
        const inflowMinor = sources.reduce((sum, row) => sum + row.inflowMinor, 0);
        const outflowMinor = sources.reduce((sum, row) => sum + row.outflowMinor, 0);
        return { days, inflowMinor, outflowMinor, netMinor: inflowMinor - outflowMinor, sources };
      });
      return { scenario, horizons };
    });
    results.push({ currency, scenarios });
  }

  return {
    asOf: iso(today),
    settings,
    currencies: results,
    recurringItems,
    assumptions: [
      "Forecast is forward cash movement, not a bank-balance projection; bank cash stays separate until a trusted bank feed exists.",
      "Receivable timing uses invoice due dates plus the configured scenario delay and, when enabled, historical median collection lag.",
      context.permissions.has("hr.salary.view")
        ? "Payroll derives from current effective salary structures; recurring obligations and retainers use explicit forecast schedules."
        : "Payroll salary structures are omitted without HR salary permission; add an explicit recurring payroll obligation when finance planning still requires it.",
      settings.pipelineEnabled
        ? "CRM pipeline is probability-weighted and scenario-adjusted; it is not contracted cash."
        : "CRM pipeline is excluded unless explicitly enabled in forecast settings.",
    ],
  };
}
