# AgencyOS ordered delivery checklist

> **Current infrastructure:** authentication is AgencyOS-owned and PostgreSQL-provider neutral.
> Runtime files use one provider-neutral S3-compatible object-storage contract for self-hosted or
> hosted services. Older provider-specific checklist wording below is retained only where it records
> historical implementation evidence.

Last updated: 2026-07-21

## Product scope and non-negotiable rules

- [x] Build AgencyOS for one company and its staff, not as a commercial SaaS product.
- [x] Keep `organization_id` boundaries for security, testing, and future internal separation.
- [x] Exclude subscriptions, public tenant provisioning, billing plans, marketplace features, and SaaS growth tooling.
- [x] Security first: server authorization, RLS, tenant checks, encrypted secrets, bounded inputs, audit history, and safe failure messages.
- [x] Anti-duplicate always: every new record flow must define uniqueness, matching, merge/skip behavior, and idempotency before release.
- [x] Simplicity and accessibility second: readable labels, keyboard access, responsive forms, visible focus, clear errors, and minimum-step workflows.
- [x] Easy work flow and easy access: related records should be linked, common actions should be near the work, and navigation/search/MCP must obey the same permissions.
- [x] Reuse existing modules before adding new abstractions; do not create parallel implementations for the same business concept.
- [x] Every AI-capable operation must use the central MCP registry and must re-authorize from the active server session.
- [x] Secrets, raw connector credentials, uploaded files, and private payloads must never be accepted through MCP tool arguments.
- [x] Keep `TEST.md` current: every delivered feature must include credential requirements, automated checks, human manual steps, browser-MCP steps, negative/security tests, and chat test instructions.

## Status legend

- `[x]` implemented and included in the current codebase.
- `[ ]` not complete; implement in the ordered stage shown below.
- A database column/table alone does not make a user-facing capability complete.

## Exact execution order from here

1. [x] Platform foundation: authentication, access, roles, permissions, structure, organization defaults, and audit.
2. [x] CRM foundation: companies, contacts, leads, pipeline, activities, conversion, scopes, RLS, tests, and MCP tools.
3. [x] CRM source intake: CSV/XLSX, Meta Lead Ads, Google Ads, HubSpot, Salesforce, Zoho CRM, and Pipedrive.
4. [x] Projects foundation: projects, members, CRM-company links, tasks, Kanban, comments, time, progress, health, RLS, and MCP tools.
5. [x] Finish projects: attachments, labels, watchers, checklists, subtasks, dependencies, recurring work, list/calendar/timeline views, milestones, phases, workload, closure, archive/restore, and project reports.
6. [x] Finish shared platform services needed by later modules: notifications, approval engine, private file storage, malware scanning, Redis, internal automation execution, Vaultwarden links, and global error handling.
7. [x] Finance and invoicing.
8. [x] HR and employee self-service.
9. [x] Documents and legal.
10. [x] Support, assets, vendors, and procurement.
11. [x] Unified calendar, global search, reports, and management dashboards.
12. [x] Automation and permission-aware AI.
13. [ ] Final hardening, restore drills, rate limits, incident response, and full cross-module test suites.

## Delivered feature ledger

### Feature 1 — Authentication and controlled access — COMPLETE

- [x] Email/password sign-in, sign-out, signup confirmation, password recovery, and reset.
- [x] SSR cookie sessions, protected workspace routes, and safe return URLs.
- [x] Pending-access state with zero organization permissions before approval.
- [x] Owner/admin approval, initial role assignment, role changes, suspension, reactivation, and deactivation.
- [x] Last-active-owner and self-suspension safeguards.
- [x] Server-side authorization and audit events for access operations.

### Feature 2 — Audit log — COMPLETE

- [x] Permission-protected audit page with search, filters, date range, pagination, details, and CSV export.
- [x] Export permission checks, formula-injection protection, bounded output, and export audit event.

### Feature 3 — Module authorization — COMPLETE

- [x] Module view permissions, default role grants, route guards, permission-filtered sidebar, and command palette.
- [x] Effective-permissions viewer with sources, scopes, sensitive grants, and active overrides.
- [x] Unit and pgTAP coverage for module access and cross-organization isolation.

### Feature 4 — Organization profile — COMPLETE

- [x] Legal/display name, country, timezone, currency, and financial-year defaults.
- [x] Separate read/update permissions, immutable slug, validation, optimistic concurrency, and exact audit diff.
- [x] Canonical timezone offset labels and country-aware currency/timezone suggestions.

### Feature 5 — Departments, teams, and reporting lines — COMPLETE

- [x] Department/team create, update, status, assignment, lead designation, and permanent deletion safeguards.
- [x] Department assignment, manager assignment, self-management prevention, and reporting-cycle prevention.
- [x] Tenant triggers, RLS, scoped read-only views, audit events, unit tests, and pgTAP tests.

### Feature 6 — Custom roles and member overrides — COMPLETE

- [x] Custom role create/update/status/delete and full permission replacement.
- [x] Scoped grants plus explicit member allow/deny overrides with reason and optional expiry.
- [x] Last-access-administrator safeguards, system-role integrity, audit events, and tests.

### Feature 7 — Roles/settings UI correction — COMPLETE

- [x] Permission accordion rows use intrinsic height so labels and descriptions are not clipped.
- [x] Permission search, human-readable labels, scope guidance, and responsive override form alignment.
- [x] Settings/structure form alignment and constrained-width overlap fixes.

### Feature 8 — Permission-scoped MCP layer — COMPLETE

- [x] Central registry, strict schemas, tool annotations, filtered `tools/list`, and re-authorized `tools/call`.
- [x] Same-origin JSON-RPC endpoint with bounded bodies and session-derived identity.
- [x] Organization, access, audit, role, permission, structure, CRM, CRM-sync, and project tools.
- [x] External MCP exposure deferred until proper OAuth resource-server authorization exists.

### Feature 9 — CRM foundation — COMPLETE

- [x] Tenant-isolated companies, contacts, leads, stages, activities, qualification, ownership, conversion, filters, and pagination.
- [x] Organization/team/department/managed/assigned/creator scopes plus explicit override handling.
- [x] Duplicate checks, RLS, tenant triggers, audit events, unit tests, pgTAP tests, and MCP tools.
- [x] Lead attachments, Company primary-contact selection, and permission-filtered relationships to Projects, Invoices, Legal contracts, Support tickets, and Documents.

### Feature 10 — CRM import and source connections — COMPLETE

- [x] CSV and XLSX import with header aliases, normalization, 5 MB limit, and 5,000-row limit.
- [x] Mandatory skip-or-merge duplicate policy; no unchecked create mode.
- [x] Per-row savepoints so one invalid row does not abort the entire import transaction.
- [x] Import history, redacted row errors, stable payload hashes, external-record idempotency, and webhook-delivery idempotency.
- [x] Meta Lead Ads signed webhook and one-time verification token.
- [x] Google Ads lead-form webhook key validation.
- [x] Client-managed HubSpot/Pipedrive API-token connections and client-owned OAuth-app connections for HubSpot, Salesforce, Zoho CRM, and Pipedrive.
- [x] AES-256-GCM credential envelopes using a server-only 32-byte environment key.
- [x] Allowlisted Salesforce, Zoho, and Pipedrive hosts; request timeouts; streaming response limits; no-store responses; and generic public errors.
- [x] UI-only OAuth/credential creation, rotation, and file upload; safe sync/status/schedule/health/delete MCP tools only.
- [x] Human and browser-MCP verification steps, credential requirements, webhook commands, duplicate tests, and secret-redaction checks documented in `TEST.md`.
- [x] Add cursor pagination and incremental checkpoints for external CRM pulls.
- [x] Add scheduled sync jobs with backoff, rate-limit handling, and operator notifications.
- [x] Add provider-specific OAuth authorization-code flows for client-owned apps while limiting direct API-token entry to HubSpot private apps and Pipedrive account tokens.
- [x] Add connection health checks, client API-token replacement, OAuth reconnect, and webhook credential rotation workflows.

### Feature 11 — Projects and tasks foundation — COMPLETE

- [x] Tenant-isolated project records, unique project codes, CRM-company links, internal projects, status, priority, owner, members, and visibility.
- [x] Mandatory exact-name duplicate prevention for active projects in the same client/type context.
- [x] Task creation, unique task numbers, default workflow, priority, one initial assignee, dates, effort estimate, comments, and time entries.
- [x] Mandatory exact-title duplicate prevention for open tasks in the same project.
- [x] Kanban movement, terminal-state handling, incomplete-subtask guard foundation, progress, health, and time summaries.
- [x] Scoped visibility, RLS, tenant validation, audit events, unit tests, pgTAP tests, and MCP tools.
- [x] Human and browser-MCP verification steps for project creation, duplicates, members, tasks, Kanban, comments, time, scopes, and MCP documented in `TEST.md`.
- [x] Complete all remaining project capabilities in Stage 2 before starting Finance.

### Feature 12 — Projects planning, collaboration, reporting, and lifecycle — COMPLETE

- [x] Native create-project dialog with explicit close, Cancel, Escape, backdrop dismissal, focus management, and automatic selection of the newly created project.
- [x] Multiple assignees, labels, watchers, required/optional checklists, subtasks, parent-child links, dependency relationships, and recurring tasks.
- [x] Project phases, milestones, list, calendar, timeline, workload, and project reports.
- [x] Private task attachments with bounded type/size validation, duplicate-content prevention, tenant checks, and permission-protected download/delete operations.
- [x] Required closure checklist, request/final-close workflow, server/database read-only enforcement, archive filtering, archive, and restore.
- [x] Human, browser, negative, permission, attachment, closure, archive, responsive-dialog, and latency checks documented in `TEST.md`.

### Feature 13 — Shared platform services — COMPLETE

- [x] Safe root-level global error boundary with a generic retry path and no stack, query, or credential disclosure.
- [x] Shared in-app notification center with recipient-scoped live updates, real unread count, mark-read actions, internal deep links, category preferences, delivery history, retry-state storage, CRM integration-failure alerts, and recipient-safe MCP tools.
- [x] Email and optional browser-push notification delivery workers.
- [x] Shared approval engine.
- [x] Shared private-file lifecycle and malware-scanning service using local MinIO as the sole runtime object store.
- [x] Redis-backed coordination and caching.
- [x] Internal automation execution history and Vaultwarden item links.

### Feature 14 — Finance foundation — COMPLETE

- [x] Permission-scoped `/finance` workspace with responsive catalogue, estimate, invoice, payment, and receivables views.
- [x] Tenant-isolated catalogue, estimates, invoice drafts, issued invoice snapshots, payments, allocations, event history, RLS, and audit events.
- [x] Integer minor-unit calculations shared by server actions and database line triggers.
- [x] Transactional estimate and issued-invoice numbering with duplicate-safe open-document hashes.
- [x] Approval, issue, void, payment, and reconciliation actions with exact server authorization.
- [x] Permission-filtered finance MCP tools that exclude files, secrets, and connector credentials.
- [x] Unit, source-contract, migration-contract, and pgTAP coverage plus manual/browser-MCP instructions in `TEST.md`.
- [x] Immutable estimate/invoice PDF snapshots, permission-gated downloads, idempotent email delivery, estimate acceptance/conversion, and version/payment history.
- [x] Credit notes and revised-invoice corrections with original-invoice lineage, approval, transactional numbering, immutable PDFs, delivery history, application, and reversal.
- [x] Invoice attachments, viewed/overdue/disputed evidence, exchange-rate snapshots, payment receipts/refunds, reusable finance email templates, and the synchronized internal overdue worker.
- [x] Employee, project, and vendor expenses with categories, minor-unit tax, private receipts, billable/reimbursable state, approvals, settlement state, and enforced project allocations.
- [x] Complete financial reports and client statements, including bounded CSV export, before marking Stage 7 complete.

### Feature 15 — HR employee records foundation — COMPLETE

- [x] Dedicated permission-gated `/hr` workspace replacing the generic module placeholder.
- [x] Organization designation catalogue with duplicate-safe names/codes, active/inactive lifecycle, RLS, and tenant validation.
- [x] Core employee profiles linked one-to-one with existing memberships instead of duplicating users, departments, or reporting lines; salary and scanner-gated supporting files remain isolated in dedicated restricted records while banking, medical, and disciplinary data remain out of scope.
- [x] Employee ID, legal/preferred name, work and personal contact details, date of birth, nationality, joining date, employment type, designation, department, manager, work location/mode, lifecycle status, and weekly hours.
- [x] Own-scope employee self-service limited to preferred name and personal contact details through a separate server action.
- [x] Organization-scope HR Manager access and managed-employee Team Lead visibility using the existing permission-scope helper.
- [x] Append-only audit evidence for employee creation, HR updates, and employee self-service updates.
- [x] Read-only MCP People workspace tool returning directory-safe fields only; personal email, phone, date of birth, files, and sensitive HR fields remain excluded.
- [x] Unit, source-contract, migration-contract, pgTAP, responsive UI, accessibility, permission, duplicate, and cross-organization test instructions in `TEST.md`.

### Feature 16 — HR attendance and correction approvals — COMPLETE

- [x] Organization-timezone-aware employee check-in and check-out with one attendance record per employee and date.
- [x] Permission-scoped manual attendance for Owner, HR Manager, and managed employees under Team Lead scope.
- [x] Present, work-from-home, half-day, and absent states plus late, early-departure, overtime, and bounded attendance notes.
- [x] Employee attendance-correction requests limited to own records and routed through the shared approval engine to the assigned manager.
- [x] Atomic database synchronization from terminal approval outcomes to correction status, attendance revision, reviewer evidence, and audit events.
- [x] Current-month attendance history and summary totals for worked time, late time, early departure, overtime, work-from-home, half-day, and absence.
- [x] RLS, tenant validation, duplicate pending-correction prevention, timezone-safe local time conversion, and directory-safe aggregate MCP output.
- [x] Unit, source-contract, migration-contract, pgTAP, responsive UI, permission, approval, duplicate, and cross-organization test instructions in `TEST.md`.

### Feature 17 — HR leave management — COMPLETE

- [x] Organization leave policies with paid/unpaid status, balance requirements, monthly/annual accrual, bounded carry-forward, evidence thresholds, and optional HR review.
- [x] Employee balances, append-only adjustments, atomic reservation/usage/restoration, and audited accrual refreshes.
- [x] Draft, evidence, submission, manager/HR approval, rejection, revision, expiry, cancellation, overlap prevention, and team-conflict warnings.
- [x] Scanner-gated private evidence using the shared MinIO/private-file lifecycle and shared approval policies.
- [x] Employee, Team Lead managed-employee, HR Manager, and Owner scopes with RLS and aggregate-only MCP output.
- [x] Unit, source-contract, migration-contract, pgTAP, responsive UI, permission, approval, balance, attachment, cancellation, and cross-organization instructions in `TEST.md`.

### Feature 18 — HR salary structures and private salary slips — COMPLETE

- [x] Immutable effective-dated salary revisions with integer minor-unit base salary, reusable allowance/deduction components, currency, notes, and complete revision history.
- [x] Generated salary slips snapshot the covering salary structure and support period bonus, reimbursement, and additional deductions without mutating salary history.
- [x] Existing PDF salary slips can be uploaded with bounded metadata and the same private-file, malware-scanning, integrity, and MinIO lifecycle.
- [x] Salary-slip versions, employee acknowledgement, integrity-checked download, private-file events, and dedicated audit events.
- [x] Salary access is absent from Team Lead defaults; Employee access is own-scope, Owner/HR Manager access is organization-scope, and Auditor access is explicit and read-only.
- [x] Salary amounts remain in RLS-restricted salary tables and private PDFs, not in audit-event payloads, MCP output, browser logs, or general employee records.
- [x] The finance HTML-to-PDF browser engine is extracted into one shared renderer rather than duplicating Chromium/Puppeteer logic.
- [x] Redis database-safe fallback warnings preserve the concrete Redis error class and distinguish operation failures from total service unavailability.
- [x] Unit, real PDF, source-contract, migration-contract, pgTAP, permission, audit, acknowledgement, upload, download, responsive UI, and Redis logging instructions are documented in `TEST.md`.

### Feature 19 — Swappable private HR legal-document templates — COMPLETE

- [x] Built-in starter templates and immutable private MinIO HTML template versions share one sanitized compilation and Chromium PDF path.
- [x] Per-document-type defaults can switch between built-in and active MinIO versions without changing access, storage, or previously generated documents.
- [x] Offer, appointment, employment agreement, NDA, experience, relieving, promotion, salary-revision, warning, and performance letters use the same template catalogue.
- [x] Generated PDFs retain immutable template source, version, and SHA-256 provenance and reuse scanner-gated private files, acknowledgement, download auditing, and RLS.

### Feature 20 — Private employee supporting documents — COMPLETE

- [x] Identification, education, certificate, visa/work-permit, background-check, and exit-document uploads reuse the shared quarantine, malware scanning, MinIO, integrity, and private-file event pipeline.
- [x] Employees can upload and view only permitted own-scope records; background checks and exit records remain HR-upload-only, and Team Leads receive no default access.
- [x] HR can review records, control employee visibility, replace a reference with immutable version history, and monitor issue/expiry dates.
- [x] Searchable metadata stores at most the final four identifier characters; complete government, passport, visa, and licence numbers remain only inside restricted files.
- [x] Downloads are scope checked, integrity verified, no-store, and audited; supporting-document contents remain excluded from MCP.

### Feature 21 — Employee onboarding workflow — COMPLETE

- [x] One active tenant-isolated onboarding plan per employee seeds the standard offer, document, account, structure, equipment, email, policy, NDA, training, first-day, and probation checklist while completed or cancelled rehire cycles remain historical.
- [x] Existing memberships, work email, department, manager, meeting schedule, and probation schedule remain source records and complete derived checklist items without copying their data; offer acceptance is an explicit employee action and NDA completion remains HR-confirmed evidence.
- [x] Owner and HR Manager can create, schedule, assign, block, complete, exempt, refresh, and cancel plans; Team Leads receive managed-employee read scope and Employees receive own-scope visibility plus explicit offer acceptance and policy acknowledgement only.
- [x] Checklist progress centrally derives draft, in-progress, ready, completed, and cancelled plan states; database triggers constrain direct employee writes and enforce tenant-safe assignments.
- [x] Deduplicated assignment notifications, append-only audit events, accessible responsive UI, unit coverage, source contracts, migration contracts, pgTAP coverage, and operator instructions are included.

### Feature 22 — Employee offboarding workflow — COMPLETE

- [x] Resignation, termination, contract-end, retirement, redundancy, and other separation records preserve immutable historical cycles while allowing only one active plan per employee.
- [x] Last working date, exit interview, knowledge transfer, asset return, vault removal, and final-clearance checklist work is permission-scoped, assignable, auditable, and tenant isolated.
- [x] Active project membership, project ownership, and open task assignments can be transferred atomically to an active replacement employee using existing project tables rather than copied HR records.
- [x] Open tasks, unsettled employee expenses, membership suspension, experience/relieving letters, and employee archival are derived from their source systems and cannot be manually falsified through client table writes.
- [x] Account suspension and final deactivation reuse the Settings owner-continuity guard; final clearance cannot complete before the last working date or while required checklist items remain open.
- [x] Final clearance deactivates organization access, archives the employee profile, retains all historical plans and evidence, and restores the prior lifecycle status when an active plan is cancelled.
- [x] Employees can submit an own-scope resignation and view their plan; Team Leads receive managed-employee read scope, while Owner and HR Manager retain organization-wide management.
- [x] Deduplicated notifications, append-only audit events, aggregate-only MCP output, responsive UI, unit coverage, source contracts, migration contracts, pgTAP coverage, and operator instructions are included.

### Feature 23 — Private documents module foundation — COMPLETE

- [x] Dedicated `/documents` workspace with tenant-isolated folder hierarchy, categories, tags, search, active/archive filters, review/expiry indicators, retention state, and responsive accessible controls.
- [x] Scanner-gated PDF, JPEG, PNG, TXT, CSV, DOCX, and XLSX uploads reuse the shared quarantine, malware scanning, MinIO, private-file events, integrity verification, and bounded-download infrastructure.
- [x] Immutable document versions preserve uploader, timestamp, original filename, MIME type, size, SHA-256 checksum, and superseded history while the document points to one current version.
- [x] Permission-scope-aware ownership and access use `own`, team, department, managed-employee, assigned, and organization boundaries; confidential/restricted records require ownership or explicit grants, and authenticated RLS uses only the current membership.
- [x] Explicit viewer, commenter, and editor grants support expiry; comments and access/download/preview/version events remain append-only and legal-hold reasons plus event details are excluded from ordinary authenticated column grants.
- [x] Documents link only to CRM, Projects, Finance, or HR records the current user may already view, preventing the document library from becoming a cross-module enumeration path.
- [x] Client, contact, lead, project, task, invoice, estimate, and employee links are tenant validated; metadata-only MCP search exposes no file contents, access lists, comments, hold reasons, or event details.
- [x] Unit, source-contract, migration-contract, pgTAP, permission-scope, direct-RLS, scanner, integrity, preview/download, versioning, legal-hold, archive, responsive UI, and MCP test instructions are documented in `TEST.md`.

### Feature 24 — Legal contract lifecycle foundation — COMPLETE

- [x] Dedicated `/legal` workspace for scoped contract requests, commercial/legal metadata, templates, immutable versions, approvals, signatures, lifecycle dates, and history.
- [x] Contract templates reference clean immutable Documents versions; selecting a template registers the initial draft source without creating a parallel file store or renderer.
- [x] Sequential Legal Manager, optional Finance Manager, and optional Owner review reuse the shared approval engine, and approval outcomes update the contract atomically.
- [x] Counterparty, final, and signed copies reuse Documents and private-file scanning; every attachment is integrity-preserving, versioned, linked back to the contract, and never overwritten.
- [x] Activation requires approval, a signed signature state, and an immutable signed version; termination, expiry, cancellation, and awaiting-signature transitions create append-only lifecycle events.
- [x] Renewal, notice, and expiry reminders are persisted from contract dates; metadata-only MCP search excludes file contents, review comments, termination reasons, and private event details.
- [x] Legal permissions, role defaults, scope-aware RLS, tenant triggers, safe authenticated column grants, unit tests, source contracts, pgTAP coverage, responsive UI, and operator instructions are included.
- [x] Final hardening applies permission scope to owner/company pickers and every mutation, restricts ordinary authenticated event reads to non-sensitive columns, locks template selection after version history begins, and separates pre-review drafts from post-approval signed-copy attachment.

### Feature 25 — Document approval and controlled publishing — COMPLETE

- [x] Document review requests pin the current clean immutable version to the shared approval engine and retain every approved, rejected, revision-requested, cancelled, expired, or invalidated outcome.
- [x] A default Owner review policy is created lazily through the existing approval-definition service and remains customizable in the Approvals workspace.
- [x] Pending review blocks replacement uploads before object storage and through a database trigger, preventing orphaned files and concurrent version drift.
- [x] Approved current versions publish to organization, department, team, or named-member audiences with effective and optional expiry times.
- [x] Publication changes create immutable numbered releases; a new release supersedes the prior release, and withdrawals retain actor, time, and bounded reason evidence.
- [x] Published audiences broaden only view/download access inside the existing scope-aware document authorization helper; edit, review, publish, withdrawal, hold, archive, and access-management boundaries remain unchanged.
- [x] RLS, safe authenticated column grants, append-only history, audit events, responsive controls, unit tests, source contracts, pgTAP coverage, and operator instructions are included.

### Feature 26 — Legal compliance-record catalogue — COMPLETE

- [x] Privacy documents, corporate registrations, GST and PAN records, licences, insurance policies, intellectual-property records, compliance certificates, board resolutions, legal notices, and dispute records share one scoped legal-record catalogue.
- [x] Every record pins a clean immutable Documents version and reuses Documents preview/download, scanning, checksums, retention, legal holds, access controls, and version history instead of creating a second file store.
- [x] Internal references, responsible owners, departments, authorities, jurisdictions, final-four identifier suffixes, issue/effective/expiry/renewal/review/response dates, confidentiality, and lifecycle status are tenant validated.
- [x] Legally privileged records require both the privileged-record permission and a Restricted linked document; auditors retain non-privileged read-only visibility only.
- [x] Expiry, renewal, review, and response reminder rows synchronize from active record dates, while close, archive, and restore actions preserve append-only history and private closure evidence.
- [x] Owner assignment reuses the contract scope validator; notifications, audit events, RLS, safe authenticated column grants, responsive UI, unit tests, source contracts, pgTAP coverage, and metadata-only MCP search are included.

### Feature 27 — Controlled legal deletion — COMPLETE

- [x] Owner and Legal Manager receive explicit scoped request, execution, policy, and history permissions; Auditors receive read-only deletion history only.
- [x] Contract deletion is limited to terminated, expired, or cancelled agreements, while compliance-record deletion is limited to closed or archived records.
- [x] Execution rechecks Documents legal holds, retention dates, active publication, pending review, template use, entity sharing, cross-record reuse, and private-file availability.
- [x] Organization policy can require a second authorized Owner through the shared approval engine with self-approval disabled; approved requests remain revalidated before execution.
- [x] Private files reuse the existing tombstone and MinIO purge services, support retry after partial object-removal failure or a stale execution worker, and retain immutable checksums plus a final audit digest.
- [x] Completed targets become inaccessible tombstones, linked document metadata is minimized, reminders are cancelled, and permanent request/object/event plus central audit evidence remains.
- [x] RLS, safe authenticated column grants, tenant validation, immutable history, responsive UI, unit tests, source contracts, pgTAP coverage, and operator instructions are included.

### Feature 28 — Support ticket foundation — COMPLETE

- [x] Sequential organization-scoped ticket numbers, client/contact/project links, categories, priority, status, assignment, teams, watchers, due dates, SLA timestamps, resolution, satisfaction, and immutable activity history.
- [x] Public replies and internal notes remain separate; internal notes require a sensitive permission and are excluded from ordinary requesters and MCP output.
- [x] Waiting-for-customer pauses SLA clocks, first agent response is recorded once, and resolve, close, reopen, and satisfaction actions preserve append-only history.
- [x] Ticket attachments reuse Documents entity links, scanner-gated private versions, access checks, and integrity-verified previews/downloads instead of adding another upload system.
- [x] CRM companies/contacts and Projects remain permission-scoped sources; assignment notifications reuse the shared notification service.
- [x] Owner, Support Manager, Support Agent, requester, watcher, team, and Auditor access is enforced through permission scopes and RLS.
- [x] Read-only MCP search returns ticket metadata and counts only; message bodies, internal notes, watcher identities, satisfaction comments, and event details remain excluded.

### Feature 29 — Asset management foundation — COMPLETE

- [x] Organization-scoped asset register with seeded categories, duplicate-safe asset tags and serial numbers, ownership, responsible owner, location, purchase, warranty, condition, and depreciation metadata.
- [x] Ordered, Received, Available, Assigned, Under Repair, Lost, Stolen, Retired, and Disposed lifecycle states are enforced through explicit register, assignment, return, maintenance, incident, and disposal actions.
- [x] Employee assignment records preserve checkout time, expected return, checkout condition, acknowledgement, returned time, returned condition, notes, assigning actor, and returning actor.
- [x] Condition inspections, damage/missing incidents, maintenance, disposal, and lifecycle events preserve append-only history; all mutations create central audit records.
- [x] Asset assignment and return notifications reuse the shared notification system, while Documents links reuse scanner-gated private files, permission checks, checksums, previews, downloads, and existing retention controls.
- [x] Owner, System Administrator, Operations Administrator, HR Manager, Team Lead, employee, and Auditor access is enforced through permission scopes, tenant validation, safe grants, and RLS.
- [x] Read-only MCP search returns asset and custody metadata plus aggregate counts only; notes, maintenance details/outcomes, disposal reasons, document contents, and audit history remain excluded.
- [x] The archive's missing salary-slip download route is restored using existing HR authorization, malware-scan state, MinIO size/hash integrity, private-file event, and audit patterns.
- [x] Employees can create organization-scoped Asset requests, submit exact snapshots through the shared Approval engine, receive manager and Operations decisions, and Operations can fulfill approved requests with an available Asset from the requested category.
- [x] Assets can link to active Vendor records with tenant validation and scoped Vendor options.

### Feature 30 — Vendor and procurement foundation — COMPLETE

- [x] Organization-scoped Vendor register with sequential Vendor numbers, legal/display names, categories, status, risk, owner, contacts, addresses, payment terms, review dates, and duplicate-safe tenant boundaries.
- [x] Sensitive tax and bank metadata is isolated behind a dedicated permission and RLS policy; MCP output excludes identifiers, banking fields, payment instructions, note bodies, and document contents.
- [x] Vendor contracts reuse Legal records, Vendor and Purchase-order attachments reuse Documents entity links and scanner-gated private files, and Assets can link to active Vendors.
- [x] Purchase requests preserve requested items, business justification, department/project allocation, budget, required date, and requester ownership, then reuse the shared approval engine with manager, Finance, and Operations stages where available.
- [x] Approved requests support multiple Vendor quotations, exact totals, lead time, validity, source documents, Vendor selection, and one transactionally numbered Purchase order.
- [x] Purchase orders preserve line items, contract and quotation lineage, delivery metadata, partial/complete/rejected receipts, outstanding quantities, Vendor bills, exact PO-to-bill matching, and payment state.
- [x] Vendor notes, Vendor events, and Procurement events are append-only; all mutations are tenant validated, permission scoped, RLS protected, safely granted, and centrally audited.
- [x] Owner, Operations Administrator, Finance Manager, Accountant, Project Manager, Team Lead, Employee, Legal Manager, System Administrator, and Auditor boundaries are represented without broadening sensitive access.
- [x] Read-only MCP search returns Vendor, request, order, receipt-count, bill-count, and linked-record metadata only; sensitive financial metadata, narrative notes, document contents, and audit detail remain excluded.
- [x] Purchase-order matched Vendor bills use the shared Approval engine with self-approval disabled; payment actions cannot bypass approval and preserve immutable Procurement and central audit evidence.

### Feature 31 — Unified calendar and global search foundation — COMPLETE

- [x] Dedicated `/calendar` workspace provides month, week, day, and agenda views with personal, team, department, project, company, event-type, and project filters.
- [x] Agency-created meetings, holidays, interviews, licence expirations, probation reviews, and other events support explicit scope, public/private visibility, attendees, locations, HTTPS meeting links, all-day timing, bounded recurrence, cancellation, and immutable lifecycle history.
- [x] Permission-aware calendar projections reuse source records for Project and Task deadlines, milestones, Invoice due dates, Contract renewals, approved leave, probation reviews, Asset warranty/return dates, Purchase-request required dates, and Purchase-order delivery dates without copying source data into calendar storage.
- [x] Private events remain visible only to their owner and attendees; project, managed-member, department, team, and organization scopes reuse existing record-visibility helpers before display or management.
- [x] Event creation, attendee insertion, cancellation, audit evidence, notifications, tenant validation, safe grants, RLS, append-only history, and management-scope checks are implemented server-side.
- [x] Global metadata search is available from the command palette, `/search`, and a private no-store API with bounded queries and permission-filtered results across delivered CRM, Projects, HR, Support, Documents, Legal, Assets, Vendors, Procurement, Calendar, Estimates, and Invoices records.
- [x] Search results expose identifiers, titles, statuses, owners, dates, and safe related-record metadata only; salary, personal HR fields, tax/bank data, note bodies, ticket descriptions, restricted document/legal contents, audit detail, and unauthorized record existence remain excluded.
- [x] Responsive UI, strict schemas, unit tests, source contracts, pgTAP coverage, database validation, and production-build coverage are included.
- [x] Reports and management dashboards are completed in Feature 32, closing ordered Stage 11.

### Feature 32 — Reports and management dashboards foundation — COMPLETE

- [x] The dashboard now loads permission-filtered live records and chooses Owner, Manager, or Employee mode from active role templates instead of rendering static demonstration arrays.
- [x] Owner metrics cover monthly and year-to-date revenue, receivables, overdue invoices, project health, overdue work, employee utilization, leave, Support, approvals, expiring contracts, Asset returns, Vendor bills, recent audit activity, and security/expiry alerts.
- [x] Employee dashboards cover assigned Tasks and Projects, upcoming meetings, leave balance and requests, assigned Assets, visible Documents, notifications, and submitted time.
- [x] Manager dashboards add managed-member workload, overdue Tasks, assigned approvals, Team leave, Project delivery status, accepted-estimate budget consumption, missing weekly time entries, and metadata-only recent Team activity.
- [x] `/reports` provides permission-aware CRM, Projects, Finance, HR, Support, and Legal reports with shared date, comparison, owner, Team, Department, Project, client, and status filters.
- [x] Reports aggregate canonical source records only and reapply CRM, Project, Support, Legal, HR, Finance, Asset, Team, Department, and managed-member authorization helpers before returning rows or totals.
- [x] Sensitive CSV exports require `reports.export.create`, use formula-safe cells, return private no-store responses, and append `reports.exported` audit evidence with report section, filters, and row count.
- [x] Reports and dashboards exclude salary, personal HR identity fields, Vendor tax/banking details, payment instructions, narrative notes, ticket descriptions, document contents, comment bodies, and unrestricted audit payloads.
- [x] Responsive UI, empty states, strict schemas, unit and behavioral contract tests, pgTAP coverage, database validation, and production-build coverage are included.
- [x] Personal saved report views, scheduled owner delivery, private CSV/PDF snapshots, and a bounded user-defined report-block builder are delivered as the Advanced Reports extension.

### Feature 33 — Automation and permission-aware AI — COMPLETE

- [x] Transactional domain-event outbox, idempotent per-workflow dispatch records, immutable attempt history, bounded retry/backoff, dead-letter recovery, and registered internal handler execution are implemented.
- [x] Lead, Project, Invoice, Payment, onboarding, offboarding, leave, Contract, Support, and Asset events originate from canonical transactions or idempotent due-date seeding.
- [x] Central MCP operations reauthorize the active session, reject files/secrets/private payloads, bound inputs/outputs, redact evidence, and require exact shared approval for sensitive mutations.
- [x] Operator workspace, worker route, configuration, migration, pgTAP, focused contracts, full tests, production build, and setup documentation are included.

### Feature 34 — Final security hardening and operational readiness — FOUNDATION COMPLETE

- [x] Privileged roles require verified TOTP MFA; all members receive an MFA recommendation and server-side enrollment flow.
- [x] AgencyOS sessions use secure production, HTTP-only, same-site cookies with hashed opaque tokens and no browser database credentials.
- [x] Organization policy controls absolute lifetime, idle timeout, critical-action reauthentication, suspicious-login thresholds, and high-risk request ceilings.
- [x] Active-session history, own-session termination, authorized organization-wide revocation, membership-status revocation, and privileged-member MFA recovery are available in `/settings/security`.
- [x] Login/password-reset throttling, suspicious-login notifications, API/search/export/MCP/worker limits, same-origin unsafe API enforcement, CSP, clickjacking, MIME, referrer, permissions, cross-origin, and production HSTS headers are implemented.
- [x] Security policy, session, event, incident, incident-history, and restore-drill records are tenant validated, RLS protected, safely granted, and centrally audited.
- [x] Security events, incident events, and restore-drill evidence are append-only; incident operations preserve classification, containment, communication, and resolution state.
- [x] Access-management, role, permission, MFA-reset, organization-session, policy, and restore-evidence mutations require recent password confirmation.
- [x] `docs/OPERATIONS.md` and `docs/SECURITY.md` define credential rotation, encrypted off-server backups, recovery order, containment, incident handling, and cross-module checks.
- [x] `npm run verify`, focused behavioral security tests, pgTAP, deployment verification, and the production build are required for release; React Doctor remains an optional local diagnostic and is not a CI gate.
- [ ] A production-like full restore drill must still be executed against actual PostgreSQL, MinIO, configuration, DNS/TLS, and secret-manager infrastructure; the application records immutable measured evidence but does not fabricate external recovery proof.

### Feature 35 — Residual workflow closure — COMPLETE

- [x] Support automatic triage uses ordered organization-scoped keyword rules with explicit category, priority, status, tenant validation, RLS, safe grants, authorized rule creation and inspection, fallback behavior, persisted explanations, and SLA recalculation from the final priority.
- [x] Asset requests use sequential `AR-000001` identifiers, strict request types, employee ownership, manager and Operations shared approval, exact approval snapshots, approved-request fulfillment, assignment notifications, and central audit evidence.
- [x] Asset return requests can be created manually or automatically from HR offboarding and membership transfer changes; employee acknowledgement is narrower than administrative management and completed returns close the active request.
- [x] Vendor bills can enter `approved` only through the shared Approval engine after exact purchase-order matching; partial and final payment actions require the approved state.
- [x] Focused unit/source contracts, pgTAP coverage, migration validation, full tests, production build, and operator documentation are included.

### Feature 36 — Deployment verification and recovery guidance — COMPLETE

- [x] `npm run security:deployment:verify` validates local migration integrity, exact local/remote migration parity, remote push dry-run, linked or direct-database pgTAP, deployed browser security headers, and unauthenticated Search, report-export, and MCP boundaries.
- [x] Deployment evidence is private, deterministic, hash-only, and excludes database URLs, tokens, pgTAP output, response bodies, and credentials.
- [x] `docs/OPERATIONS.md` documents encrypted backups, recovery order, isolated validation, and safe reconnection of integrations without requiring repository JSON templates or generated restore-evidence files.
- [x] Focused unit/source contracts verify deployment parsing, private evidence output, authentication redirects, and MCP cache boundaries.

### Feature 37 — Advanced Reports — COMPLETE

- [x] Personal saved views preserve normalized report filters, one authorized section, and 1–12 predefined report blocks without accepting arbitrary SQL, columns, or expressions.
- [x] Saved-view names are unique per owner, archived instead of deleted, tenant validated, RLS protected, and centrally audited.
- [x] CSV and PDF snapshots are generated from the same permission-filtered report data and selected blocks, stored as confidential private files, integrity hashed, and downloadable only by the generating member.
- [x] Scheduled delivery is owner-only, supports daily, weekly, and monthly cadence in an organization-approved timezone, and delivers private snapshot links through the shared notification system.
- [x] The internal delivery worker uses an independent bearer secret, Redis lease, bounded batch, `FOR UPDATE SKIP LOCKED`, current-permission rechecks, occurrence idempotency, bounded retry, and automatic pause after repeated or terminal failures.
- [x] Report schedule runs are append-only, snapshot occurrences are unique, private-file events and report actions are audited, and generated response bodies remain private and no-store.
- [x] The `/reports` workspace uses inline progressive controls for saved views, block selection, snapshots, schedule state, and history without nested modals or permission ghost controls.
- [x] Migration, pgTAP, focused unit/source contracts, full tests, database validation, build, and operator setup documentation are included.

### Feature 38 — CRM relationships and record completeness — COMPLETE

- [x] Lead attachments reuse the existing Documents upload route, private MinIO quarantine, malware scanning, integrity checks, entity links, and current Documents permissions.
- [x] Companies store one optional active primary contact with same-organization, same-company, and active-status trigger enforcement.
- [x] Primary-contact changes reauthorize Company update scope and Contact view scope, append central audit evidence, and are available through UI and MCP without exposing Contact notes.
- [x] Company relationship panels show only permission-authorized Projects, Invoices, Legal contracts, Support tickets, and Documents, using each module's existing visibility helper.
- [x] Global search includes safe Company relationship counts and visible primary-contact metadata while preserving source-module permission checks and no content indexing.
- [x] CRM deep links select the appropriate Companies or Contacts workspace tab, and inline progressive panels avoid nested modal flows or hidden unauthorized controls.
- [x] Migration, pgTAP, focused unit/source contracts, full tests, database validation, production build, and operator procedures are included.

### Cross-cutting hardening — Pending migration integrity repair — COMPLETE

- [x] Restore complete canonical copies of migrations `20260717003700` through `20260717004200` for linked deployment.
- [x] Replace the onboarding assignee trigger's inline `CASE` expression with explicit INSERT/UPDATE validation state so the function body is easier to inspect and cannot be mistaken for a truncated conditional.
- [x] Extend `npm run db:check` with lexical SQL integrity checks for unterminated dollar-quoted function bodies, quoted values, nested block comments, unmatched parentheses, and missing final statement terminators.
- [x] Verify all six pending migrations with PostgreSQL's grammar parser before packaging the repair bundle.

### Cross-cutting hardening — React Doctor remediation pass — COMPLETE

- [x] Persist React Doctor scan exclusions for the external Invoice Ninja reference checkout, generated Next output, dependencies, and coverage artifacts.
- [x] Keep authorization visible inside every exported CRM connection server action while reusing one shared authorization-result handler.
- [x] Keep sign-out idempotent and revoke both AgencyOS identity-session and organization security-session state.
- [x] Extract notification Realtime subscription setup and directly unsubscribe/tear down the owned channel during effect cleanup.
- [x] Replace deprecated `z.string().uuid()/datetime()/url()/email()` usages with Zod 4 top-level string formats and replace the remaining strict-object API.
- [x] Reuse cached `Intl` date, number, currency, timezone, and display-name formatters rather than rebuilding formatters on each render or calculation.
- [x] Hoist the client-statement CSV column definition to module scope and add regression tests for authorization, cleanup, scan scope, Zod 4, and formatter caching.
- [x] Replace scanner-visible accessibility and correctness risks with explicit labels, named dialogs, native list/table semantics, stable React keys, deterministic UTC/locale formatting, and owned modal close controls.
- [x] Replace handler-only tax state with a ref, lazily initialize organization timezone state, and use a `Set` for repeated notification-category membership checks.
- [x] Reduce the verified React Doctor baseline from 183 findings with 10 errors to 59 non-blocking warnings with zero errors; retain giant-component, chained-iteration, sequential-worker, and response-logging findings for context-aware follow-up rather than risky mass changes.

### Cross-cutting hardening — Release verification and request safety — COMPLETE

- [x] Pull-request CI runs only `npm run verify`, using the repository-pinned Node version; React Doctor is no longer a CI or release requirement.
- [x] CRM webhooks, MCP JSON-RPC, push-subscription requests, and internal worker requests reuse one streaming bounded-request reader that enforces actual UTF-8 bytes and cannot be bypassed by an absent or understated `Content-Length` header.
- [x] Browser `datetime-local` defaults reuse one local wall-clock formatter across Approvals, Assets, Support, Vendors, Documents, and HR onboarding/offboarding, with positive-offset and daylight-saving regression tests.
- [x] Approval create-policy, submit-request, and delegation dialogs receive unique server completion IDs and handle each successful submission exactly once, including consecutive successes.
- [x] Critical internal-worker, request-boundary, approval-state, datetime, and CSP checks execute behavior directly instead of relying only on source-string assertions.
- [x] Repeated HR, Documents, Legal, Assets, Support, and Vendors action-message rendering delegates to one accessible shared component.
- [x] Node is pinned to 22.23.2 or newer, legacy provider metadata is excluded, and direct `next build` can no longer bypass TypeScript failures.
- [x] Production CSP uses a per-request nonce and `strict-dynamic` for scripts; inline style attributes remain narrowly allowed for existing dynamic progress and layout values.
- [x] The existing large workspace components are accepted for this release and were not split without bundle-profile evidence.
- [x] Every TSX button-like control is source-inventoried, every concrete page is in the browser route matrix, and an isolated multi-role crawler exercises every visible enabled control while recording browser, network, validation, and server failures.

---

# Historical requirements mirror from `PLAN.md`

> Status note: this section preserves the original product requirement inventory and is not the authoritative release-status ledger. Use **Exact execution order from here** and **Delivered feature ledger** above for current status. Unchecked entries below must be reconciled against runtime code, migrations, and tests before being treated as confirmed implementation gaps.

The sections below are the detailed feature backlog. They remain in PLAN order and are also constrained by the execution order above.

## Dashboard

### Owner dashboard

- [x] Revenue this month
- [x] Revenue this year
- [x] Outstanding invoices
- [x] Overdue invoices
- [x] Active projects
- [x] Projects at risk
- [x] Tasks overdue
- [x] Employee utilization
- [x] Pending leave
- [x] Open support tickets
- [x] Pending approvals
- [x] Contracts expiring
- [x] Licences expiring
- [x] Assets awaiting return
- [x] Vendor bills due
- [x] Recent activity
- [x] Security alerts

### Employee dashboard

- [x] My tasks
- [x] My projects
- [x] My meetings
- [x] My leave balance
- [x] My pending requests
- [x] My assigned assets
- [x] My documents
- [x] My notifications
- [x] My time entries

### Manager dashboard

- [x] Team workload
- [x] Team overdue tasks
- [x] Pending approvals
- [x] Team leave calendar
- [x] Project status
- [x] Project budget status
- [x] Unsubmitted time entries
- [x] Recent team activity

## CRM module

### Core features

#### Leads

- [x] Lead name
- [x] Person or company type
- [x] Source
- [x] Status
- [x] Pipeline stage
- [x] Estimated value
- [x] Probability
- [x] Expected closing date
- [x] Assigned sales owner
- [x] Contact details
- [x] Tags
- [x] Notes
- [x] Activities
- [x] Files
- [x] Follow-up date
- [x] Lost reason
- [x] Duplicate detection
- [x] Lead conversion

#### Companies

- [x] Legal name
- [x] Display name
- [x] Industry
- [x] Website
- [x] Registration details
- [x] Tax identifiers
- [x] Billing address
- [x] Service address
- [x] Primary contact
- [x] Account owner
- [x] Client status
- [x] Payment terms
- [x] Currency
- [x] Credit limit
- [x] Notes
- [x] Tags
- [x] Related projects
- [x] Related invoices
- [x] Related contracts
- [x] Related tickets
- [x] Related documents

#### Contacts

- [x] First and last name
- [x] Company
- [x] Job title
- [x] Email
- [x] Phone
- [x] Preferred communication method
- [x] Billing contact flag
- [x] Decision-maker flag
- [x] Portal access
- [x] Notes
- [x] Activities
- [x] Consent status
- [x] Status

#### Pipeline

- [x] Configurable stages
- [x] Stage order
- [x] Stage probability
- [ ] Required fields per stage
- [x] Stage-entry date
- [x] Time in stage
- [ ] Expected revenue
- [x] Won/lost state
- [x] Lost reason
- [x] Pipeline filters
- [x] Sales-owner filters
- [ ] Forecast reports

#### CRM activities

- [x] Call
- [x] Email
- [x] Meeting
- [x] Note
- [ ] Follow-up
- [x] Proposal sent
- [x] Contract sent
- [x] Client response
- [x] Status change

### Lead conversion flow

- [ ] Sales user creates a lead.
- [ ] Duplicate detection checks email, phone and company.
- [ ] User records activities and notes.
- [ ] Lead moves through pipeline stages.
- [ ] Proposal or estimate is prepared.
- [x] Approval is requested where required.
- [ ] Lead is marked won.
- [ ] AgencyOS creates or links:
- [ ] Client company
- [x] Contact
- [x] Project
- [ ] Billing profile
- [ ] Contract request
- [ ] Original lead remains linked for reporting.

## Native projects and task management

### Forty required project capabilities

#### Project foundation

- [x] Project creation
- [x] Unique project code
- [x] CRM client association
- [x] Internal project support
- [x] Project status
- [x] Project priority
- [x] Project owner
- [x] Project members
- [x] Project visibility
- [x] Project archiving

#### Task management

- [x] Task creation
- [x] Rich task description
- [x] Unique task number
- [x] Configurable task status
- [x] Task priority
- [x] Multiple assignees
- [x] Start date
- [x] Due date
- [x] Estimated effort
- [x] Actual time tracking
- [x] Labels
- [x] Attachments
- [x] Comments
- [x] Watchers
- [x] Checklists
- [x] Subtasks
- [x] Parent-child relationships
- [x] Dependencies
- [x] Recurring tasks
- [ ] Complete activity history

#### Planning and views

- [x] List view
- [x] Kanban view
- [x] Calendar view
- [x] Timeline/Gantt view
- [ ] My Tasks
- [ ] Saved filters
- [ ] Grouping and sorting
- [x] Milestones
- [x] Project phases
- [x] Workload and progress reporting

### Additional project features

- [ ] Project templates
- [x] Default task statuses
- [ ] Project-specific custom fields
- [ ] Project notes
- [ ] Project documents
- [ ] Client-visible updates
- [x] Internal-only comments
- [ ] Task reminders
- [ ] Bulk task update
- [ ] Task duplication
- [ ] Move task between projects
- [x] Project health indicator
- [ ] Budget
- [ ] Billing method
- [ ] Hourly rate
- [ ] Fixed-price amount
- [ ] Retainer amount
- [x] Project expenses
- [ ] Project invoice links
- [ ] Profitability
- [ ] Estimated completion
- [ ] Actual completion
- [x] Project closure checklist
- [x] Archive and restore

### Task states

### Task dependency rules

- [x] Blocks
- [x] Blocked by
- [x] Related to
- [x] Duplicate of
- [x] Parent of
- [x] Child of

### Project completion flow

- [ ] Project Manager requests closure.
- [ ] System verifies:
- [ ] Required tasks completed
- [ ] Time entries submitted
- [ ] Outstanding expenses handled
- [ ] Client deliverables uploaded
- [ ] Open support issues reviewed
- [ ] Project assets returned
- [ ] Finance confirms final billing.
- [ ] Project Manager records closure notes.
- [ ] Project becomes completed.
- [ ] Project remains searchable and reportable.
- [ ] Archiving occurs separately.

## Finance and invoicing

### Finance capabilities

#### Product and service catalogue

- [x] Service name
- [x] SKU/code
- [x] Description
- [x] Unit
- [x] Standard rate
- [x] Tax category
- [x] Currency
- [x] Active/inactive
- [x] Default invoice description

#### Estimates and quotations

- [x] Draft estimate
- [x] Estimate number
- [x] Client
- [x] Contact
- [x] Project
- [x] Issue date
- [x] Expiry date
- [x] Currency
- [x] Line items
- [x] Quantity
- [x] Rate
- [x] Discount
- [x] Tax
- [x] Notes
- [x] Terms
- [x] Approval status
- [x] Internal notes
- [x] PDF snapshot
- [x] Email history
- [x] Client acceptance status
- [x] Convert to invoice
- [x] Version history

#### Invoices

- [x] Draft invoice
- [x] Invoice number
- [x] Client and contact
- [x] Project
- [x] Purchase-order reference
- [x] Issue date
- [x] Due date
- [x] Service period
- [x] Currency
- [x] Line items
- [x] Discounts
- [x] Taxes
- [x] Tax summary
- [x] Subtotal
- [x] Total
- [x] Amount paid
- [x] Balance
- [x] Notes
- [x] Terms
- [x] Bank/payment details
- [x] Attachments
- [x] Internal notes
- [x] Approval
- [x] Finalization
- [x] PDF snapshot
- [x] Email delivery
- [x] Download history
- [x] Payment history
- [x] Credit notes
- [x] Void workflow

#### Invoice statuses

- [x] Draft
- [x] Pending Approval
- [x] Approved
- [x] Issued
- [x] Sent
- [x] Viewed
- [x] Partially Paid
- [x] Paid
- [x] Overdue
- [x] Disputed
- [x] Void
- [x] Credited

#### Payments

- [x] Payment date
- [x] Amount
- [x] Currency
- [x] Payment method
- [x] Transaction/reference number
- [x] Bank account
- [x] Client
- [x] Invoice allocations
- [x] Receipt
- [x] Notes
- [x] Entered by
- [x] Reconciliation status
- [x] Refund state

#### Expenses

- [x] Employee expense
- [x] Project expense
- [x] Vendor expense
- [x] Category
- [x] Amount
- [x] Tax
- [x] Receipt
- [x] Billable status
- [x] Reimbursable status
- [x] Approval
- [x] Payment state
- [x] Project allocation

#### Financial reports

- [x] Revenue by month
- [x] Revenue by client
- [x] Revenue by project
- [x] Revenue by service
- [x] Outstanding receivables
- [x] Overdue receivables
- [x] Payment collection time
- [x] Expense by category
- [x] Expense by project
- [x] Project gross profit
- [x] Estimate conversion rate
- [x] Tax summary
- [x] Client statement

### Critical invoice rules

#### Invoice numbering

- [x] Numbers are allocated inside a database transaction.
- [x] Concurrent issuers cannot receive the same organization/year number.
- [x] Issued invoice numbers are unique and never returned to the sequence.

#### Issued invoice immutability

- [x] Line items cannot be silently changed
- [x] Client snapshot cannot be silently changed
- [x] Tax values cannot be silently changed
- [x] Invoice number cannot change
- [x] Original PDF must remain available
- [x] Corrections require a void, revised invoice or credit note
- [x] Every correction must reference the original invoice

#### Snapshot data

- [x] Company legal details
- [x] Company address
- [x] Company tax identifiers
- [x] Client legal name
- [x] Client billing address
- [x] Client tax identifiers
- [x] Currency
- [x] Exchange rate where used
- [x] Tax rates
- [x] Payment terms
- [x] Bank details
- [x] Line-item descriptions
- [x] Final totals

#### Monetary calculations

- [x] Browser components
- [x] PDFs
- [x] Reports
- [x] Email templates

## HR module

### Employee lifecycle

### Recruitment-lite

- [ ] Candidate profile
- [ ] Position
- [x] Department
- [ ] Resume
- [ ] Contact details
- [ ] Interview stages
- [ ] Interview notes
- [ ] Interview score
- [ ] Assignment status
- [ ] Salary expectation
- [ ] Offer status
- [ ] Rejection reason
- [ ] Convert candidate to employee

### Employee records

#### Basic information

- [x] Employee ID
- [x] Full legal name
- [x] Preferred name
- [ ] Photograph
- [x] Personal email
- [x] Work email
- [x] Phone
- [x] Date of birth
- [ ] Gender where legally appropriate
- [ ] Marital status where required
- [x] Nationality
- [ ] Residential address
- [ ] Emergency contacts

#### Employment information

- [x] Joining date
- [x] Employment type
- [x] Department
- [x] Designation
- [x] Manager
- [x] Work location
- [x] Remote/hybrid/office status
- [ ] Probation dates
- [x] Notice period
- [ ] Contract dates
- [x] Employee status
- [x] Working hours
- [ ] Weekly work schedule

#### Sensitive information

- [x] Salary
- [ ] Bank account
- [ ] Tax identifiers
- [ ] Government identification
- [ ] Passport
- [x] Visa/work permit
- [ ] Medical or accommodation records
- [ ] Disciplinary records
- [x] Background checks

### Attendance

- [x] Check-in
- [x] Check-out
- [x] Manual attendance
- [x] Attendance correction request
- [x] Late arrival
- [x] Early departure
- [x] Work-from-home day
- [x] Half-day
- [x] Overtime
- [x] Attendance notes
- [x] Manager approval
- [x] Monthly attendance summary

### Leave

- [x] Leave types
- [x] Leave balance
- [x] Accrual rules
- [x] Carry-forward
- [x] Paid/unpaid status
- [x] Half-day leave
- [x] Multi-day leave
- [x] Attachment requirement
- [x] Manager approval
- [x] HR approval
- [x] Leave calendar
- [x] Team conflict warning
- [x] Cancellation
- [x] Balance adjustment history

### Leave flow

- [x] Employee submits request.
- [x] System validates balance.
- [x] System checks overlapping leave.
- [x] Manager receives approval.
- [x] HR receives approval where configured.
- [x] Balance is reserved while pending.
- [x] On approval, calendar is updated.
- [x] On rejection or cancellation, reserved balance is restored.
- [x] All actions are audited.

### Salary and salary slips

- [x] Salary structure
- [x] Base salary
- [x] Allowances
- [x] Deductions
- [x] Bonus
- [x] Reimbursement
- [x] Effective date
- [x] Revision history
- [x] Salary-slip upload
- [x] Salary-slip generation
- [x] Employee acknowledgement
- [x] Download audit
- [x] The employee
- [x] Authorized HR users
- [x] Owner
- [x] Specifically authorized auditor

### HR documents

- [x] Offer letter
- [x] Appointment letter
- [x] Employment agreement
- [x] NDA
- [x] Experience letter
- [x] Relieving letter
- [x] Promotion letter
- [x] Salary-revision letter
- [x] Warning letter
- [x] Performance letter
- [x] Identification documents
- [x] Education documents
- [x] Certificates
- [x] Visa/work permit
- [x] Background check
- [x] Exit documents

### Onboarding

- [x] Offer accepted
- [x] Employment documents collected
- [x] Account created
- [x] Department assigned
- [x] Manager assigned
- [x] Equipment requested
- [x] Email created
- [x] Policies acknowledged
- [x] NDA signed
- [x] Mandatory training assigned
- [x] First-day meeting scheduled
- [x] Probation review scheduled

### Offboarding

- [x] Resignation/termination record
- [x] Last working date
- [x] Knowledge transfer
- [x] Project reassignment
- [x] Open-task review
- [x] Asset return
- [x] Expense settlement
- [x] Account suspension
- [x] Vault access removal
- [x] Document generation
- [x] Exit interview
- [x] Final clearance
- [x] Employee archive

## Documents module

### Features

- [x] Folder hierarchy
- [x] Categories
- [x] Tags
- [x] Entity linking
- [x] File upload
- [x] File preview
- [x] Download
- [x] Versioning
- [x] Checksum
- [x] Comments
- [x] Access controls
- [x] Expiry
- [x] Review dates
- [x] Retention
- [x] Legal hold
- [x] Archive
- [x] Search
- [x] Access history
- [x] Download history
- [x] Approval
- [x] Publishing

### Entity linking

- [x] Client
- [x] Contact
- [x] Lead
- [x] Project
- [x] Task
- [x] Invoice
- [x] Estimate
- [x] Employee
- [x] Contract
- [x] Asset
- [x] Vendor
- [x] Purchase order
- [x] Ticket

### File storage model

- [x] File metadata
- [x] Owner
- [x] Organization
- [x] Classification
- [x] Storage key
- [x] Size
- [x] MIME type
- [x] Checksum
- [x] Version
- [x] Access rules
- [x] Retention state
- [x] Scan status
- [x] Related records

## Legal document storage

### Legal document types

- [x] Client contracts
- [x] Master service agreements
- [x] Statements of work
- [x] NDAs
- [x] Vendor agreements
- [x] Employment agreements
- [x] Contractor agreements
- [x] Partnership agreements
- [x] Data-processing agreements
- [x] Privacy documents
- [x] Corporate registrations
- [x] GST records
- [x] PAN records
- [x] Licences
- [x] Insurance policies
- [x] Intellectual-property records
- [x] Compliance certificates
- [x] Board resolutions
- [x] Legal notices
- [x] Dispute records

### Legal document metadata

- [x] Document title
- [x] Document type
- [x] Internal reference
- [x] Counterparty
- [x] Responsible owner
- [x] Department
- [x] Effective date
- [x] Expiry date
- [x] Renewal date
- [x] Notice period
- [x] Jurisdiction
- [x] Governing law
- [x] Contract value
- [x] Currency
- [x] Related client/vendor/employee
- [x] Related project
- [x] Status
- [x] Confidentiality level
- [x] Signature status
- [x] Retention category
- [x] Legal-hold status
- [x] Current version
- [x] Original-file checksum

### Legal states

### Confidentiality levels

### Contract flow

- [x] User creates contract request.
- [x] Legal template is selected.
- [x] Draft is generated from the selected immutable Documents template version.
- [x] Business owner supplies commercial fields.
- [x] Legal Manager reviews legal clauses through the shared approval engine.
- [x] Finance reviews financial obligations when required.
- [x] Owner approves where required.
- [x] Counterparty version is uploaded in Documents and attached immutably.
- [x] Changes create new versions.
- [x] Final version is approved.
- [x] Signature status is tracked.
- [x] Signed copy is uploaded and attached as an immutable signed version.
- [x] Contract becomes active only after a signed version exists.
- [x] Renewal, notice, and expiry reminder records are created from lifecycle dates.
- [x] Termination or expiry creates a final lifecycle event.

### Legal version rules

- [x] Never overwrite a legal document file
- [x] Every replacement creates a new version
- [x] Preserve uploader, timestamp and checksum
- [x] Approved versions cannot be edited
- [x] Draft metadata may change
- [x] Final signed documents are immutable
- [x] A superseded version remains accessible to authorized users
- [x] Legal hold blocks deletion and retention expiry through the linked Documents record

### Legal deletion rules

- [x] It is not under legal hold
- [x] It is not an active agreement
- [x] Retention requirements permit deletion
- [x] The user has deletion permission
- [x] A second authorized user approves where configured
- [x] The deletion event is permanently audited

## Support module

### Ticket features

- [x] Ticket number
- [x] Subject
- [x] Description
- [x] Client
- [x] Contact
- [x] Project
- [x] Category
- [x] Priority
- [x] Status
- [x] Assigned agent
- [x] Assigned team
- [x] Watchers
- [x] Internal notes
- [x] Public replies
- [x] Attachments
- [x] Due date
- [x] SLA timestamps
- [x] Resolution
- [x] Satisfaction score
- [x] Activity history

### Ticket statuses

- [x] New
- [x] Open
- [x] Waiting for customer
- [x] Waiting internally
- [x] Resolved
- [x] Closed

### Support flow

- [x] Ticket is submitted.
- [x] Ordered deterministic routing rules categorize new tickets and assign priority before SLA deadlines are calculated; unmatched tickets use the active General enquiry default and manual selection remains explicit.
- [x] Support Manager or routing rule assigns an agent.
- [x] Agent responds.
- [x] Internal notes remain hidden from clients.
- [x] Waiting status pauses appropriate SLA clocks.
- [x] Resolution is recorded.
- [x] Client confirms or ticket auto-closes under policy.
- [x] Reopening preserves the original ticket history.

## Calendar

### Event types

- [x] Meetings
- [x] Project deadlines
- [x] Task deadlines
- [x] Milestones
- [x] Invoice due dates
- [x] Contract renewals
- [x] Licence expirations
- [x] Employee leave
- [x] Holidays
- [x] Interviews
- [x] Probation reviews
- [x] Asset warranty expirations
- [x] Asset expected returns
- [x] Purchase-request required dates
- [x] Purchase-order delivery dates

### Features

- [x] Month/week/day view
- [x] Agenda view
- [x] Personal calendar
- [x] Team calendar
- [x] Company calendar
- [x] Department calendar
- [x] Project calendar
- [x] Filters
- [x] Recurring events
- [x] Reminders
- [x] Attendees
- [x] Location
- [x] Meeting link
- [x] Related records
- [x] Private-event visibility

## Assets

### Asset categories

- [x] Laptops
- [x] Desktops
- [x] Monitors
- [x] Phones
- [x] SIM cards
- [x] Accessories
- [x] Software licences
- [x] Keys/access cards
- [x] Furniture
- [x] Other equipment

### Asset data

- [x] Asset tag
- [x] Serial number
- [x] Category
- [x] Manufacturer
- [x] Model
- [x] Purchase date
- [x] Purchase price
- [x] Vendor
- [x] Warranty
- [x] Condition
- [x] Location
- [x] Custodian
- [x] Assignment history
- [x] Maintenance history
- [x] Attachments
- [x] Disposal status

### Asset lifecycle

- [x] Ordered
- [x] Received
- [x] Available
- [x] Assigned
- [x] Under Repair
- [x] Lost
- [x] Stolen
- [x] Retired
- [x] Disposed

### Assignment flow

- [x] Asset request is submitted.
- [x] Manager approves through the shared Approval engine when a manager is available.
- [x] Asset Manager selects an available asset.
- [x] Employee acknowledges receipt.
- [x] Assignment date and condition are recorded.
- [x] Return request is created during transfer or offboarding and closes when the active assignment is returned.
- [x] Returned condition is recorded.
- [x] Damage or missing items create an incident.

## Vendors and procurement

### Vendor features

- [x] Vendor profile
- [x] Vendor contacts
- [x] Categories
- [x] Tax information
- [x] Payment terms
- [x] Bank details
- [x] Contracts
- [x] Documents
- [x] Performance notes
- [x] Risk classification
- [x] Status

### Procurement features

- [x] Purchase request
- [x] Requested items
- [x] Business justification
- [x] Project/department allocation
- [x] Budget
- [x] Approval workflow
- [x] Vendor quotations
- [x] Vendor selection
- [x] Purchase order
- [x] Delivery tracking
- [x] Goods received
- [x] Vendor bill
- [x] Payment status
- [x] Contract linkage

### Purchase flow

- [x] Employee submits purchase request.
- [x] Manager approves need.
- [x] Finance validates budget.
- [x] Procurement obtains quotations where required.
- [x] Vendor is selected.
- [x] Purchase order is issued.
- [x] Goods or services are received.
- [x] Receipt is confirmed.
- [x] Vendor bill is matched.
- [x] Finance approves payment.

## Approval engine

- [ ] Leave
- [x] Attendance corrections
- [ ] Expenses
- [ ] Estimates
- [ ] Invoices
- [ ] Credit notes
- [x] Purchases
- [x] Vendor bills
- [ ] Contracts
- [x] Asset requests
- [ ] Document publication
- [ ] Salary changes

### Approval capabilities

- [x] Sequential approval
- [x] Parallel approval
- [x] Conditional steps
- [x] Amount-based approval
- [x] Department-based approval
- [x] Manager approval
- [x] Role-based approval
- [x] Named-user approval
- [x] Delegation
- [x] Escalation
- [x] Reminder
- [x] Approval expiry
- [x] Reassignment
- [x] Comment requirement
- [x] Rejection reason
- [x] Revision request
- [x] Complete history

### Generic approval tables

- [x] `approval_definitions`
- [x] `approval_definition_steps`
- [x] `approval_requests`
- [x] `approval_request_steps`
- [x] `approval_actions`
- [x] `approval_delegations`

## Notifications

### Channels

- [x] In-app
- [x] Email
- [x] Optional browser push

### Notification categories

- [ ] Assignment
- [ ] Mention
- [x] Approval requested
- [x] Approval decision
- [ ] Task due
- [x] Invoice overdue
- [ ] Leave status
- [ ] Contract expiry
- [ ] Licence expiry
- [ ] Asset return
- [ ] Support reply
- [ ] Security alert
- [x] Integration failure

### Features

- [x] Notification center
- [x] Unread count
- [x] Mark read
- [x] Mark all read
- [x] Deep links
- [x] Category preferences
- [x] Email preference
- [x] Digest preference
- [x] Quiet hours
- [x] Delivery history
- [x] Retry state

## Audit logs

### Actions to audit

- [x] Login success/failure
- [x] MFA changes
- [x] Session revocation
- [x] User invitation
- [x] Role changes
- [x] Permission changes
- [x] Record creation
- [x] Record updates
- [x] Record deletion
- [x] Approvals
- [x] Invoice issue/void
- [x] Payment entry
- [x] Salary access/change
- [x] Document upload/download
- [x] Legal-file access
- [x] Export
- [x] Integration changes
- [ ] API-key changes
- [x] Security-policy changes
- [ ] Passwords
- [ ] Authentication tokens
- [ ] API secrets
- [ ] Bank credentials
- [ ] Private keys
- [ ] Full document contents

## Global search

- [x] Leads
- [x] Clients
- [x] Companies
- [x] Contacts
- [x] Projects
- [x] Tasks
- [x] Employees
- [x] Tickets
- [x] Documents
- [x] Contracts
- [x] Assets
- [x] Vendors
- [x] Purchase requests
- [x] Purchase orders
- [x] Calendar events
- [x] Estimates
- [x] Invoices
- [x] Record existence remains hidden when unauthorized
- [x] Sensitive titles remain hidden when unauthorized
- [x] Salary information remains excluded
- [x] Restricted legal documents remain excluded
- [x] Other users’ private HR documents remain excluded

## Reports

### Required reports

#### CRM

- [x] Leads by source
- [x] Leads by status
- [x] Pipeline value
- [x] Conversion rate
- [x] Sales by owner
- [x] Time in stage
- [x] Lost reasons

#### Projects

- [x] Project progress
- [x] Overdue projects
- [x] Task completion
- [x] Workload
- [x] Estimated versus actual hours
- [x] Project budget
- [x] Project profitability
- [x] Utilization

#### Finance

- [x] Revenue
- [x] Outstanding invoices
- [x] Overdue invoices
- [x] Client balances
- [x] Expense breakdown
- [x] Tax summary
- [x] Payment collection
- [x] Profitability

#### HR

- [x] Headcount
- [x] Department distribution
- [x] Attendance
- [x] Leave
- [x] Employee turnover
- [x] Upcoming probation reviews
- [x] Expiring employee documents
- [x] Asset assignments

#### Support

- [x] Open tickets
- [x] Resolution time
- [x] SLA breaches
- [x] Tickets by category
- [x] Tickets by client
- [x] Agent workload
- [x] Satisfaction

#### Legal

- [x] Active contracts
- [x] Expiring contracts
- [x] Pending signatures
- [x] Renewal obligations
- [x] Restricted-document access
- [x] Licence expirations

## Automation and internal workers

### AgencyOS automation records

- [x] Automation name
- [x] Trigger
- [x] Conditions
- [x] registered handler key
- [x] Enabled status
- [x] Allowed modules
- [x] Last execution
- [x] Last result
- [x] Error count
- [x] Owner
- [x] Audit history

### Example triggers

- [x] Lead converted
- [x] Project created
- [x] Invoice issued
- [ ] Invoice overdue
- [x] Payment received
- [x] Employee onboarded
- [x] Employee offboarded
- [x] Leave approved
- [x] Contract expiring
- [x] Ticket escalated
- [x] Asset assigned
- [x] Use only registered internal handler keys
- [x] Accept bounded domain-event data
- [x] Be idempotent and tenant-scoped
- [x] Preserve immutable attempt and final execution history
- [x] Use bounded retries and dead-letter recovery
- [x] Be audited

## Vaultwarden integration

- [x] Display “Open Vaultwarden”
- [x] Store a non-secret Vaultwarden item reference
- [x] Link a project, client or vendor to a vault item
- [x] Track which role may see that a vault reference exists
- [x] Never store Vault passwords
- [x] Never store Secure notes
- [x] Never store TOTP secrets
- [x] Never store Card details
- [x] Never store Recovery codes
- [x] Never store Vault exports
- [x] Never store Master passwords

## Hard security constraints

### Authentication

- [x] MFA mandatory for privileged roles
- [x] MFA recommended for every user
- [x] Secure, HTTP-only, same-site cookies
- [x] No tokens in local storage
- [x] Session expiration
- [x] Idle timeout
- [x] Session revocation
- [x] Active-session viewer
- [x] Password-reset rate limiting
- [x] Login attempt throttling
- [x] Suspicious-login alerts
- [x] Reauthentication for critical actions

### Authorization

- [x] Deny by default
- [x] Authorize on the server
- [x] Never trust hidden buttons
- [x] Never trust client-supplied role names
- [x] Check record ownership on every request
- [x] Check organization scope on every request
- [x] Apply RLS to tenant-owned tables
- [x] Never expose database administrative credentials or authentication encryption keys to the browser
- [x] No unrestricted generic database APIs
- [x] Field-level protection for sensitive data
- [x] Permission tests for every protected route

### Files and MinIO

- [x] Local MinIO adapter is the sole runtime object store; hosted storage is not a runtime dependency.
- [x] Idempotent local bucket setup, health check, and checksum-verified MinIO object lifecycle tooling.
- [x] All buckets private
- [x] No permanent public URLs
- [ ] Short-lived signed download URLs
- [ ] Short-lived signed upload URLs
- [x] Random storage keys
- [x] Original filename stored only as metadata
- [x] Validate extension, MIME and file signature
- [x] Enforce file-size limits
- [x] Quarantine new uploads
- [x] Malware scan before release
- [x] Calculate checksum
- [x] Block executable uploads unless explicitly required
- [x] Prevent SVG script execution
- [x] Prevent HTML upload rendering
- [x] Force safe download headers
- [x] Log download events
- [x] Revoke access immediately after permission changes

### Security-control reconciliation

The unchecked controls below are reconciled by implementation evidence, not guesswork. See `docs/SECURITY_CONTROL_RECONCILIATION.md` for **Implemented**, **Partially verified**, **Not applicable**, **Pending**, and **Operational pending** status. Keep a checkbox open when the acceptance claim is broader than the current proof.

### Input and output

- [ ] Schema validation on every mutation
- [x] Parameterized database queries
- [x] Output encoding
- [ ] HTML sanitization
- [x] Rich-text allowlist / future rich-text release guard
- [x] CSP headers
- [x] CSRF protection
- [x] Strict CORS
- [x] Clickjacking protection
- [x] Secure referrer policy
- [x] File-path traversal prevention
- [x] SSRF protection for URL-fetch features
- [x] No user-controlled shell commands
- [x] No user-controlled PDF-renderer scripts

### Secrets

- [x] Secrets only in deployment secret storage
- [x] No secrets committed to Git
- [x] No secrets in audit logs
- [x] No secrets in browser responses
- [x] Separate credentials by environment
- [x] Key rotation support
- [x] Emergency credential revocation
- [x] Separate worker, MinIO, database and email credentials
- [x] Vaultwarden remains the human-secret store

### Financial security

- [ ] Issued invoices immutable
- [ ] Transactional invoice numbering
- [x] Approval for invoice issue
- [x] Approval thresholds
- [x] No self-approval for controlled transactions
- [ ] Payment entries audited
- [ ] Credit notes reference original invoices
- [ ] Monetary calculations centralized
- [ ] PDF snapshots hashed
- [x] Export permission separated from view permission

### HR security

- [x] Salary fields encrypted or tightly database-restricted
- [x] Salary access audited
- [x] Employee documents private
- [ ] Managers see only required employee information
- [x] Medical information separate-classification release guard
- [x] Government IDs masked by default
- [x] HR export explicitly permitted
- [x] Deactivated employees lose login access immediately

### Legal security

- [x] Legal privilege classification
- [x] Legal hold
- [x] Immutable signed copies
- [x] Version preservation
- [x] Download auditing
- [x] Restricted search indexing
- [ ] Access review
- [x] Retention controls
- [x] No public links
- [x] No direct bucket browsing

### Audit security

- [x] Append-only audit records
- [x] Server-generated timestamps
- [x] Request IDs
- [x] Redaction
- [x] No edit UI
- [x] No per-event deletion
- [x] Restricted export
- [x] Alerts for audit-pipeline failure

### Backups

- [x] Encrypted backups
- [x] Database backups
- [x] MinIO backups
- [x] Environment configuration backups
- [x] Off-server copy
- [x] Retention policy
- [ ] Restore testing
- [x] Backup-access auditing

---

## Shared definition of done for every remaining module

- [ ] Migration exists and is reviewed for reversibility and lock impact.
- [ ] RLS exists on every exposed table and is tested with allowed, denied, and cross-organization cases.
- [ ] Permission catalogue, default-role grants, explicit scopes, and member overrides are defined.
- [ ] Every page, server action, route handler, webhook, scheduled job, and MCP tool performs server-side authorization.
- [ ] Anti-duplicate rules, idempotency keys, merge behavior, and operator-visible conflict handling are implemented.
- [ ] Inputs use Zod or an equivalent strict boundary; sizes, counts, dates, money, URLs, and identifiers are bounded.
- [ ] Secrets remain server-only, encrypted where stored, redacted from logs/errors, and rotatable.
- [ ] Create/update/delete/status/approval/export/security-sensitive reads emit append-only audit events.
- [ ] Accessible labels, keyboard operation, focus states, responsive layout, readable errors, loading states, and empty states are verified.
- [ ] Unit tests, pgTAP tests, migration checks, lint, typecheck, formatting, production build, and manual acceptance flow pass.
- [ ] MCP registry is extended only for safe model-usable operations; files and credentials remain outside tool arguments.
- [ ] `README.md`, `TASK.md`, environment examples, migration instructions, and operator test steps are updated.
