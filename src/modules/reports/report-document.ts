import { escapeCsvCell } from "@/modules/audit/audit-log-utils";
import { getNumberFormatter } from "@/lib/intl-formatters";
import { formatMinorMoney } from "@/modules/finance/calculations";
import { reportWidgetLabel, type ReportWidgetKey } from "@/modules/reports/report-builder";
import type { ReportCountRow, ReportsWorkspaceData } from "@/modules/reports/reports";

export interface ReportDocumentBlock {
  key: ReportWidgetKey;
  title: string;
  columns: string[];
  rows: string[][];
}

function money(value: number, data: ReportsWorkspaceData): string {
  return formatMinorMoney(value, data.currency, data.locale);
}

function decimal(value: number, data: ReportsWorkspaceData): string {
  return getNumberFormatter(data.locale, { maximumFractionDigits: 1 }).format(value);
}

function countBlock(
  key: ReportWidgetKey,
  rows: readonly ReportCountRow[],
  data: ReportsWorkspaceData,
  value: "count" | "amount" | "days" = "count",
): ReportDocumentBlock {
  return {
    key,
    title: reportWidgetLabel(key),
    columns: [
      "Label",
      value === "amount" ? "Amount" : value === "days" ? "Days" : "Count",
      "Detail",
    ],
    rows: rows.map((row) => [
      row.label,
      value === "amount"
        ? money(row.amountMinor ?? 0, data)
        : value === "days"
          ? decimal(row.averageDays ?? 0, data)
          : String(row.count),
      row.secondary ?? "",
    ]),
  };
}

function blockForWidget(
  key: ReportWidgetKey,
  data: ReportsWorkspaceData,
): ReportDocumentBlock | null {
  if ((key.startsWith("founder_daily.") || key.startsWith("founder_weekly.")) && data.founderPack) {
    const founderBlock = data.founderPack.blocks.find((block) => block.id === key);
    if (!founderBlock) return null;
    return {
      key,
      title: founderBlock.title,
      columns: ["Metric", "Value", "Detail"],
      rows: founderBlock.rows.map((row) => [row.label, row.value, row.detail ?? ""]),
    };
  }

  if (key === "overview.summary") {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: ["Metric", "Value", "Comparison"],
      rows: data.summary.map((metric) => [
        metric.label,
        metric.unit === "minor"
          ? money(metric.value, data)
          : metric.unit === "bps"
            ? `${decimal(metric.value / 100, data)}%`
            : metric.unit === "minutes"
              ? `${decimal(metric.value / 60, data)} h`
              : String(metric.value),
        metric.comparisonValue == null ? "" : String(metric.comparisonValue),
      ]),
    };
  }
  if (key === "overview.pipeline" && data.crm)
    return countBlock(key, data.crm.pipelineByStage, data, "amount");
  if (key === "overview.revenue" && data.finance)
    return countBlock(key, data.finance.revenueByMonth, data, "amount");
  if (key === "overview.workload" && data.projects) {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: ["Member", "Open tasks", "Overdue tasks", "Utilization"],
      rows: data.projects.workload.map((row) => [
        row.name,
        String(row.openTasks),
        String(row.overdueTasks),
        `${decimal(row.utilizationBps / 100, data)}%`,
      ]),
    };
  }
  if (key === "overview.support" && data.support)
    return countBlock(key, data.support.byCategory, data);

  if (key === "crm.sources" && data.crm) return countBlock(key, data.crm.leadsBySource, data);
  if (key === "crm.pipeline" && data.crm)
    return countBlock(key, data.crm.pipelineByStage, data, "amount");
  if (key === "crm.status" && data.crm) return countBlock(key, data.crm.leadsByStatus, data);
  if (key === "crm.owners" && data.crm)
    return countBlock(key, data.crm.salesByOwner, data, "amount");
  if (key === "crm.stage_time" && data.crm)
    return countBlock(key, data.crm.timeInStage, data, "days");
  if (key === "crm.lost_reasons" && data.crm) return countBlock(key, data.crm.lostReasons, data);

  if (key === "projects.performance" && data.projects) {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: ["Project", "Status", "Progress", "Overdue", "Hours", "Gross profit"],
      rows: data.projects.projects.map((project) => [
        `${project.code} ${project.name}`,
        project.status,
        `${project.progress}%`,
        String(project.overdueTasks),
        `${decimal(project.actualMinutes / 60, data)} / ${decimal(project.estimatedMinutes / 60, data)}`,
        money(project.grossProfitMinor, data),
      ]),
    };
  }
  if (key === "projects.workload" && data.projects) {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: [
        "Member",
        "Department",
        "Open",
        "Overdue",
        "Estimated h",
        "Actual h",
        "Utilization",
      ],
      rows: data.projects.workload.map((row) => [
        row.name,
        row.department ?? "Unassigned",
        String(row.openTasks),
        String(row.overdueTasks),
        decimal(row.estimatedMinutes / 60, data),
        decimal(row.actualMinutes / 60, data),
        `${decimal(row.utilizationBps / 100, data)}%`,
      ]),
    };
  }

  if (key === "finance.revenue" && data.finance)
    return countBlock(key, data.finance.revenueByMonth, data, "amount");
  if (key === "finance.balances" && data.finance)
    return countBlock(key, data.finance.clientBalances, data, "amount");
  if (key === "finance.expenses" && data.finance)
    return countBlock(key, data.finance.expenseBreakdown, data, "amount");
  if (key === "finance.summary" && data.finance) {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: ["Metric", "Value"],
      rows: [
        ["Revenue", money(data.finance.revenueMinor, data)],
        ["Expenses", money(data.finance.expensesMinor, data)],
        ["Gross profit", money(data.finance.grossProfitMinor, data)],
        ["Tax", money(data.finance.taxMinor, data)],
        ["Outstanding", money(data.finance.outstandingMinor, data)],
        ["Overdue", money(data.finance.overdueMinor, data)],
        ["Collection rate", `${decimal(data.finance.collectionRateBps / 100, data)}%`],
      ],
    };
  }

  if (key === "hr.departments" && data.hr) return countBlock(key, data.hr.departments, data);
  if (key === "hr.attendance" && data.hr) return countBlock(key, data.hr.attendance, data);
  if (key === "hr.leave" && data.hr) return countBlock(key, data.hr.leave, data, "days");
  if (key === "hr.probation" && data.hr) return countBlock(key, data.hr.probationReviews, data);
  if (key === "hr.documents" && data.hr) return countBlock(key, data.hr.expiringDocuments, data);
  if (key === "hr.assets" && data.hr) return countBlock(key, data.hr.assetAssignments, data);

  if (key === "support.categories" && data.support)
    return countBlock(key, data.support.byCategory, data);
  if (key === "support.clients" && data.support)
    return countBlock(key, data.support.byClient, data);
  if (key === "support.workload" && data.support)
    return countBlock(key, data.support.agentWorkload, data);
  if (key === "support.summary" && data.support) {
    return {
      key,
      title: reportWidgetLabel(key),
      columns: ["Metric", "Value"],
      rows: [
        ["Open tickets", String(data.support.openTickets)],
        ["SLA breaches", String(data.support.slaBreaches)],
        [
          "Average resolution",
          data.support.averageResolutionHours == null
            ? "No data"
            : `${decimal(data.support.averageResolutionHours, data)} h`,
        ],
        [
          "Satisfaction",
          data.support.satisfaction.averageScore == null
            ? "No responses"
            : `${decimal(data.support.satisfaction.averageScore, data)} / 5`,
        ],
      ],
    };
  }

  if (key === "legal.expiring" && data.legal)
    return countBlock(key, data.legal.expiringContracts, data);
  if (key === "legal.signatures" && data.legal)
    return countBlock(key, data.legal.pendingSignatures, data);
  if (key === "legal.renewals" && data.legal)
    return countBlock(key, data.legal.renewalObligations, data);
  if (key === "legal.restricted_access" && data.legal)
    return countBlock(key, data.legal.restrictedAccessEvents, data);
  if (key === "legal.licences" && data.legal)
    return countBlock(key, data.legal.licenceExpirations, data);
  return null;
}

export function buildReportDocument(data: ReportsWorkspaceData): {
  blocks: ReportDocumentBlock[];
  rowCount: number;
} {
  const blocks = data.activeWidgetKeys
    .map((key) => blockForWidget(key as ReportWidgetKey, data))
    .filter((block): block is ReportDocumentBlock => block !== null);
  return { blocks, rowCount: blocks.reduce((sum, block) => sum + block.rows.length, 0) };
}

function csvLine(values: readonly unknown[]): string {
  return values.map(escapeCsvCell).join(",");
}

export function buildReportDocumentCsv(data: ReportsWorkspaceData): string {
  const document = buildReportDocument(data);
  const rows: unknown[][] = [
    ["AgencyOS report", data.filters.section],
    ["Period", `${data.filters.from} to ${data.filters.to}`],
    ["Generated at", data.generatedAt],
    [],
  ];
  for (const block of document.blocks) {
    rows.push([block.title], block.columns, ...block.rows, []);
  }
  return `${rows.map(csvLine).join("\r\n")}\r\n`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildReportDocumentHtml(data: ReportsWorkspaceData, title: string): string {
  const document = buildReportDocument(data);
  const blocks = document.blocks
    .map(
      (block) =>
        `<section><h2>${escapeHtml(block.title)}</h2><table><thead><tr>${block.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${block.rows.length === 0 ? `<tr><td colspan="${block.columns.length}">No authorized data for this period.</td></tr>` : block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111820;font-size:10px;margin:0}header{border-bottom:2px solid #2b5ea7;padding-bottom:10px;margin-bottom:18px}h1{font-size:22px;margin:0 0 5px}header p{margin:2px 0;color:#5c6a78}section{break-inside:avoid;margin:0 0 18px}h2{font-size:13px;margin:0 0 7px}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #dde1e7;padding:6px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8eff8;font-weight:700}tbody tr:nth-child(even){background:#f5f6f8}footer{margin-top:16px;color:#5c6a78;font-size:9px}</style></head><body><header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(data.filters.from)} to ${escapeHtml(data.filters.to)}</p><p>Generated ${escapeHtml(data.generatedAt)}. Permission-filtered AgencyOS data.</p></header>${blocks || "<p>No authorized report data is available.</p>"}<footer>AgencyOS confidential report snapshot</footer></body></html>`;
}
