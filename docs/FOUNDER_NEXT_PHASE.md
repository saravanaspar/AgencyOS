# Founder Operations — Next Phase

Last updated: 2026-08-24

This release deliberately prioritizes the founder operating core requested for AgencyOS: trustworthy report delivery, CRM forecasting/conversion, project commercial truth/closure, founder attention, Daily Brief, and Weekly Review. The items below are intentionally deferred until that foundation has completed normal dependency-backed verification and production acceptance.

## P1 — Cash and collections depth

### 30 / 60 / 90-day company cash forecast

Build a true forward cash model rather than extending the current operational cash estimate.

Inputs should include:

- open invoice balances and due dates;
- recurring/retainer invoice expectations;
- historical collection behavior;
- approved expenses and scheduled reimbursements;
- vendor bills / purchase commitments;
- payroll and recurring obligations;
- probability-weighted CRM pipeline where explicitly enabled.

Outputs should include base, conservative, and optimistic scenarios with assumption provenance. Bank balance/reconciliation must stay separate from the current recorded-cash estimate until a bank-feed/reconciliation source exists.

### Automated collections workflow

Add configurable stages such as pre-due, due today, 7/14/30 days overdue, with:

- reminder templates and channel policy;
- account-owner tasks;
- promise-to-pay tracking;
- dispute suppression;
- collection notes and next action;
- founder escalation thresholds;
- idempotent delivery evidence and retry status.

### Client concentration risk — IMPLEMENTED

AgencyOS now reports issued net revenue, open receivables, and probability-weighted open-pipeline concentration for the largest client/prospect and top three. Concentration is calculated independently per ISO currency, links back to the authorized source records, and never sums incompatible currencies.

## P1 — Founder execution layer

### Universal My Work / Founder Inbox

Unify actionable records across tasks, approvals, CRM follow-ups, collections, contract renewals, support escalation, invoices, HR, vendors, and security alerts. Each item should expose urgency, due date, money at risk, source record, recommended action, deep link, snooze, delegate, and handled state.

The Founder Attention Queue added in the current release is the exception summary; this future feature becomes a normalized executable work queue.

### KPI drill-down everywhere — IMPLEMENTED FOR CURRENT EXECUTIVE REPORTS

Current Overview, Founder Daily, and Founder Weekly metrics expose source links and reusable metric definitions. Previously unlinked Weekly Review metrics now route to their source workspaces with report periods preserved where the source filter supports them; finance record drill-downs preserve date and currency scope. New executive metrics must provide both a definition key and a source link rather than introducing opaque totals.

### Metric definition catalogue — IMPLEMENTED

Executive metric semantics now live in one reusable catalogue with meaning, formula, source entities, currency rules, and caveats. The catalogue explicitly distinguishes invoiced revenue from recognized revenue, recorded cash from bank cash, operational obligations from paid costs, and probability-weighted pipeline from contracted revenue. The same definitions are rendered in the report UI and included in CSV/PDF report documents.

### Global Create and command palette

Add a keyboard-first command surface for high-frequency actions such as create lead/client/project/task/invoice/expense/vendor/document/ticket, record payment, open overdue invoices, view projects at risk, generate reports, and jump to records.

## P2 — Reporting and distribution

### Monthly executive / board pack

Generate a versioned PDF pack with executive summary, financial trend, cash/receivables, pipeline/forecast, client concentration, project profitability, delivery health, utilization, risks, decisions, and source/evidence links.

### Additional report destinations

The current release implements in-app and email report delivery with recipient-specific authorization, queued send, undo grace, retries, and partial-failure reporting. Later destinations can reuse the same batch/recipient model:

- Slack;
- Telegram;
- webhook;
- other explicitly authorized communication channels.

Each destination must preserve per-recipient authorization and idempotency. Do not reuse a founder-generated snapshot for a lower-scope recipient.

## P2 — Notification and approval completeness

Finish remaining domain notifications such as assignment, mention, general task due, leave status, contract/licence expiry, asset return, support reply, and security alerts where a domain does not already emit them.

Finish explicit approval bindings and threshold policies for all controlled domains that need them, especially estimates, invoices, credit notes, contracts, document publication, leave, expenses, and salary changes. Reuse the shared approval engine; do not create domain-specific parallel approval systems.

## P2 — Project and operating depth

### Richer reusable project templates

The current release supports reusable project structure and duplication. Later template depth can include labels, checklists, dependencies, watchers, recurring-work rules, document sets, and richer relative-date policies when real reuse cases justify them.

### Bank reconciliation integration

Only after a trusted transaction source exists, add bank-feed/reconciliation and replace the Daily Brief's clearly labelled operational cash estimate with reconciled/available bank cash views.

## P3 — People and growth

### Recruitment-lite

Defer until hiring is an active operational pain. Keep it small: requisition, candidate pipeline, interview feedback, offer, conversion to onboarding. Do not build a full ATS without usage evidence.

## P3 — AI and maintainability

### Executive analyst

Build a permission-filtered read/analysis capability that can answer questions such as “why did margin decline?” or “which clients create the most collection risk?” from the same report/forecast/profitability primitives. Avoid free-form SQL, arbitrary HTTP, or unrestricted mutation tools.

### Large-module refactoring

After feature acceptance, split oversized modules such as the MCP tool registry and finance action surface by domain while preserving one stable registry/action boundary. Refactor to reduce regression risk; do not redesign the architecture or introduce microservices solely because files are large.

## Deliberately not planned as near-term work

Do not add a marketplace, public SaaS billing, internal chat replacement, arbitrary automation DSL, separate data warehouse/BI platform, Kafka, microservices, or fleets of autonomous agents unless measured operating requirements demand them.
