export interface MetricDefinition {
  key: string;
  meaning: string;
  formula: string;
  sourceEntities: readonly string[];
  currencyRule: string;
  caveats: readonly string[];
}

const defaultCurrencyOnly =
  "Uses the organization's default currency only; records in other currencies are not converted or summed.";
const currencySeparated =
  "Calculated independently per ISO currency; values from different currencies are never summed.";
const nonMonetary = "Not a monetary metric.";

function define(
  key: string,
  meaning: string,
  formula: string,
  sourceEntities: readonly string[],
  currencyRule: string = nonMonetary,
  caveats: readonly string[] = [],
): MetricDefinition {
  return { key, meaning, formula, sourceEntities, currencyRule, caveats };
}

export const metricDefinitionCatalog: Readonly<Record<string, MetricDefinition>> = {
  "summary.revenue": define(
    "summary.revenue",
    "Issued net invoice revenue in the active report period.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices in the selected period.",
    ["finance_invoices"],
    defaultCurrencyOnly,
    ["This is invoiced revenue, not recognized accounting revenue or cash received."],
  ),
  "summary.gross-profit": define(
    "summary.gross-profit",
    "Report-period invoiced revenue less approved recorded expenses.",
    "Revenue minor - approved expense minor for the selected report period.",
    ["finance_invoices", "finance_expenses"],
    defaultCurrencyOnly,
    ["This is an operational gross-profit view and is not a replacement for a general ledger."],
  ),
  "summary.overdue-invoices": define(
    "summary.overdue-invoices",
    "Open invoice balances whose due date has passed.",
    "Sum(invoice balance minor) where the invoice is open and due_date < current_date.",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "summary.lead-conversion": define(
    "summary.lead-conversion",
    "Share of eligible closed CRM leads that converted.",
    "Converted leads / (converted + lost leads) x 100.",
    ["crm_leads"],
    nonMonetary,
    ["Uses the report-period CRM population and the caller's CRM permission scope."],
  ),
  "summary.overdue-projects": define(
    "summary.overdue-projects",
    "Visible projects with at least one overdue non-terminal task.",
    "Count(distinct visible projects where overdue task count > 0).",
    ["projects", "project_tasks", "project_task_statuses"],
  ),
  "summary.headcount": define(
    "summary.headcount",
    "Active employee memberships visible to the current HR permission scope.",
    "Count(active memberships in the authorized HR scope).",
    ["memberships", "hr_employee_profiles"],
  ),
  "summary.open-support": define(
    "summary.open-support",
    "Support tickets that are currently not resolved or closed.",
    "Count(authorized support tickets in open workflow states).",
    ["support_tickets"],
  ),
  "summary.active-contracts": define(
    "summary.active-contracts",
    "Legal contracts currently classified as active and visible to the caller.",
    "Count(authorized legal contracts where status = active).",
    ["legal_contracts"],
  ),

  "founder_daily.money.revenue-mtd": define(
    "founder_daily.money.revenue-mtd",
    "Issued net invoice revenue from the start of the current month through today.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices with issue_date in the current month.",
    ["finance_invoices"],
    defaultCurrencyOnly,
    ["Invoiced revenue is not recognized revenue and is not cash received."],
  ),
  "founder_daily.money.revenue-ytd": define(
    "founder_daily.money.revenue-ytd",
    "Issued net invoice revenue from the start of the current year through today.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices with issue_date in the current year.",
    ["finance_invoices"],
    defaultCurrencyOnly,
    ["Invoiced revenue is not recognized revenue and is not cash received."],
  ),
  "founder_daily.money.cash-mtd": define(
    "founder_daily.money.cash-mtd",
    "Incoming payments recorded during the current month.",
    "Sum(finance payment amount minor) where payment_date is in the current month.",
    ["finance_payments"],
    defaultCurrencyOnly,
    ["Recorded payments are not the same as reconciled bank cash."],
  ),
  "founder_daily.money.receivables": define(
    "founder_daily.money.receivables",
    "Current open issued invoice balances.",
    "Sum(invoice balance minor) for issued invoices that are not paid, void, or credited.",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "founder_daily.money.overdue": define(
    "founder_daily.money.overdue",
    "Current open issued invoice balances past their due date.",
    "Sum(invoice balance minor) for open issued invoices where due_date < today.",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "founder_daily.money.upcoming-payments": define(
    "founder_daily.money.upcoming-payments",
    "Approved or scheduled outgoing obligations due within the next seven days.",
    "Approved/scheduled expense obligations + approved vendor-bill obligations due in the next seven days.",
    ["finance_expenses", "procurement_vendor_bills"],
    defaultCurrencyOnly,
  ),
  "founder_daily.money.cash-estimate": define(
    "founder_daily.money.cash-estimate",
    "Operational recorded-cash estimate based on AgencyOS payment and paid-obligation records.",
    "Lifetime recorded incoming payments - recorded paid expenses - recorded paid vendor bills.",
    ["finance_payments", "finance_expenses", "procurement_vendor_bills"],
    defaultCurrencyOnly,
    ["Not a bank balance, reconciliation, available-cash statement, or accounting ledger balance."],
  ),

  "founder_daily.sales.open-pipeline": define(
    "founder_daily.sales.open-pipeline",
    "Number and unweighted value of currently open CRM opportunities.",
    "Count(open opportunities); displayed supporting amount = sum(estimated value).",
    ["crm_leads", "crm_pipeline_stages"],
    currencySeparated,
    ["The founder card displays the organization's default-currency slice."],
  ),
  "founder_daily.sales.weighted-pipeline": define(
    "founder_daily.sales.weighted-pipeline",
    "Probability-weighted expected value of currently open CRM opportunities.",
    "Sum(estimated value x probability / 100) for open opportunities.",
    ["crm_leads", "crm_pipeline_stages"],
    currencySeparated,
    ["Pipeline probability is an operating forecast, not contracted revenue."],
  ),
  "founder_daily.sales.closing-month": define(
    "founder_daily.sales.closing-month",
    "Probability-weighted value of open opportunities expected to close this month.",
    "Sum(estimated value x probability / 100) for open opportunities with expected_close_date in the current month.",
    ["crm_leads", "crm_pipeline_stages"],
    currencySeparated,
  ),
  "founder_daily.sales.stale": define(
    "founder_daily.sales.stale",
    "Open opportunities without a meaningful record update for at least seven days.",
    "Count(open CRM opportunities where updated_at < now - 7 days).",
    ["crm_leads"],
  ),
  "founder_daily.sales.lost": define(
    "founder_daily.sales.lost",
    "CRM opportunities recorded as lost in the rolling 365-day loss-reason sample.",
    "Count(lost opportunities where closed/updated timestamp is within the last 365 days).",
    ["crm_leads"],
  ),
  "founder_daily.sales.followups": define(
    "founder_daily.sales.followups",
    "Open CRM opportunities whose required follow-up time has passed.",
    "Count(open opportunities where follow_up_at < now).",
    ["crm_leads"],
  ),

  "founder_daily.delivery.rag": define(
    "founder_daily.delivery.rag",
    "Operational red/amber/green distribution of visible projects.",
    "Red = overdue/on-hold/open overdue work; amber = due within seven days; remaining active visible projects = green.",
    ["projects", "project_tasks", "project_task_statuses"],
  ),
  "founder_daily.delivery.deadlines": define(
    "founder_daily.delivery.deadlines",
    "Visible projects with a delivery date in the next seven days.",
    "Count(visible active projects with due date from today through today + 7 days).",
    ["projects"],
  ),
  "founder_daily.delivery.overdue-tasks": define(
    "founder_daily.delivery.overdue-tasks",
    "Visible non-terminal project tasks whose due date has passed.",
    "Count(authorized non-terminal tasks where due_date < today).",
    ["project_tasks", "project_task_statuses"],
  ),
  "founder_daily.delivery.unsubmitted-time": define(
    "founder_daily.delivery.unsubmitted-time",
    "Draft project time entries for the current week.",
    "Count(visible project time entries in draft/unsubmitted state for the current week).",
    ["project_time_entries"],
  ),
  "founder_daily.delivery.budget-overruns": define(
    "founder_daily.delivery.budget-overruns",
    "Visible projects whose recorded cost has exceeded the configured project budget.",
    "Count(project profitability rows where budget variance minor < 0).",
    ["projects", "finance_expenses", "project_time_entries"],
    defaultCurrencyOnly,
    ["Uses recorded AgencyOS costs and configured budgets, not a general-ledger cost basis."],
  ),

  "founder_daily.people.away": define(
    "founder_daily.people.away",
    "Employees on approved leave covering today.",
    "Count(approved leave requests whose approved date range includes today).",
    ["hr_leave_requests", "memberships"],
  ),
  "founder_daily.people.attendance": define(
    "founder_daily.people.attendance",
    "Attendance records requiring operational attention today.",
    "Count(today's authorized attendance records marked absent, half-day, late, or early departure).",
    ["hr_attendance_records", "memberships"],
  ),
  "founder_daily.people.onboarding": define(
    "founder_daily.people.onboarding",
    "Employee onboarding plans that are not completed or cancelled.",
    "Count(open onboarding plans in the authorized HR scope).",
    ["hr_onboarding_plans"],
  ),
  "founder_daily.people.offboarding": define(
    "founder_daily.people.offboarding",
    "Employee offboarding plans that are not completed or cancelled.",
    "Count(open offboarding plans in the authorized HR scope).",
    ["hr_offboarding_plans"],
  ),
  "founder_daily.people.hr-approvals": define(
    "founder_daily.people.hr-approvals",
    "Pending approval requests associated with HR-controlled workflows.",
    "Count(pending shared approval requests for HR-related entities visible to the caller).",
    ["approval_requests", "approval_request_steps"],
  ),

  "founder_daily.actions.approvals": define(
    "founder_daily.actions.approvals",
    "Pending shared approval steps assigned to the founder/member.",
    "Count(pending approval request steps assigned to the current membership).",
    ["approval_requests", "approval_request_steps"],
  ),
  "founder_daily.actions.invoices": define(
    "founder_daily.actions.invoices",
    "Invoices in an actionable pre-issue state.",
    "Count(authorized invoices in draft or approved states that have not been issued).",
    ["finance_invoices"],
  ),
  "founder_daily.actions.collections": define(
    "founder_daily.actions.collections",
    "Open invoices due today or overdue and therefore requiring collection attention.",
    "Count(open invoices where due_date <= today and balance_minor > 0).",
    ["finance_invoices"],
  ),
  "founder_daily.actions.contracts": define(
    "founder_daily.actions.contracts",
    "Active contracts reaching renewal or end date within 30 days.",
    "Count(authorized active contracts with renewal/end date from today through today + 30 days).",
    ["legal_contracts"],
  ),
  "founder_daily.actions.vendor": define(
    "founder_daily.actions.vendor",
    "Vendor payment approvals currently requiring founder action.",
    "Count(pending vendor-payment approval steps assigned to the current membership).",
    ["approval_requests", "approval_request_steps", "procurement_vendor_bills"],
  ),
  "founder_daily.actions.security": define(
    "founder_daily.actions.security",
    "Unread security or integration notifications requiring attention.",
    "Count(unread operational/security notifications assigned to the current membership).",
    ["notifications"],
  ),

  "founder_weekly.previous.revenue": define(
    "founder_weekly.previous.revenue",
    "Issued net invoice revenue during the previous local calendar week.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices with issue_date in the previous week.",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "founder_weekly.previous.cash": define(
    "founder_weekly.previous.cash",
    "Incoming payments recorded during the previous local calendar week.",
    "Sum(finance payment amount minor) where payment_date is in the previous week.",
    ["finance_payments"],
    defaultCurrencyOnly,
  ),
  "founder_weekly.previous.expenses": define(
    "founder_weekly.previous.expenses",
    "Recorded non-rejected expenses dated during the previous local calendar week.",
    "Sum(expense total minor) for visible non-rejected expenses with expense_date in the previous week.",
    ["finance_expenses"],
    defaultCurrencyOnly,
  ),
  "founder_weekly.previous.pipeline": define(
    "founder_weekly.previous.pipeline",
    "Estimated value of CRM opportunities created during the previous local calendar week.",
    "Sum(lead estimated value) for authorized CRM leads created in the previous week.",
    ["crm_leads"],
    currencySeparated,
    [
      "The founder card displays the organization's default-currency slice and is not probability weighted.",
    ],
  ),
  "founder_weekly.previous.won-lost": define(
    "founder_weekly.previous.won-lost",
    "CRM opportunities recorded won/converted versus lost during the previous week.",
    "Count(converted opportunities) / Count(lost opportunities) using close/update events in the previous week.",
    ["crm_leads"],
  ),
  "founder_weekly.previous.utilization": define(
    "founder_weekly.previous.utilization",
    "Operational utilization approximation for active members on visible projects.",
    "Submitted project minutes in the previous week / (active visible-project members x 40 hours) x 100.",
    ["project_time_entries", "memberships", "projects"],
    nonMonetary,
    ["Uses a 40-hour denominator rather than each employee's contractual capacity."],
  ),
  "founder_weekly.previous.margin": define(
    "founder_weekly.previous.margin",
    "Current gross contribution margin across visible projects with invoiced revenue.",
    "Sum(project gross contribution minor) / Sum(project invoiced revenue minor) x 100.",
    ["projects", "finance_invoices", "finance_expenses", "project_time_entries"],
    defaultCurrencyOnly,
    [
      "This is a current project profitability view, not strictly a previous-week accounting margin.",
    ],
  ),
  "founder_weekly.previous.client-issues": define(
    "founder_weekly.previous.client-issues",
    "Current high or urgent support issues visible to the founder.",
    "Count(open high/urgent authorized support tickets).",
    ["support_tickets"],
  ),

  "founder_weekly.next.expected-invoices": define(
    "founder_weekly.next.expected-invoices",
    "Invoices currently expected to be issued next week.",
    "Sum(draft/pending/approved invoice totals whose issue date falls in the next local calendar week).",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "founder_weekly.next.expected-collections": define(
    "founder_weekly.next.expected-collections",
    "Open invoice balances due next week.",
    "Sum(open invoice balance minor) where due_date is in the next local calendar week.",
    ["finance_invoices"],
    defaultCurrencyOnly,
    ["Due balances are collection expectations, not guaranteed cash receipts."],
  ),
  "founder_weekly.next.deals-close": define(
    "founder_weekly.next.deals-close",
    "Open CRM opportunities whose expected close date is next week.",
    "Count(open authorized CRM opportunities with expected_close_date in the next local calendar week).",
    ["crm_leads", "crm_pipeline_stages"],
  ),
  "founder_weekly.next.delivery": define(
    "founder_weekly.next.delivery",
    "Visible projects with critical delivery dates next week.",
    "Count(visible active projects with due date in the next local calendar week).",
    ["projects"],
  ),
  "founder_weekly.next.constraints": define(
    "founder_weekly.next.constraints",
    "Current overdue open work that may constrain next-week delivery.",
    "Count(authorized non-terminal project tasks whose due date has already passed).",
    ["project_tasks", "project_task_statuses"],
  ),
  "founder_weekly.next.renewals": define(
    "founder_weekly.next.renewals",
    "Active legal contracts reaching renewal or end date next week.",
    "Count(authorized active contracts with renewal/end date in the next local calendar week).",
    ["legal_contracts"],
  ),
  "founder_weekly.next.decisions": define(
    "founder_weekly.next.decisions",
    "Pending approval requests visible to or assigned to the founder.",
    "Count(pending shared approval requests in the founder's authorized approval scope).",
    ["approval_requests", "approval_request_steps"],
  ),

  "founder_monthly.financial.revenue-last-month": define(
    "founder_monthly.financial.revenue-last-month",
    "Issued net invoice revenue during the last completed local calendar month.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices whose issue date falls in the last completed month.",
    ["finance_invoices"],
    defaultCurrencyOnly,
    ["This is invoiced revenue, not recognized accounting revenue or cash received."],
  ),
  "founder_monthly.financial.cash-last-month": define(
    "founder_monthly.financial.cash-last-month",
    "Incoming payments recorded during the last completed local calendar month.",
    "Sum(finance payment amount minor) where payment_date falls in the last completed month.",
    ["finance_payments"],
    defaultCurrencyOnly,
    ["Recorded payments are not the same as reconciled bank cash."],
  ),
  "founder_monthly.financial.expenses-last-month": define(
    "founder_monthly.financial.expenses-last-month",
    "Authorized non-rejected expenses dated during the last completed local calendar month.",
    "Sum(visible finance expense total minor) for non-rejected expenses in the last completed month.",
    ["finance_expenses"],
    defaultCurrencyOnly,
  ),
  "founder_monthly.financial.contribution-last-month": define(
    "founder_monthly.financial.contribution-last-month",
    "Operational contribution for the last completed month using invoiced revenue and visible recorded expenses.",
    "Last-month issued net invoice revenue - last-month authorized recorded expenses.",
    ["finance_invoices", "finance_expenses"],
    defaultCurrencyOnly,
    ["This is an operating indicator and not general-ledger or statutory profit."],
  ),
  "founder_monthly.financial.revenue-previous-month": define(
    "founder_monthly.financial.revenue-previous-month",
    "Issued net invoice revenue during the calendar month immediately before the last completed month.",
    "Sum(invoice subtotal minor - invoice discount minor) for issued, non-void invoices in the prior comparison month.",
    ["finance_invoices"],
    defaultCurrencyOnly,
  ),
  "founder_monthly.financial.cash-forecast": define(
    "founder_monthly.financial.cash-forecast",
    "Base-scenario forward cash movement over the selected 30, 60, or 90-day horizon.",
    "Permission-filtered expected inflows - expected outflows using the configured base forecast policy and explicit recurring assumptions.",
    [
      "finance_invoices",
      "finance_payments",
      "finance_expenses",
      "procurement_vendor_bills",
      "procurement_purchase_orders",
      "hr_salary_structures",
      "crm_leads",
      "finance_cash_recurring_items",
    ],
    currencySeparated,
    ["This is forward cash movement, not a bank balance or bank reconciliation."],
  ),
  "founder_monthly.delivery.project-contribution-last-month": define(
    "founder_monthly.delivery.project-contribution-last-month",
    "Gross contribution from visible project work in the last completed month.",
    "Project invoiced revenue - labor cost - vendor cost - allocated project expenses for the last completed month.",
    ["projects", "finance_invoices", "project_time_entries", "finance_expenses"],
    defaultCurrencyOnly,
  ),
  "founder_monthly.delivery.project-margin-last-month": define(
    "founder_monthly.delivery.project-margin-last-month",
    "Gross contribution margin for visible project work in the last completed month.",
    "Last-month project gross contribution / last-month project invoiced revenue x 100.",
    ["projects", "finance_invoices", "project_time_entries", "finance_expenses"],
    defaultCurrencyOnly,
  ),

  "client_concentration.revenue": define(
    "client_concentration.revenue",
    "Share of issued net revenue attributable to the largest client and top three clients.",
    "For each currency: client issued net revenue / total issued net revenue in the selected period; top-three share = sum(top 3 client revenue) / total.",
    ["finance_invoices", "crm_companies"],
    currencySeparated,
    [
      "Revenue is grouped by invoice company and uses invoiced net revenue, not recognized revenue.",
    ],
  ),
  "client_concentration.receivables": define(
    "client_concentration.receivables",
    "Share of current open issued receivables attributable to the largest client and top three clients.",
    "For each currency: client open issued invoice balance / total open issued invoice balance; top-three share = sum(top 3 client balances) / total.",
    ["finance_invoices", "crm_companies"],
    currencySeparated,
    [
      "Receivables are current balances and are not limited to the report-period invoice issue date.",
    ],
  ),
  "client_concentration.pipeline": define(
    "client_concentration.pipeline",
    "Share of current probability-weighted open CRM pipeline attributable to the largest named prospect and top three prospects.",
    "For each currency: prospect sum(estimated value x probability / 100) / total weighted open pipeline; top-three share = sum(top 3 prospect values) / total.",
    ["crm_leads", "crm_pipeline_stages"],
    currencySeparated,
    [
      "Open leads do not have a durable client-company foreign key before conversion, so pipeline is grouped by normalized company name where available and otherwise by lead name.",
      "Pipeline is a probability-weighted forecast, not contracted revenue.",
    ],
  ),
};

export function getMetricDefinition(key: string | null | undefined): MetricDefinition | null {
  return key ? (metricDefinitionCatalog[key] ?? null) : null;
}

export function founderMetricDefinitionKey(blockId: string, rowId: string): string | null {
  const key = `${blockId}.${rowId}`;
  return metricDefinitionCatalog[key] ? key : null;
}
