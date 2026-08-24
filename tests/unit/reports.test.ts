import { describe, expect, it } from "vitest";

import { buildReportCsv } from "@/modules/reports/csv";
import {
  rateBps,
  reportQueryString,
  resolveComparisonPeriod,
  resolveReportPeriod,
  type ReportsWorkspaceData,
} from "@/modules/reports/reports";
import { reportsFiltersSchema } from "@/modules/reports/schemas/reports";

const emptyData: ReportsWorkspaceData = {
  filters: {
    from: "2026-07-01",
    to: "2026-07-31",
    comparison: "previous_period",
    section: "overview",
    owner: null,
    team: null,
    department: null,
    project: null,
    client: null,
    status: null,
  },
  comparisonPeriod: { from: "2026-05-31", to: "2026-06-30" },
  locale: "en-IN",
  currency: "INR",
  generatedAt: "2026-07-18T10:00:00.000Z",
  activeWidgetKeys: ["overview.summary"],
  savedViewId: null,
  options: { owners: [], teams: [], departments: [], projects: [], clients: [], statuses: [] },
  capabilities: {
    canExport: true,
    canManageSavedViews: true,
    canSchedule: true,
    canCreateSnapshot: true,
    sections: ["overview"],
  },
  summary: [
    {
      id: "formula",
      label: "=SUM(A1:A2)",
      value: 42,
      unit: "count",
      comparisonValue: 40,
      href: "/reports",
    },
  ],
  crm: null,
  projects: null,
  finance: null,
  hr: null,
  support: null,
  founderPack: null,
  legal: null,
};

describe("reports domain", () => {
  it("resolves default and invalid periods deterministically", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(resolveReportPeriod({}, now)).toEqual({ from: "2026-01-01", to: "2026-07-18" });
    expect(resolveReportPeriod({ from: "2026-08-01", to: "2026-07-01" }, now)).toEqual({
      from: "2026-01-01",
      to: "2026-07-18",
    });
  });

  it("resolves relative periods at execution time in the organization timezone", () => {
    const now = new Date("2026-08-18T18:45:00.000Z");
    expect(resolveReportPeriod({ periodMode: "today", timezone: "Asia/Kolkata" }, now)).toEqual({
      from: "2026-08-19",
      to: "2026-08-19",
    });
    expect(resolveReportPeriod({ periodMode: "this_week", timezone: "Asia/Kolkata" }, now)).toEqual(
      {
        from: "2026-08-17",
        to: "2026-08-19",
      },
    );
    expect(
      resolveReportPeriod({ periodMode: "trailing_30_days", timezone: "Asia/Kolkata" }, now),
    ).toEqual({
      from: "2026-07-21",
      to: "2026-08-19",
    });
  });

  it("calculates previous-period and previous-year windows", () => {
    expect(
      resolveComparisonPeriod({ from: "2026-07-01", to: "2026-07-31" }, "previous_period"),
    ).toEqual({ from: "2026-05-31", to: "2026-06-30" });
    expect(
      resolveComparisonPeriod({ from: "2026-07-01", to: "2026-07-31" }, "previous_year"),
    ).toEqual({ from: "2025-07-01", to: "2025-07-31" });
    expect(resolveComparisonPeriod({ from: "2026-07-01", to: "2026-07-31" }, "none")).toBeNull();
  });

  it("bounds rate calculations and normalizes report filters", () => {
    expect(rateBps(1, 4)).toBe(2500);
    expect(rateBps(4, 0)).toBe(0);
    const filters = reportsFiltersSchema.parse({
      from: "2026-07-01",
      to: "2026-07-31",
      comparison: "previous_year",
      section: "finance",
      status: "partially_paid",
      owner: "",
    });
    expect(filters.section).toBe("finance");
    expect(filters.owner).toBeNull();
    expect(filters.status).toBe("partially_paid");
  });

  it("builds stable query strings and prevents spreadsheet formula execution", () => {
    const query = reportQueryString(emptyData.filters, { section: "finance", status: "overdue" });
    expect(query).toContain("section=finance");
    expect(query).toContain("status=overdue");
    const csv = buildReportCsv(emptyData, "overview");
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain('"AgencyOS report","overview"');
  });
});
