import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getMetricDefinition,
  metricDefinitionCatalog,
} from "@/modules/reports/metric-definitions";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("founder next-phase reporting", () => {
  it("keeps executive metric definitions centralized and evidence-bearing", () => {
    const keys = [
      "summary.revenue",
      "summary.gross-profit",
      "summary.overdue-invoices",
      "summary.lead-conversion",
      "summary.overdue-projects",
      "summary.headcount",
      "summary.open-support",
      "summary.active-contracts",
      "client_concentration.revenue",
      "client_concentration.receivables",
      "client_concentration.pipeline",
      "founder_daily.money.revenue-mtd",
      "founder_daily.sales.weighted-pipeline",
      "founder_daily.delivery.overdue-tasks",
      "founder_daily.people.hr-approvals",
      "founder_daily.actions.approvals",
      "founder_weekly.previous.revenue",
      "founder_weekly.next.expected-collections",
    ];

    for (const key of keys) {
      const definition = getMetricDefinition(key);
      expect(definition, key).not.toBeNull();
      expect(definition?.meaning.length, key).toBeGreaterThan(10);
      expect(definition?.formula.length, key).toBeGreaterThan(10);
      expect(definition?.sourceEntities.length, key).toBeGreaterThan(0);
      expect(definition?.currencyRule.length, key).toBeGreaterThan(5);
    }
    expect(Object.keys(metricDefinitionCatalog).length).toBeGreaterThan(40);
    expect(getMetricDefinition("client_concentration.revenue")?.currencyRule).toContain(
      "never summed",
    );
  });

  it("computes concentration from permission-scoped finance and CRM sources without currency mixing", () => {
    const concentration = source("src/modules/reports/server/client-concentration.ts");
    expect(concentration).toContain("group by invoice.currency");
    expect(concentration).toContain("lead.estimated_value, 0) * lead.probability / 100.0");
    expect(concentration).toContain("private.crm_scope_allows_membership");
    expect(concentration).toContain("topThreeShareBps");
    expect(concentration).toContain("kind === \"pipeline\"");
    expect(concentration).toContain('scope: kind === "revenue" ? "issued_revenue" : "open_receivables"');
    expect(concentration).toContain('scope: "open_opportunities"');
    expect(concentration).toContain("client_concentration.${kind}");
    expect(concentration).not.toContain("sum(sourceRows");
  });

  it("reuses the report widget and founder-pack surfaces for concentration", () => {
    const builder = source("src/modules/reports/report-builder.ts");
    const reportServer = source("src/modules/reports/server/reports.ts");
    const founderPacks = source("src/modules/reports/server/founder-packs.ts");
    const workspace = source("src/components/reports/reports-workspace.tsx");
    const document = source("src/modules/reports/report-document.ts");

    expect(builder).toContain('key: "finance.concentration"');
    expect(builder).toContain('key: "founder_daily.concentration"');
    expect(reportServer).toContain("getClientConcentrationForContext");
    expect(founderPacks).toContain('block("founder_daily.concentration"');
    expect(workspace).toContain("ClientConcentrationReport");
    expect(document).toContain('key === "finance.concentration"');
  });

  it("exposes definitions and source links instead of creating a parallel drill-down system", () => {
    const workspace = source("src/components/reports/reports-workspace.tsx");
    const document = source("src/modules/reports/report-document.ts");
    const founderPacks = source("src/modules/reports/server/founder-packs.ts");

    expect(workspace).toContain("MetricDefinitionDisclosure");
    expect(workspace).toContain("Open source");
    expect(workspace).toContain("Open all source records");
    expect(document).toContain("Source records");
    expect(document).toContain("definitionCells");
    expect(founderPacks).toContain("founderMetricDefinitionKey");
    expect(founderPacks).toContain("reportHref");
    expect(founderPacks).toContain("financeHref");
  });

  it("keeps finance drill-down date scopes active on source-record lists", () => {
    const sourceFilters = source("src/modules/finance/server/source-filters.ts");
    const expenses = source("src/modules/finance/server/expenses.ts");
    const workspace = source("src/components/finance/finance-workspace.tsx");

    expect(sourceFilters).toContain("invoice.issue_date >= ${filters.from}::date");
    expect(sourceFilters).toContain("invoice.issue_date <= ${filters.to}::date");
    expect(sourceFilters).toContain("payment.payment_date >= ${filters.from}::date");
    expect(sourceFilters).toContain("filters.scope} = 'issued_revenue'");
    expect(sourceFilters).toContain("filters.scope} = 'open_receivables'");
    expect(sourceFilters).toContain("filters.scope} = 'overdue_receivables'");
    expect(sourceFilters).toContain("filters.scope} = 'expected_collection'");
    expect(expenses).toContain("expense.expense_date >= ${filters.from}::date");
    expect(workspace).toContain("data.filters.from || data.filters.to");
  });

  it("makes weekly forward metrics truly next-week metrics and keeps forecast navigation reachable", () => {
    const founderPacks = source("src/modules/reports/server/founder-packs.ts");
    const crmPage = source("src/app/(workspace)/crm/page.tsx");
    const crmSchema = source("src/modules/crm/schemas/crm.ts");
    const crmServer = source("src/modules/crm/server/crm.ts");

    expect(founderPacks).toContain("bounds.this_week + 7");
    expect(founderPacks).toContain("bounds.this_week + 14");
    expect(founderPacks).toContain("const nextWeek = shiftPeriod(thisWeek, 7)");
    expect(founderPacks).toContain('scope: "expected_issue"');
    expect(founderPacks).toContain('scope: "expected_collection"');
    expect(founderPacks).toContain('scope: "open_opportunities"');
    expect(crmSchema).toContain('z.enum(["open_opportunities"])');
    expect(crmServer).toContain("stage.state = 'open'");
    expect(crmPage).toContain('"pipeline", "forecast", "companies"');
  });
});
