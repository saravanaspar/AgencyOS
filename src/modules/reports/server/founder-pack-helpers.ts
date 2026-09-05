import type { CrmFilters } from "@/modules/crm/schemas/crm";
import type { FinanceFilters } from "@/modules/finance/schemas/finance";
import { founderMetricDefinitionKey } from "@/modules/reports/metric-definitions";
import type {
  ClientConcentrationMetric,
  FounderReportBlock,
  FounderReportRow,
  ReportSection,
} from "@/modules/reports/reports";

export function number(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export function majorMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(value);
}

export function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Not enough data" : `${value.toFixed(1)}%`;
}

export function row(
  id: string,
  label: string,
  value: string,
  detail: string | null = null,
  href: string | null = null,
  tone: FounderReportRow["tone"] = "neutral",
): FounderReportRow {
  return { id, label, value, detail, href, tone };
}

export function block(id: string, title: string, rows: FounderReportRow[]): FounderReportBlock {
  return {
    id,
    title,
    rows: rows.map((item) => ({
      ...item,
      definitionKey: item.definitionKey ?? founderMetricDefinitionKey(id, item.id),
    })),
  };
}

export function concentrationRows(
  metrics: readonly ClientConcentrationMetric[],
): FounderReportRow[] {
  const labels = {
    revenue: "Revenue concentration",
    receivables: "Receivables concentration",
    pipeline: "Weighted pipeline concentration",
  } as const;
  return metrics.map((metric) => ({
    id: metric.id,
    label: `${labels[metric.kind]} · ${metric.currency}`,
    value: `Largest ${(metric.largestShareBps / 100).toFixed(1)}% · Top 3 ${(metric.topThreeShareBps / 100).toFixed(1)}%`,
    detail: metric.entries
      .map((entry) => `${entry.label} ${(entry.shareBps / 100).toFixed(1)}%`)
      .join(" · "),
    href: metric.sourceHref,
    definitionKey: metric.definitionKey,
    tone: "neutral",
  }));
}

export function reportHref(section: ReportSection, period: { from: string; to: string }): string {
  const params = new URLSearchParams({ section, from: period.from, to: period.to });
  return `/reports?${params.toString()}`;
}

export function financeHref(
  tab: "invoices" | "payments" | "expenses" | "reports",
  period?: { from: string; to: string },
  options: {
    status?: string;
    scope?: NonNullable<FinanceFilters["scope"]>;
    currency?: string;
  } = {},
): string {
  const params = new URLSearchParams({ tab });
  if (period) {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  if (options.status) params.set("status", options.status);
  if (options.scope) params.set("scope", options.scope);
  if (options.currency) params.set("currency", options.currency);
  return `/finance?${params.toString()}`;
}

export function crmHref(
  options: {
    tab?: "pipeline" | "forecast";
    currency?: string;
    scope?: NonNullable<CrmFilters["scope"]>;
  } = {},
): string {
  const params = new URLSearchParams({ tab: options.tab ?? "pipeline" });
  if (options.currency) params.set("currency", options.currency);
  if (options.scope) params.set("scope", options.scope);
  return `/crm?${params.toString()}`;
}

export function shiftPeriod(
  period: { from: string; to: string },
  days: number,
): { from: string; to: string } {
  const shift = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return { from: shift(period.from), to: shift(period.to) };
}

export function previousCalendarMonth(period: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const start = new Date(`${period.from}T00:00:00.000Z`);
  const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const previousEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  return {
    from: previousStart.toISOString().slice(0, 10),
    to: previousEnd.toISOString().slice(0, 10),
  };
}
