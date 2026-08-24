import { describe, expect, it } from "vitest";

import { normalizeReportWidgets } from "@/modules/reports/report-builder";
import { buildReportDocument } from "@/modules/reports/report-document";
import type { ReportsWorkspaceData } from "@/modules/reports/reports";
import { reportScheduleSchema, savedReportViewSchema } from "@/modules/reports/schemas/reports";

const data: ReportsWorkspaceData = {
  filters: {
    from: "2026-07-01",
    to: "2026-07-31",
    comparison: "none",
    section: "finance",
    owner: null,
    team: null,
    department: null,
    project: null,
    client: null,
    status: null,
  },
  comparisonPeriod: null,
  locale: "en-US",
  currency: "USD",
  generatedAt: "2026-07-18T10:00:00.000Z",
  activeWidgetKeys: ["finance.summary"],
  savedViewId: null,
  options: { owners: [], teams: [], departments: [], projects: [], clients: [], statuses: [] },
  capabilities: {
    canExport: true,
    canManageSavedViews: true,
    canSchedule: true,
    canCreateSnapshot: true,
    sections: ["finance"],
  },
  summary: [],
  crm: null,
  projects: null,
  finance: {
    revenueByMonth: [{ id: "2026-07", label: "July", count: 1, amountMinor: 250000 }],
    clientBalances: [],
    clientConcentration: [],
    expenseBreakdown: [],
    outstandingMinor: 10000,
    overdueMinor: 5000,
    revenueMinor: 250000,
    expensesMinor: 100000,
    grossProfitMinor: 150000,
    taxMinor: 25000,
    collectionRateBps: 9600,
  },
  hr: null,
  support: null,
  founderPack: null,
  legal: null,
};

describe("advanced reports", () => {
  it("keeps report layouts inside the selected section and bounds duplicates", () => {
    expect(
      normalizeReportWidgets("finance", [
        "finance.summary",
        "crm.sources",
        "finance.summary",
        "finance.revenue",
      ]),
    ).toEqual(["finance.summary", "finance.revenue"]);
    expect(normalizeReportWidgets("projects", [])).toEqual([
      "projects.performance",
      "projects.workload",
    ]);
  });

  it("builds snapshots from only the selected report blocks", () => {
    const document = buildReportDocument(data);
    expect(document.blocks.map((block) => block.key)).toEqual(["finance.summary"]);
    expect(document.rowCount).toBe(7);
  });

  it("requires a weekday or month day for scheduled delivery", () => {
    expect(
      reportScheduleSchema.safeParse({
        savedViewId: "11111111-1111-4111-8111-111111111111",
        cadence: "weekly",
        localTime: "08:00",
        timezone: "UTC",
        weekday: "",
        monthDay: "",
        format: "pdf",
      }).success,
    ).toBe(false);
    expect(
      reportScheduleSchema.safeParse({
        savedViewId: "11111111-1111-4111-8111-111111111111",
        cadence: "monthly",
        localTime: "08:00",
        timezone: "UTC",
        weekday: "",
        monthDay: "12",
        format: "csv",
      }).success,
    ).toBe(true);
  });

  it("requires at least one bounded widget in a saved view", () => {
    const base = {
      viewId: null,
      name: "Finance review",
      description: null,
      filters: data.filters,
    };
    expect(savedReportViewSchema.safeParse({ ...base, widgetKeys: [] }).success).toBe(false);
    expect(
      savedReportViewSchema.safeParse({ ...base, widgetKeys: ["finance.summary"] }).success,
    ).toBe(true);
  });
});
