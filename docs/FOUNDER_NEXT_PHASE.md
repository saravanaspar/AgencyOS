# Founder Operations — Next Phase

Last updated: 2026-08-25

This roadmap tracks the founder operating core requested for AgencyOS. Items marked **IMPLEMENTED** are now present in the codebase but still require the normal dependency-backed verification and production acceptance gates; unimplemented items remain deferred until their dependencies or measured operating need are real.

## P1 — Cash and collections depth

### 30 / 60 / 90-day company cash forecast — IMPLEMENTED

AgencyOS now computes a permission-filtered forward cash model independently per ISO currency. It uses open receivables and due dates, optional historical median collection lag, approved expenses, vendor bills, unbilled purchase commitments, current salary structures, explicit recurring/retainer schedules, and probability-weighted CRM pipeline when an organization enables it. Conservative, base, and optimistic scenarios expose 30/60/90-day inflow, outflow, net movement, source provenance, and explicit assumptions. The model deliberately remains a cash-movement forecast rather than a bank-balance view until a trusted bank feed exists.

### Automated collections workflow — IMPLEMENTED

The existing Finance/CRM/Notifications worker path now owns a durable collection case per issued invoice. Organization policy configures pre-due and overdue stages, reminder templates/channels, and founder escalation thresholds. Cases track promise-to-pay, dispute suppression, notes, next action, owner, reminder state, and retry status. Stage changes create CRM follow-up work and owner notifications; client email delivery uses idempotency keys and append-only success/failure evidence, while failed delivery remains retryable instead of being marked complete.

### Client concentration risk — IMPLEMENTED

AgencyOS now reports issued net revenue, open receivables, and probability-weighted open-pipeline concentration for the largest client/prospect and top three. Concentration is calculated independently per ISO currency, links back to the authorized source records, and never sums incompatible currencies.

## P1 — Founder execution layer

### Universal My Work / Founder Inbox — IMPLEMENTED FOR CURRENT ACTION SOURCES

The existing Founder Attention Queue is now an executable work surface rather than a second task database. It aggregates actionable approvals, CRM/collection work, invoices, project tasks, contract renewals, support escalations, vendor bills, and security issues from their canonical records, then overlays only founder-work state: active, snoozed, delegated, or handled. Source snapshots preserve urgency/reason/meta/deep links for delegation; delegated work appears on the assignee's dashboard and sends the normal notification pipeline. Reclaim, one-day/seven-day snooze, delegation, and handled state are persistent and tenant validated.

### KPI drill-down everywhere — IMPLEMENTED FOR CURRENT EXECUTIVE REPORTS

Current Overview, Founder Daily, and Founder Weekly metrics expose source links and reusable metric definitions. Previously unlinked Weekly Review metrics now route to their source workspaces with report periods preserved where the source filter supports them; finance record drill-downs preserve date and currency scope. New executive metrics must provide both a definition key and a source link rather than introducing opaque totals.

### Metric definition catalogue — IMPLEMENTED

Executive metric semantics now live in one reusable catalogue with meaning, formula, source entities, currency rules, and caveats. The catalogue explicitly distinguishes invoiced revenue from recognized revenue, recorded cash from bank cash, operational obligations from paid costs, and probability-weighted pipeline from contracted revenue. The same definitions are rendered in the report UI and included in CSV/PDF report documents.

### Global Create and command palette — IMPLEMENTED

The existing Cmd/Ctrl+K palette now includes permission-filtered high-frequency actions for lead/client/project/task creation, finance documents and payments, expenses, vendors, documents, tickets, contracts, assets, overdue invoices, at-risk projects, and reports. Commands deep-link into the existing authorized create surfaces rather than introducing a second creation framework.

## P2 — Reporting and distribution

### Monthly executive / board pack — IMPLEMENTED

The existing Founder pack/report-snapshot pipeline now includes a versioned `founder_monthly` PDF pack and a first-of-month schedule. It reuses canonical Daily/Weekly, cash-forecast, client-concentration, and project-profitability primitives while adding last-completed-month financial trend/comparison rows. The pack covers executive summary, revenue/cash/expense trend, current receivables, 30/60/90 base cash movement, pipeline/forecast, client concentration, project contribution/margin, delivery and people health, utilization, risks, decisions, and source/evidence links. Recipient authorization still happens before each immutable snapshot is generated.

### Additional report destinations — IMPLEMENTED FOR SLACK / TELEGRAM / WEBHOOK

The existing report batch/recipient worker now supports `slack`, `telegram`, and `webhook` in addition to in-app and email. Each recipient keeps an independently encrypted destination configuration and receives a snapshot generated under that recipient's current permissions; a founder snapshot is never reused for a lower-scope recipient. Telegram and generic webhook delivery send the recipient-specific PDF/CSV bytes. Slack incoming-webhook delivery posts the authenticated AgencyOS snapshot link because incoming webhooks do not provide a file-upload API. Delivery retains existing queueing, grace period, idempotency, retry, suppression, partial-failure evidence, and owner notification behavior. Webhook URLs are HTTPS-only and reject local/private/reserved destinations; secrets are encrypted server-side and never returned to the browser.

## P2 — Notification and approval completeness

Current notification-gap closure is implemented for project-task assignment and scheduled contract/licence reminders by reusing the existing notification queue, preferences, dedupe keys, external-delivery scheduler, and legal reminder records. Asset return, support reply, general task-due, security, approval-request, and approval-decision notifications already use that same pipeline. A future explicit mention feature should emit the existing `mention` category only when structured mention semantics exist; do not infer recipients from free-form names.

Approval binding is now complete for the currently controlled workflows, including salary revisions. Salary changes submit to the existing shared Approval engine with self-approval disabled; the immutable approval snapshot is the proposal, and an approved request is applied to the effective-dated salary structure by a database trigger. Concurrent duplicate effective-date proposals are locked/rejected. Finance, legal contracts, document publication, leave, vendor bills, assets, and other previously bound workflows continue to reuse the same engine rather than domain-specific approval tables.

## P2 — Project and operating depth

### Richer reusable project templates — CORE DEPTH IMPLEMENTED

The existing JSONB project blueprint now captures and replays project labels, task-label assignments, task checklists, inter-task dependencies, and recurring-work rules in addition to phases, milestones, tasks, and relative dates. Existing templates remain backward compatible. Watchers and document sets are deliberately excluded because they carry membership identity and file-access semantics that should not be copied blindly across projects.

### Bank reconciliation integration

Only after a trusted transaction source exists, add bank-feed/reconciliation and replace the Daily Brief's clearly labelled operational cash estimate with reconciled/available bank cash views.

## P3 — People and growth

### Recruitment-lite

Defer until hiring is an active operational pain. Keep it small: requisition, candidate pipeline, interview feedback, offer, conversion to onboarding. Do not build a full ATS without usage evidence.

## P3 — AI and maintainability

### Executive analyst — IMPLEMENTED

The existing AI workspace now has an Executive Analyst mode with a strict read-only MCP allowlist layered on top of organization AI policy and per-tool authorization. It can read the dashboard, reports, canonical metric definitions, CRM, projects, finance, approvals, HR, assets, vendors, support, contracts, and compliance data that the current member is permitted to see. The mode has no mutation tools, free-form SQL, or arbitrary HTTP capability and is instructed to ground KPI explanations in the centralized metric catalogue and source evidence.

### Large-module refactoring

After feature acceptance, split oversized modules such as the MCP tool registry and finance action surface by domain while preserving one stable registry/action boundary. Refactor to reduce regression risk; do not redesign the architecture or introduce microservices solely because files are large.

## Deliberately not planned as near-term work

Do not add a marketplace, public SaaS billing, internal chat replacement, arbitrary automation DSL, separate data warehouse/BI platform, Kafka, microservices, or fleets of autonomous agents unless measured operating requirements demand them.
