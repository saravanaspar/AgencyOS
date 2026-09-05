import type { FinanceFilters } from "@/modules/finance/schemas/finance";
import {
  reportQueryString,
  type ReportMetric,
  type ReportSection,
  type ReportsWorkspaceData,
} from "@/modules/reports/reports";

export function buildSummaryMetrics(data: {
  filters: ReportsWorkspaceData["filters"];
  crm: ReportsWorkspaceData["crm"];
  projects: ReportsWorkspaceData["projects"];
  finance: ReportsWorkspaceData["finance"];
  hr: ReportsWorkspaceData["hr"];
  support: ReportsWorkspaceData["support"];
  legal: ReportsWorkspaceData["legal"];
  comparisonRevenueMinor: number | null;
  currency: string;
}): ReportMetric[] {
  const metrics: ReportMetric[] = [];
  const reportHref = (section: ReportSection) =>
    `/reports?${reportQueryString(data.filters, { section })}`;
  const financeInvoiceHref = (
    options: {
      status?: string;
      scope?: NonNullable<FinanceFilters["scope"]>;
    } = {},
  ) => {
    const params = new URLSearchParams({
      tab: "invoices",
      from: data.filters.from,
      to: data.filters.to,
      currency: data.currency,
    });
    if (data.filters.client) params.set("company", data.filters.client);
    if (options.status) params.set("status", options.status);
    if (options.scope) params.set("scope", options.scope);
    return `/finance?${params.toString()}`;
  };
  if (data.finance) {
    metrics.push(
      {
        id: "revenue",
        label: "Revenue",
        value: data.finance.revenueMinor,
        unit: "minor",
        comparisonValue: data.comparisonRevenueMinor,
        href: financeInvoiceHref({ scope: "issued_revenue" }),
        definitionKey: "summary.revenue",
      },
      {
        id: "gross-profit",
        label: "Gross profit",
        value: data.finance.grossProfitMinor,
        unit: "minor",
        comparisonValue: null,
        href: reportHref("finance"),
        definitionKey: "summary.gross-profit",
      },
      {
        id: "overdue-invoices",
        label: "Overdue invoices",
        value: data.finance.overdueMinor,
        unit: "minor",
        comparisonValue: null,
        href: financeInvoiceHref({ scope: "overdue_receivables" }),
        definitionKey: "summary.overdue-invoices",
      },
    );
  }
  if (data.crm)
    metrics.push({
      id: "lead-conversion",
      label: "Lead conversion",
      value: data.crm.conversion.rateBps,
      unit: "bps",
      comparisonValue: null,
      href: reportHref("crm"),
      definitionKey: "summary.lead-conversion",
    });
  if (data.projects)
    metrics.push({
      id: "overdue-projects",
      label: "Projects needing attention",
      value: data.projects.overdueProjects,
      unit: "count",
      comparisonValue: null,
      href: reportHref("projects"),
      definitionKey: "summary.overdue-projects",
    });
  if (data.hr)
    metrics.push({
      id: "headcount",
      label: "Active headcount",
      value: data.hr.headcount,
      unit: "count",
      comparisonValue: null,
      href: reportHref("hr"),
      definitionKey: "summary.headcount",
    });
  if (data.support)
    metrics.push({
      id: "open-support",
      label: "Open support tickets",
      value: data.support.openTickets,
      unit: "count",
      comparisonValue: null,
      href: reportHref("support"),
      definitionKey: "summary.open-support",
    });
  if (data.legal)
    metrics.push({
      id: "active-contracts",
      label: "Active contracts",
      value: data.legal.activeContracts,
      unit: "count",
      comparisonValue: null,
      href: reportHref("legal"),
      definitionKey: "summary.active-contracts",
    });
  return metrics.slice(0, 8);
}
