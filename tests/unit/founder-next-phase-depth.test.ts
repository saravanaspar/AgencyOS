import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSafeExternalReportUrl } from "@/modules/reports/server/delivery-destinations";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const migration = source("database/migrations/20260825006500_founder_next_phase_depth.sql");

describe("founder next-phase operating depth", () => {
  it.each([
    "https://0.1.2.3/report",
    "https://100.64.0.1/report",
    "https://192.0.2.1/report",
    "https://198.18.0.1/report",
    "https://[::ffff:127.0.0.1]/report",
    "https://[2002::1]/report",
    "https://[fc00::1]/report",
  ])("rejects private and reserved report destination %s", async (url) => {
    await expect(resolveSafeExternalReportUrl(url, "webhook")).rejects.toThrow(
      "Private/reserved webhook addresses are not allowed",
    );
  });

  it("builds the 30/60/90 forecast from canonical sources without pretending it is bank cash", () => {
    const forecast = source("src/modules/finance/server/cash-forecast.ts");
    const ui = source("src/components/finance/cash-forecast-section.tsx");

    expect(forecast).toContain("cashForecastScenarios.map");
    expect(forecast).toContain("cashForecastHorizons.map");
    expect(forecast).toContain('"receivables"');
    expect(forecast).toContain('"approved_expenses"');
    expect(forecast).toContain('"vendor_bills"');
    expect(forecast).toContain('"purchase_commitments"');
    expect(forecast).toContain('"payroll"');
    expect(forecast).toContain('"pipeline"');
    expect(forecast).toContain('"recurring_obligations"');
    expect(forecast).toContain("historicalMedianCollectionDays");
    expect(forecast).toContain('context.permissions.has("hr.salary.view")');
    expect(forecast).toContain('context.permissions.has("vendors.bill.view")');
    expect(forecast).toContain('context.permissions.has("crm.lead.view")');
    expect(forecast).toContain("not a bank-balance projection");
    expect(forecast).toContain("firstRecurringOccurrenceOnOrAfter");
    expect(forecast).toContain("entry.due < today");
    expect(ui).toContain("Assumption provenance");
    expect(ui).toContain("horizon.sources.map");
  });

  it("extends the existing worker, CRM follow-up, notification, and email paths for collections", () => {
    const worker = source("src/modules/finance/server/collections-worker.ts");
    const collections = source("src/modules/finance/server/collections.ts");
    const workerRegistry = source("src/modules/workers/server/worker-registry.ts");
    const processRunner = source("scripts/workers/run.mjs");

    expect(worker).toContain("runFinanceCollectionsWorker");
    expect(worker).toContain("finance_collection_cases");
    expect(worker).toContain("finance_collection_events");
    expect(worker).toContain("promise_to_pay_on");
    expect(worker).toContain("dispute_suppressed");
    expect(worker).toContain("delivery_failed");
    expect(worker).toContain("idempotencyKey");
    expect(worker).toContain("notificationRetryDelaySeconds");
    expect(worker).toContain("next_delivery_attempt_at");
    expect(worker).toContain("'follow_up'");
    expect(worker).toContain("enqueueNotification");
    expect(worker).toContain("collection_owner.id is not null");
    expect(worker).toContain("membership.status = 'active'");
    expect(collections).toContain("retryPending");
    expect(workerRegistry).toContain('"finance-collections"');
    expect(processRunner).toContain('key: "finance-collections"');
    expect(migration).toContain("finance_collection_events_append_only");
    expect(migration).toContain("finance_collection_events_stage_unique");
    expect(migration).toContain("finance_collection_events_reminder_channel_unique");
  });

  it("keeps Universal My Work as state over canonical source records rather than a duplicate task system", () => {
    const dashboard = source("src/modules/dashboard/server/dashboard.ts");
    const workLoader = source("src/modules/dashboard/server/founder-work.ts");
    const workSource = `${dashboard}
${workLoader}`;
    const actions = source("src/modules/dashboard/actions/founder-work.ts");
    const ui = source("src/components/dashboard/role-dashboard.tsx");

    expect(migration).toContain("create table public.founder_work_item_states");
    expect(migration).toContain("item_title text not null");
    expect(migration).toContain("source_href text not null");
    expect(migration).toContain("source_bucket text not null");
    expect(migration).toContain("source_due_at timestamptz");
    expect(migration).toContain("state in ('active','snoozed','delegated','handled')");
    expect(workSource).toContain("founder_work_item_states");
    expect(workSource).toContain('state.state === "handled"');
    expect(workSource).toContain('state.state === "snoozed"');
    expect(workSource).toContain('state.state === "delegated"');
    expect(dashboard).toContain('title: "Delegated founder work"');
    expect(actions).toContain("delegatedToMembershipId");
    expect(actions).toContain("recipientMembershipId: value.delegatedToMembershipId");
    expect(actions).toContain("sourceAmountMinor");
    expect(workLoader).toContain("support_ticket_membership_access_allowed");
    expect(workLoader).toContain("vendor.display_name as vendor_name");
    expect(workLoader).not.toContain("vendor.name as vendor_name");
    expect(dashboard).toContain("legal_contract_membership_access_allowed");
    expect(ui).toContain("Snooze 1d");
    expect(ui).toContain("Snooze 7d");
    expect(ui).toContain("Handled");
    expect(ui).toContain("Reclaim");
  });

  it("routes salary revisions through the shared Approval engine with database enforcement", () => {
    const salaryAction = source("src/modules/hr/actions/salary.ts");
    const salaryApprovals = source("src/modules/hr/server/salary-approvals.ts");

    expect(salaryAction).toContain("submitSalaryRevisionApproval");
    expect(salaryAction).toContain("pg_advisory_xact_lock");
    expect(salaryAction).not.toContain("insert into public.hr_salary_structures");
    expect(salaryApprovals).toContain("submitApprovalForRecordAtomically");
    expect(salaryApprovals).toContain("allowSelfApproval: false");
    expect(salaryApprovals).toContain('entityType: "salary_revision"');
    expect(migration).toContain("approval_requests_apply_hr_salary_result");
    expect(migration).toContain("hr_salary_structures_validate_shared_approval");
    expect(migration).toContain("definition.allow_self_approval = false");
  });

  it("adds a versioned monthly founder pack using existing reporting primitives and source links", () => {
    const packs = source("src/modules/reports/server/founder-packs.ts");
    const reportTypes = source("src/modules/reports/reports.ts");
    const definitions = source("src/modules/reports/metric-definitions.ts");
    const dashboard = source("src/components/dashboard/role-dashboard.tsx");

    expect(reportTypes).toContain('"founder_monthly"');
    expect(packs).toContain('systemKey: "founder.monthly.v1"');
    expect(packs).toContain('cadence: "monthly"');
    expect(packs).toContain("monthDay: 1");
    expect(packs).toContain("monthlyFinancialTrend");
    expect(packs).toContain("getCashForecastForContext(context)");
    expect(packs).toContain("getClientConcentrationForContext(database, context, lastMonth)");
    expect(packs).toContain('block("founder_monthly.financial", "Financial trend"');
    expect(packs).toContain("project-margin-last-month");
    expect(definitions).toContain('"founder_monthly.financial.cash-forecast"');
    expect(dashboard).toContain("generateFounderMonthlyBoardPackAction");
  });

  it("extends the existing recipient delivery pipeline with encrypted Slack, Telegram, and webhook destinations", () => {
    const destinationAction = source("src/modules/reports/actions/delivery-destinations.ts");
    const destinations = source("src/modules/reports/server/delivery-destinations.ts");
    const deliveryWorker = source("src/modules/reports/server/delivery-worker.ts");
    const studio = source("src/components/reports/report-studio.tsx");

    expect(migration).toContain("create table public.report_delivery_destinations");
    expect(migration).toContain("report_delivery_destinations_one_active_channel");
    expect(migration).toContain("array['in_app','email','slack','telegram','webhook']");
    expect(destinationAction).toContain("encryptSecretObjectWithEnvironmentKey");
    expect(destinations).toContain('const KEY_ENV = "REPORT_DELIVERY_ENCRYPTION_KEY"');
    expect(destinations).toContain('hostname !== "hooks.slack.com"');
    expect(destinations).toContain("Private/reserved webhook addresses are not allowed");
    expect(destinations).toContain("lookup(hostname, { all: true, verbatim: true })");
    expect(destinations).toContain("BlockList");
    expect(deliveryWorker).toContain("pinnedExternalPost");
    expect(deliveryWorker).toContain("generateReportSnapshot(context");
    expect(deliveryWorker).toContain("activeReportDeliveryDestination");
    expect(deliveryWorker).toContain("sendDocument");
    expect(deliveryWorker).toContain('"idempotency-key": idempotencyKey');
    expect(deliveryWorker).toContain("report-recipient-permission-revoked");
    expect(studio).toContain("External delivery destinations");
    expect(source(".env.example")).toContain("REPORT_DELIVERY_ENCRYPTION_KEY=");
  });

  it("keeps all new persistent state tenant-scoped, RLS-protected, and narrowly permissioned", () => {
    for (const table of [
      "finance_cash_forecast_settings",
      "finance_cash_recurring_items",
      "finance_collection_policies",
      "finance_collection_cases",
      "finance_collection_events",
      "founder_work_item_states",
      "report_delivery_destinations",
    ]) {
      expect(migration, table).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("finance.cash_forecast.manage");
    expect(migration).toContain("finance.collection.manage");
    expect(migration).toContain("reports.delivery_destination.manage");
    expect(migration).toContain("validate_founder_next_phase_tenant");
  });
});
