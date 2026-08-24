import type { ReportSection } from "@/modules/reports/reports";

export const reportWidgetCatalog = {
  overview: [
    { key: "overview.summary", label: "Summary metrics" },
    { key: "overview.pipeline", label: "Pipeline value" },
    { key: "overview.revenue", label: "Revenue trend" },
    { key: "overview.workload", label: "Project workload" },
    { key: "overview.support", label: "Support by category" },
  ],
  crm: [
    { key: "crm.sources", label: "Leads by source" },
    { key: "crm.pipeline", label: "Pipeline value by stage" },
    { key: "crm.status", label: "Lead status" },
    { key: "crm.owners", label: "Sales by owner" },
    { key: "crm.stage_time", label: "Average time in stage" },
    { key: "crm.lost_reasons", label: "Lost reasons" },
  ],
  projects: [
    { key: "projects.performance", label: "Project performance" },
    { key: "projects.workload", label: "Team workload" },
  ],
  finance: [
    { key: "finance.revenue", label: "Revenue by month" },
    { key: "finance.balances", label: "Outstanding client balances" },
    { key: "finance.concentration", label: "Client concentration risk" },
    { key: "finance.expenses", label: "Expenses by category" },
    { key: "finance.summary", label: "Finance summary" },
  ],
  hr: [
    { key: "hr.departments", label: "Headcount by department" },
    { key: "hr.attendance", label: "Attendance" },
    { key: "hr.leave", label: "Approved leave" },
    { key: "hr.probation", label: "Probation reviews" },
    { key: "hr.documents", label: "Expiring employee documents" },
    { key: "hr.assets", label: "Asset assignments" },
  ],
  support: [
    { key: "support.categories", label: "Tickets by category" },
    { key: "support.clients", label: "Tickets by client" },
    { key: "support.workload", label: "Agent workload" },
    { key: "support.summary", label: "Service summary" },
  ],
  founder_daily: [
    { key: "founder_daily.money", label: "Money" },
    { key: "founder_daily.sales", label: "Sales" },
    { key: "founder_daily.concentration", label: "Client concentration risk" },
    { key: "founder_daily.delivery", label: "Delivery" },
    { key: "founder_daily.people", label: "People" },
    { key: "founder_daily.actions", label: "Founder actions" },
  ],
  founder_weekly: [
    { key: "founder_weekly.previous", label: "Previous week" },
    { key: "founder_weekly.next", label: "Next week" },
  ],
  legal: [
    { key: "legal.expiring", label: "Expiring contracts" },
    { key: "legal.signatures", label: "Pending signatures" },
    { key: "legal.renewals", label: "Renewal obligations" },
    { key: "legal.restricted_access", label: "Restricted file access" },
    { key: "legal.licences", label: "Licence expirations" },
  ],
} as const satisfies Record<ReportSection, readonly { key: string; label: string }[]>;

export type ReportWidgetKey = (typeof reportWidgetCatalog)[ReportSection][number]["key"];

const widgetKeys = new Set<string>(
  Object.values(reportWidgetCatalog).flatMap((widgets) => widgets.map((widget) => widget.key)),
);

export function defaultReportWidgets(section: ReportSection): ReportWidgetKey[] {
  return reportWidgetCatalog[section].map((widget) => widget.key) as ReportWidgetKey[];
}

export function normalizeReportWidgets(
  section: ReportSection,
  values: readonly string[] | null | undefined,
): ReportWidgetKey[] {
  const allowed = new Set<string>(reportWidgetCatalog[section].map((widget) => widget.key));
  const normalized = Array.from(
    new Set(
      (values ?? []).filter(
        (value): value is ReportWidgetKey => widgetKeys.has(value) && allowed.has(value),
      ),
    ),
  ).slice(0, 12);
  return normalized.length > 0 ? normalized : defaultReportWidgets(section);
}

export function reportWidgetLabel(key: ReportWidgetKey): string {
  for (const widgets of Object.values(reportWidgetCatalog)) {
    const match = widgets.find((widget) => widget.key === key);
    if (match) return match.label;
  }
  return key;
}
