export const reportsPermissionKeys = {
  workspace: "reports.workspace.view",
  export: "reports.export.create",
  savedViewManage: "reports.saved_view.manage",
  scheduleManage: "reports.schedule.manage",
  snapshotCreate: "reports.snapshot.create",
  snapshotDownload: "reports.snapshot.download",
} as const;

export const reportSections = [
  "overview",
  "crm",
  "projects",
  "finance",
  "hr",
  "support",
  "legal",
  "founder_daily",
  "founder_weekly",
] as const;
export const reportComparisons = ["none", "previous_period", "previous_year"] as const;
export const reportPeriodModes = [
  "custom",
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "quarter_to_date",
  "last_quarter",
  "year_to_date",
  "trailing_7_days",
  "trailing_30_days",
  "trailing_90_days",
] as const;
export const reportViewVisibilities = [
  "private",
  "founder",
  "management",
  "department",
  "organization",
  "named",
] as const;

export type ReportSection = (typeof reportSections)[number];
export type ReportComparison = (typeof reportComparisons)[number];
export type ReportPeriodMode = (typeof reportPeriodModes)[number];
export type ReportViewVisibility = (typeof reportViewVisibilities)[number];
export type ReportSnapshotFormat = "csv" | "pdf";
export type ReportScheduleCadence = "daily" | "weekly" | "monthly";

export const reportSectionLabels: Record<ReportSection, string> = {
  overview: "Overview",
  crm: "CRM",
  projects: "Projects",
  finance: "Finance",
  hr: "People",
  support: "Support",
  legal: "Legal",
  founder_daily: "Founder Daily Brief",
  founder_weekly: "Founder Weekly Review",
};

export const reportComparisonLabels: Record<ReportComparison, string> = {
  none: "No comparison",
  previous_period: "Previous period",
  previous_year: "Previous year",
};

export interface ReportOption {
  id: string;
  label: string;
}

export interface ReportCountRow {
  id: string;
  label: string;
  count: number;
  secondary?: string | null;
  amountMinor?: number | null;
  rateBps?: number | null;
  averageDays?: number | null;
}

export interface ReportProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  estimatedMinutes: number;
  actualMinutes: number;
  revenueMinor: number;
  expenseMinor: number;
  grossProfitMinor: number;
}

export interface ReportWorkloadRow {
  membershipId: string;
  name: string;
  department: string | null;
  openTasks: number;
  overdueTasks: number;
  estimatedMinutes: number;
  actualMinutes: number;
  utilizationBps: number;
}

export interface FounderReportRow {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
  href?: string | null;
  tone?: "neutral" | "warning" | "danger" | "success";
}

export interface FounderReportBlock {
  id: string;
  title: string;
  rows: FounderReportRow[];
}

export interface FounderReportPack {
  kind: "daily" | "weekly";
  blocks: FounderReportBlock[];
}

export interface ReportMetric {
  id: string;
  label: string;
  value: number;
  unit: "count" | "minor" | "bps" | "days" | "minutes";
  comparisonValue: number | null;
  href: string;
}

export interface ReportsWorkspaceData {
  filters: {
    from: string;
    to: string;
    comparison: ReportComparison;
    section: ReportSection;
    owner: string | null;
    team: string | null;
    department: string | null;
    project: string | null;
    client: string | null;
    status: string | null;
  };
  comparisonPeriod: { from: string; to: string } | null;
  locale: string;
  currency: string;
  generatedAt: string;
  activeWidgetKeys: string[];
  savedViewId: string | null;
  options: {
    owners: ReportOption[];
    teams: ReportOption[];
    departments: ReportOption[];
    projects: ReportOption[];
    clients: ReportOption[];
    statuses: ReportOption[];
  };
  capabilities: {
    canExport: boolean;
    canManageSavedViews: boolean;
    canSchedule: boolean;
    canCreateSnapshot: boolean;
    sections: ReportSection[];
  };
  summary: ReportMetric[];
  crm: {
    leadsBySource: ReportCountRow[];
    leadsByStatus: ReportCountRow[];
    pipelineByStage: ReportCountRow[];
    salesByOwner: ReportCountRow[];
    timeInStage: ReportCountRow[];
    lostReasons: ReportCountRow[];
    conversion: { eligible: number; converted: number; rateBps: number };
  } | null;
  projects: {
    projects: ReportProjectRow[];
    workload: ReportWorkloadRow[];
    overdueProjects: number;
    taskCompletionRateBps: number;
    utilizationBps: number;
  } | null;
  finance: {
    revenueByMonth: ReportCountRow[];
    clientBalances: ReportCountRow[];
    expenseBreakdown: ReportCountRow[];
    outstandingMinor: number;
    overdueMinor: number;
    revenueMinor: number;
    expensesMinor: number;
    grossProfitMinor: number;
    taxMinor: number;
    collectionRateBps: number;
  } | null;
  hr: {
    headcount: number;
    departments: ReportCountRow[];
    attendance: ReportCountRow[];
    leave: ReportCountRow[];
    turnover: { exits: number; averageHeadcount: number; rateBps: number };
    probationReviews: ReportCountRow[];
    expiringDocuments: ReportCountRow[];
    assetAssignments: ReportCountRow[];
  } | null;
  support: {
    openTickets: number;
    averageResolutionHours: number | null;
    slaBreaches: number;
    byCategory: ReportCountRow[];
    byClient: ReportCountRow[];
    agentWorkload: ReportCountRow[];
    satisfaction: { responses: number; averageScore: number | null };
  } | null;
  founderPack: FounderReportPack | null;
  legal: {
    activeContracts: number;
    expiringContracts: ReportCountRow[];
    pendingSignatures: ReportCountRow[];
    renewalObligations: ReportCountRow[];
    restrictedAccessEvents: ReportCountRow[];
    licenceExpirations: ReportCountRow[];
  } | null;
}

export function reportQueryString(
  filters: ReportsWorkspaceData["filters"],
  overrides: Partial<ReportsWorkspaceData["filters"]> = {},
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set("from", merged.from);
  params.set("to", merged.to);
  if (merged.comparison !== "none") params.set("comparison", merged.comparison);
  if (merged.section !== "overview") params.set("section", merged.section);
  for (const key of ["owner", "team", "department", "project", "client", "status"] as const) {
    const value = merged[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function resolveReportPeriod(
  filters: { from?: string; to?: string; periodMode?: ReportPeriodMode; timezone?: string },
  now: Date = new Date(),
): { from: string; to: string } {
  const timezone = filters.timezone ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? now.getUTCDate());
  const localToday = new Date(Date.UTC(year, month - 1, day));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  const startOfMonth = (date: Date) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const startOfQuarter = (date: Date) =>
    new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
  const startOfWeek = (date: Date) => {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return addDays(date, -mondayOffset);
  };

  const mode = filters.periodMode ?? "custom";
  if (mode !== "custom") {
    let from = localToday;
    let to = localToday;
    if (mode === "yesterday") from = to = addDays(localToday, -1);
    if (mode === "this_week") from = startOfWeek(localToday);
    if (mode === "last_week") {
      to = addDays(startOfWeek(localToday), -1);
      from = addDays(to, -6);
    }
    if (mode === "this_month") from = startOfMonth(localToday);
    if (mode === "last_month") {
      to = addDays(startOfMonth(localToday), -1);
      from = startOfMonth(to);
    }
    if (mode === "quarter_to_date") from = startOfQuarter(localToday);
    if (mode === "last_quarter") {
      to = addDays(startOfQuarter(localToday), -1);
      from = startOfQuarter(to);
    }
    if (mode === "year_to_date") from = new Date(Date.UTC(year, 0, 1));
    if (mode === "trailing_7_days") from = addDays(localToday, -6);
    if (mode === "trailing_30_days") from = addDays(localToday, -29);
    if (mode === "trailing_90_days") from = addDays(localToday, -89);
    return { from: iso(from), to: iso(to) };
  }

  const today = iso(localToday);
  const yearStart = `${year}-01-01`;
  const from = filters.from ?? yearStart;
  const to = filters.to ?? today;
  return from <= to ? { from, to } : { from: yearStart, to: today };
}

export function resolveComparisonPeriod(
  period: { from: string; to: string },
  comparison: ReportComparison,
): { from: string; to: string } | null {
  if (comparison === "none") return null;
  const from = new Date(`${period.from}T00:00:00.000Z`);
  const to = new Date(`${period.to}T00:00:00.000Z`);
  if (comparison === "previous_year") {
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    to.setUTCFullYear(to.getUTCFullYear() - 1);
  } else {
    const length = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    to.setUTCDate(from.getUTCDate() - 1);
    from.setUTCDate(from.getUTCDate() - length);
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function rateBps(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((Math.max(0, numerator) / denominator) * 10_000);
}
