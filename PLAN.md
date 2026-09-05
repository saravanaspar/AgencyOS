# AgencyOS — Complete Product and Implementation Plan

## 1. Product definition

`AgencyOS` is one Next.js application containing all company-facing business modules.

It is not a collection of embedded applications. It owns the user experience, business rules, permissions, approvals, audit history and application data.

External services are connected through adapters:

| External service    | AgencyOS usage                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| Supabase/PostgreSQL | Database, authentication and realtime                                   |
| S3-compatible object storage | Private file and document storage                               |
| Redis               | Caching, rate limits, short-lived locks and background job coordination |
| AgencyOS worker      | Internal scheduling and registered automation handlers                       |
| Vaultwarden         | Password and credential management                                      |
| Email provider      | Transactional email                                                     |
| AI provider         | AI tools                                                                |
| PDF renderer        | Invoice, letter and report generation                                   |

Coolify is not part of the AgencyOS source tree. It only hosts and deploys AgencyOS and the external services.

---

# 2. Application architecture

Build AgencyOS as a **modular monolith**.

It should have:

* One repository
* One Next.js application
* One primary PostgreSQL database
* One authentication system
* One permission engine
* One approval engine
* One notification system
* One audit system
* One document service
* One search system
* One background-job framework
* Separate modules inside the application

Do not create separate microservices for CRM, HR, finance or projects.

## Recommended repository structure

```text
AgencyOS/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── login/
│   │   │   ├── forgot-password/
│   │   │   └── reset-password/
│   │   │
│   │   ├── (workspace)/
│   │   │   ├── dashboard/
│   │   │   ├── crm/
│   │   │   ├── projects/
│   │   │   ├── finance/
│   │   │   ├── hr/
│   │   │   ├── support/
│   │   │   ├── calendar/
│   │   │   ├── documents/
│   │   │   ├── legal/
│   │   │   ├── assets/
│   │   │   ├── vendors/
│   │   │   ├── reports/
│   │   │   ├── approvals/
│   │   │   ├── automation/
│   │   │   ├── notifications/
│   │   │   ├── search/
│   │   │   ├── ai/
│   │   │   └── settings/
│   │   │
│   │   ├── api/
│   │   └── layout.tsx
│   │
│   ├── modules/
│   │   ├── organizations/
│   │   ├── identity/
│   │   ├── permissions/
│   │   ├── audit/
│   │   ├── notifications/
│     │   ├── approvals/
│   │   ├── files/
│   │   ├── search/
│   │   ├── crm/
│   │   ├── projects/
│   │   ├── finance/
│   │   ├── hr/
│   │   ├── support/
│   │   ├── calendar/
│   │   ├── documents/
│   │   ├── legal/
│   │   ├── assets/
│   │   ├── vendors/
│   │   ├── reports/
│   │   ├── automation/
│   │   └── ai/
│   │
│   ├── integrations/
│   │   ├── supabase/
│   │   ├── minio/
│   │   ├── redis/
│   │   ├── workers/
│   │   ├── vaultwarden/
│   │   ├── email/
│   │   ├── pdf/
│   │   └── ai/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── forms/
│   │   ├── tables/
│   │   ├── permissions/
│   │   ├── files/
│   │   ├── activity/
│   │   └── charts/
│   │
│   ├── lib/
│   │   ├── auth/
│   │   ├── validation/
│   │   ├── errors/
│   │   ├── dates/
│   │   ├── money/
│   │   ├── security/
│   │   ├── pagination/
│   │   ├── logging/
│   │   └── jobs/
│   │
│   └── middleware.ts
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   ├── policies/
│   ├── functions/
│   ├── triggers/
│   └── views/
│
├── templates/
│   ├── invoices/
│   ├── estimates/
│   ├── receipts/
│   ├── legal/
│   ├── hr/
│   └── email/
│
├── third_party/
│   └── invoice-ninja/
│       ├── LICENSE
│       ├── NOTICE.md
│       └── templates/
│
├── scripts/
│   ├── database/
│   ├── imports/
│   ├── exports/
│   └── maintenance/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── permissions/
│   ├── security/
│   └── e2e/
│
└── docs/
    ├── architecture/
    ├── permissions/
    ├── security/
    ├── workflows/
    └── operations/
```

## Standard module structure

Every module should use the same internal structure:

```text
src/modules/projects/
├── domain/
│   ├── types.ts
│   ├── constants.ts
│   ├── rules.ts
│   └── events.ts
├── server/
│   ├── repository.ts
│   ├── service.ts
│   ├── queries.ts
│   ├── commands.ts
│   └── permissions.ts
├── schemas/
│   ├── create-project.ts
│   ├── update-project.ts
│   └── create-task.ts
├── ui/
│   ├── components/
│   ├── forms/
│   ├── tables/
│   └── views/
└── tests/
```

UI components must not contain business authorization logic.

## MCP and AI tool contract

AgencyOS must maintain one central, MCP-ready tool registry at:

```text
src/modules/mcp/tool-registry.ts
```

Every capability that may later be used by the AgencyOS AI assistant must be registered in this file. Do not create disconnected tool registries inside individual modules. A feature is not AI-ready until its safe read/write operations are added to the central registry.

Each tool definition must include:

* A stable namespaced tool name
* A human-readable title and description
* A strict JSON input schema
* Required effective permission keys
* Read-only, destructive and idempotency annotations
* A server-side executor that reuses the module's existing command/query layer

Tool access rules:

1. The signed-in user, membership and organization are derived from the server session. They are never accepted from model input.
2. `tools/list` exposes only tools allowed by the user's current effective permissions.
3. Every `tools/call` request re-authorizes the user immediately before execution. Filtering the list is not considered sufficient authorization.
4. Role grants, explicit allow overrides, explicit deny overrides, membership status and organization status all apply to AI tools exactly as they apply to the UI.
5. Service-role keys, database credentials and unrestricted administration clients are never exposed to the model.
6. Write tools use the same validation, lockout protections, tenant checks and audit events as human UI actions.
7. Destructive tools must be clearly annotated so the future AI layer can require explicit user confirmation.
8. New modules must extend the same central registry and add tests proving permission-based visibility.

The internal MCP endpoint is:

```text
POST /api/mcp
```

It is same-origin and protected by the existing Supabase session cookie. This endpoint is intended for the future in-application AI assistant. Before exposing AgencyOS as a remote MCP server to external clients, add MCP OAuth 2.1 resource-server authorization and client registration.

---

# 3. Existing-code audit before implementation

Before adding modules, audit the current BS-CRM codebase.

Create a reuse register with four classifications:

| Classification | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| Keep           | Already correct and reusable                            |
| Extend         | Correct base implementation requiring more features     |
| Replace        | Existing implementation conflicts with the architecture |
| Remove         | Duplicate, abandoned or unreachable implementation      |

Search for existing:

* Organization models
* Membership models
* User settings
* Roles and permissions
* API keys
* Connectors
* Webhooks
* Templates
* Notifications
* File upload utilities
* Audit logging
* Activity feeds
* Company settings
* Country and timezone selectors
* Form components
* Table components
* Pagination
* Error handling
* Authentication middleware
* Database access patterns

No new generic table, modal, authorization helper or storage wrapper should be created when a suitable implementation already exists.

---

# 4. Global application foundation

These capabilities must be completed before business modules.

## 4.1 Organization management

Features:

* Company profile
* Legal company name
* Trading name
* Company logo
* Registered address
* Billing address
* Country
* Timezone
* Default currency
* Financial year
* Tax identifiers
* GST/PAN fields
* Registration numbers
* Primary contact details
* Email sender details
* Invoice settings
* Date and number formats
* Working days
* Business hours
* Holiday calendar
* Organization status
* Organization-level feature settings
* Data export
* Organization audit history

Even for one company, preserve `organization_id` on business tables. It keeps ownership boundaries clear and avoids future rewrites.

## 4.2 Users

Features:

* Invite user
* Activate user
* Suspend user
* Deactivate user
* Resend invitation
* Reset MFA
* Revoke sessions
* Assign roles
* Assign department
* Assign manager
* Assign teams
* Assign project access
* Set employment status
* Configure notification preferences
* View login history
* View active sessions
* Emergency account lock
* User impersonation prohibited by default
* Controlled support impersonation only if explicitly implemented and audited

## 4.3 User profile

* Name
* Profile photograph
* Phone
* Job title
* Department
* Manager
* Timezone
* Language
* Date format
* Notification preferences
* Calendar preferences
* MFA management
* Active sessions
* Security history

Users must not be allowed to edit authoritative HR fields such as salary, employment type, joining date or reporting manager.

---

# 5. Permission model

Do not code checks such as:

```ts
if (user.role === "admin")
```

Use permission keys.

## Permission-key format

```text
module.resource.action
```

Examples:

```text
crm.lead.view
crm.lead.create
crm.lead.update
crm.lead.delete
crm.lead.assign

projects.task.create
projects.task.assign
projects.task.change_status

finance.invoice.create
finance.invoice.approve
finance.invoice.issue
finance.invoice.void

hr.employee.view
hr.employee.view_sensitive
hr.salary.manage

legal.contract.approve
legal.document.download

settings.roles.manage
```

## Permission actions

Every module may use:

* `view`
* `create`
* `update`
* `delete`
* `restore`
* `assign`
* `comment`
* `upload`
* `download`
* `approve`
* `reject`
* `issue`
* `publish`
* `archive`
* `export`
* `manage_access`
* `view_sensitive`
* `manage_settings`

## Permission scopes

A permission must include a data scope:

* Own records
* Assigned records
* Team records
* Department records
* Managed employees
* Selected projects
* Entire organization

Example:

```text
Permission: projects.task.update
Scope: assigned_or_created
```

## Permission decision order

Every server-side request must evaluate:

1. Is the user authenticated?
2. Is the user active?
3. Does the record belong to the organization?
4. Does the user have the required permission?
5. Does the permission scope include this record?
6. Is the record status editable?
7. Is the field classified as sensitive?
8. Is an approval required?
9. Is the operation blocked by separation-of-duty rules?

---

# 6. Default roles

## Permission legend

| Code | Meaning                           |
| ---- | --------------------------------- |
| F    | Full operational management       |
| A    | May approve/finalize              |
| M    | Manage assigned or scoped records |
| O    | Own records only                  |
| R    | Read-only                         |
| S    | Sensitive information permitted   |
| —    | No access                         |

## Role matrix

| Role                      | Organization | CRM              | Projects              | Finance                   | HR                        | Support          | Legal                     | Documents              | Assets/Vendors    | Reports         | Audit         |
| ------------------------- | ------------ | ---------------- | --------------------- | ------------------------- | ------------------------- | ---------------- | ------------------------- | ---------------------- | ----------------- | --------------- | ------------- |
| Owner                     | F            | F                | F                     | F+A+S                     | F+A+S                     | F                | F+A+S                     | F+S                    | F+A               | F               | F             |
| System Administrator      | F            | R                | R                     | —                         | —                         | R                | —                         | Metadata only          | R                 | Operational     | F             |
| Operations Administrator  | M            | F                | F                     | R                         | Limited                   | F                | R                         | M                      | F                 | F               | R             |
| Finance Manager           | R            | R                | R                     | F+A+S                     | —                         | —                | Contract financial fields | Finance documents      | Vendor bills      | Finance         | Finance audit |
| Accountant                | R            | R                | R                     | M+S                       | —                         | —                | —                         | Finance documents      | Vendor bills      | Finance         | Own actions   |
| HR Manager                | R            | Limited          | Team visibility       | —                         | F+A+S                     | —                | Employment documents      | HR documents           | Assigned assets   | HR              | HR audit      |
| Project Manager           | R            | Client records   | F scoped              | Project finance summaries | Team availability         | Project tickets  | Project contracts R       | Project documents      | Project purchases | Project reports | Project audit |
| Team Lead                 | R            | Assigned clients | M scoped              | Time/budget R             | Managed employees limited | M                | —                         | Team/project documents | Team assets R     | Team reports    | Own team      |
| Sales Manager             | R            | F                | Project creation R    | Estimates R               | —                         | —                | NDA templates R           | CRM documents          | —                 | Sales           | CRM audit     |
| Sales Executive           | R            | M/O              | Created project R     | Create estimate drafts    | —                         | —                | NDA request               | Own CRM documents      | —                 | Own pipeline    | Own actions   |
| Support Manager           | R            | Client R         | Project R             | —                         | —                         | F                | —                         | Ticket documents       | —                 | Support         | Support audit |
| Support Agent             | R            | Client R         | Assigned project R    | —                         | —                         | M/O              | —                         | Ticket attachments     | —                 | Own support     | Own actions   |
| Legal Manager             | R            | Counterparty R   | Project R             | Invoice/contract R        | Employment legal R        | —                | F+A+S                     | Legal documents        | Vendor contracts  | Legal           | Legal audit   |
| Asset/Procurement Manager | R            | Vendor/client R  | Project R             | Purchase financial R      | Employee assignment R     | —                | Vendor contracts R        | Procurement documents  | F+A               | Procurement     | Module audit  |
| Employee                  | Own profile  | Assigned/allowed | O/M                   | Own expenses/slips        | O                         | O                | Own documents only        | Allowed documents      | Assigned assets   | Own             | Own actions   |
| Auditor                   | R            | R                | R                     | R+S where approved        | R+S where approved        | R                | R+S                       | R                      | R                 | R               | R             |
| Client User               | —            | Own company      | Shared projects       | Own invoices              | —                         | Own tickets      | Shared contracts          | Shared documents       | —                 | Own reports     | —             |
| Contractor                | —            | Limited client R | Assigned project/task | —                         | Own profile limited       | Assigned tickets | Signed agreements         | Assigned documents     | Assigned asset    | Own work        | Own actions   |

## Mandatory role restrictions

### Owner

The Owner may manage everything, but destructive actions still require confirmation and audit logging.

The Owner must not be able to:

* Rewrite audit history
* Delete issued invoices permanently
* Delete legally held documents
* Read Vaultwarden secrets through AgencyOS
* Bypass document retention silently

### System Administrator

The System Administrator manages technical configuration, not business-sensitive information.

The role may manage:

* Users
* Sessions
* MFA resets
* System settings
* Integrations
* API keys
* Webhooks
* Job queues
* Logs
* Feature configuration

The role must not automatically receive access to:

* Salaries
* Bank details
* Medical information
* Employee identity documents
* Legal privileged documents
* Invoice financial details

### Finance Manager

May:

* Create and approve estimates
* Create, approve and issue invoices
* Register payments
* Create credit notes
* Export financial reports
* View client billing information
* Manage taxes, currencies and numbering

Must not:

* Change HR salary records unless separately granted
* Approve their own high-value expense
* Delete an issued invoice
* Modify a finalized invoice without a correction workflow

### HR Manager

May:

* Manage employee records
* Manage attendance and leave
* Create offers and employment letters
* Upload salary slips
* Manage employee documents
* Conduct onboarding and offboarding
* View sensitive HR information

Must not:

* Access client financial information
* Access unrelated legal matters
* Approve their own leave
* Delete employee disciplinary records outside retention rules

### Auditor

Auditor access must be:

* Read-only
* Time-limited when possible
* Explicitly approved
* Logged
* Export-restricted where required
* Unable to reveal secrets or authentication credentials

---

# 7. Dashboard

The dashboard must be role-aware.

## Owner dashboard

* Revenue this month
* Revenue this year
* Outstanding invoices
* Overdue invoices
* Active projects
* Projects at risk
* Tasks overdue
* Employee utilization
* Pending leave
* Open support tickets
* Pending approvals
* Contracts expiring
* Licences expiring
* Assets awaiting return
* Vendor bills due
* Recent activity
* Security alerts

## Employee dashboard

* My tasks
* My projects
* My meetings
* My leave balance
* My pending requests
* My assigned assets
* My documents
* My notifications
* My time entries

## Manager dashboard

* Team workload
* Team overdue tasks
* Pending approvals
* Team leave calendar
* Project status
* Project budget status
* Unsubmitted time entries
* Recent team activity

Dashboard cards must only query data the user is authorized to view.

---

# 8. CRM module

## Core features

### Leads

* Lead name
* Person or company type
* Source
* Status
* Pipeline stage
* Estimated value
* Probability
* Expected closing date
* Assigned sales owner
* Contact details
* Tags
* Notes
* Activities
* Files
* Follow-up date
* Lost reason
* Duplicate detection
* Lead conversion

### Companies

* Legal name
* Display name
* Industry
* Website
* Registration details
* Tax identifiers
* Billing address
* Service address
* Primary contact
* Account owner
* Client status
* Payment terms
* Currency
* Credit limit
* Notes
* Tags
* Related projects
* Related invoices
* Related contracts
* Related tickets
* Related documents

### Contacts

* First and last name
* Company
* Job title
* Email
* Phone
* Preferred communication method
* Billing contact flag
* Decision-maker flag
* Portal access
* Notes
* Activities
* Consent status
* Status

### Pipeline

* Configurable stages
* Stage order
* Stage probability
* Required fields per stage
* Stage-entry date
* Time in stage
* Expected revenue
* Won/lost state
* Lost reason
* Pipeline filters
* Sales-owner filters
* Forecast reports

### CRM activities

* Call
* Email
* Meeting
* Note
* Follow-up
* Proposal sent
* Contract sent
* Client response
* Status change

## Lead conversion flow

1. Sales user creates a lead.
2. Duplicate detection checks email, phone and company.
3. User records activities and notes.
4. Lead moves through pipeline stages.
5. Proposal or estimate is prepared.
6. Approval is requested where required.
7. Lead is marked won.
8. AgencyOS creates or links:

   * Client company
   * Contact
   * Project
   * Billing profile
   * Contract request
9. Original lead remains linked for reporting.

Do not copy lead data into unrelated duplicate tables.

---

# 9. Native projects and task management

## Forty required project capabilities

### Project foundation

1. Project creation
2. Unique project code
3. CRM client association
4. Internal project support
5. Project status
6. Project priority
7. Project owner
8. Project members
9. Project visibility
10. Project archiving

### Task management

11. Task creation
12. Rich task description
13. Unique task number
14. Configurable task status
15. Task priority
16. Multiple assignees
17. Start date
18. Due date
19. Estimated effort
20. Actual time tracking
21. Labels
22. Attachments
23. Comments
24. Watchers
25. Checklists
26. Subtasks
27. Parent-child relationships
28. Dependencies
29. Recurring tasks
30. Complete activity history

### Planning and views

31. List view
32. Kanban view
33. Calendar view
34. Timeline/Gantt view
35. My Tasks
36. Saved filters
37. Grouping and sorting
38. Milestones
39. Project phases
40. Workload and progress reporting

## Additional project features

* Project templates
* Default task statuses
* Project-specific custom fields
* Project notes
* Project documents
* Client-visible updates
* Internal-only comments
* Task reminders
* Bulk task update
* Task duplication
* Move task between projects
* Project health indicator
* Budget
* Billing method
* Hourly rate
* Fixed-price amount
* Retainer amount
* Project expenses
* Project invoice links
* Profitability
* Estimated completion
* Actual completion
* Project closure checklist
* Archive and restore

## Task states

Default:

```text
Backlog
Ready
In Progress
Review
Blocked
Completed
Cancelled
```

Each project may customize its workflow, but completed and cancelled states must remain terminal unless reopened by an authorized user.

## Task dependency rules

Supported relationships:

* Blocks
* Blocked by
* Related to
* Duplicate of
* Parent of
* Child of

A task must not be marked completed when mandatory incomplete subtasks exist unless an authorized override is recorded.

## Project completion flow

1. Project Manager requests closure.
2. System verifies:

   * Required tasks completed
   * Time entries submitted
   * Outstanding expenses handled
   * Client deliverables uploaded
   * Open support issues reviewed
   * Project assets returned
3. Finance confirms final billing.
4. Project Manager records closure notes.
5. Project becomes completed.
6. Project remains searchable and reportable.
7. Archiving occurs separately.

---

# 10. Finance and invoicing

## Finance capabilities

### Product and service catalogue

* Service name
* SKU/code
* Description
* Unit
* Standard rate
* Tax category
* Currency
* Active/inactive
* Default invoice description

### Estimates and quotations

* Draft estimate
* Estimate number
* Client
* Contact
* Project
* Issue date
* Expiry date
* Currency
* Line items
* Quantity
* Rate
* Discount
* Tax
* Notes
* Terms
* Approval status
* Internal notes
* PDF snapshot
* Email history
* Client acceptance status
* Convert to invoice
* Version history

### Invoices

* Draft invoice
* Invoice number
* Client and contact
* Project
* Purchase-order reference
* Issue date
* Due date
* Service period
* Currency
* Line items
* Discounts
* Taxes
* Tax summary
* Subtotal
* Total
* Amount paid
* Balance
* Notes
* Terms
* Bank/payment details
* Attachments
* Internal notes
* Approval
* Finalization
* PDF snapshot
* Email delivery
* Download history
* Payment history
* Credit notes
* Void workflow

### Invoice statuses

```text
Draft
Pending Approval
Approved
Issued
Sent
Viewed
Partially Paid
Paid
Overdue
Disputed
Void
Credited
```

### Payments

* Payment date
* Amount
* Currency
* Payment method
* Transaction/reference number
* Bank account
* Client
* Invoice allocations
* Receipt
* Notes
* Entered by
* Reconciliation status
* Refund state

### Expenses

* Employee expense
* Project expense
* Vendor expense
* Category
* Amount
* Tax
* Receipt
* Billable status
* Reimbursable status
* Approval
* Payment state
* Project allocation

### Financial reports

* Revenue by month
* Revenue by client
* Revenue by project
* Revenue by service
* Outstanding receivables
* Overdue receivables
* Payment collection time
* Expense by category
* Expense by project
* Project gross profit
* Estimate conversion rate
* Tax summary
* Client statement

## Critical invoice rules

### Invoice numbering

Invoice numbers must be allocated inside a database transaction.

Example:

```text
INV-2026-000001
INV-2026-000002
```

Two users must never receive the same number.

Deleted drafts may release an internal draft identifier, but issued invoice numbers must never be reused.

### Issued invoice immutability

After issue:

* Line items cannot be silently changed
* Client snapshot cannot be silently changed
* Tax values cannot be silently changed
* Invoice number cannot change
* Original PDF must remain available
* Corrections require a void, revised invoice or credit note
* Every correction must reference the original invoice

### Snapshot data

Each issued invoice stores snapshots of:

* Company legal details
* Company address
* Company tax identifiers
* Client legal name
* Client billing address
* Client tax identifiers
* Currency
* Exchange rate where used
* Tax rates
* Payment terms
* Bank details
* Line-item descriptions
* Final totals

Changing the CRM client later must not change historical invoices.

### Monetary calculations

Use database decimal types or integer minor units.

All calculations must be centralized in one finance calculation service.

Never calculate authoritative totals independently in:

* Browser components
* PDFs
* Reports
* Email templates

Those surfaces must render totals already calculated by the finance service.

---

# 11. Exact Invoice Ninja template-copying process

Invoice Ninja’s current repository identifies the software as source-available under Elastic License 2.0. That licence grants rights to use, copy and prepare derivative works, subject to restrictions such as preserving notices, marking modified copies and not providing a substantial hosted version of the software to third parties.

For a private internal AgencyOS, use this controlled process. This is an engineering workflow, not a legal opinion.

## Step 1: Pin the exact Invoice Ninja source version

Never copy from an unversioned branch.

```bash
mkdir -p AgencyOS/vendor-src
cd AgencyOS/vendor-src

git clone \
  --depth 1 \
  --branch v5.13.26 \
  https://github.com/invoiceninja/invoiceninja.git
```

Record the version in:

```text
AgencyOS/third_party/invoice-ninja/NOTICE.md
```

Example:

```text
Source: Invoice Ninja
Source version: v5.13.26
Source repository: invoiceninja/invoiceninja
License: Elastic License 2.0
Files used: invoice design HTML/CSS only
Purpose: Internal invoice rendering
Modification date: YYYY-MM-DD
Modifications: Adapted variables and rendering pipeline for AgencyOS
```

## Step 2: Copy the licence

```bash
mkdir -p AgencyOS/third_party/invoice-ninja
cp \
  AgencyOS/vendor-src/invoiceninja/LICENSE \
  AgencyOS/third_party/invoice-ninja/LICENSE
```

Do not delete source copyright or licence comments from copied files.

## Step 3: Find the exact design definition

Invoice Ninja has changed its design storage structure across releases. Do not assume a filename.

Run:

```bash
cd AgencyOS/vendor-src/invoiceninja

rg -n \
  "DesignSeeder|InvoiceDesign|CustomDesign|design.*html|design.*css" \
  app database resources

rg -n \
  "Clean|Bold|Modern|Business|Playful" \
  app database resources
```

Also inspect files containing large HTML or CSS fields:

```bash
find app database resources \
  -type f \
  \( -name "*.php" -o -name "*.blade.php" -o -name "*.html" -o -name "*.css" \) \
  -print
```

The purpose is to locate:

* Main HTML
* Header HTML
* Footer HTML
* CSS
* Reusable includes
* Table layout
* Total layout
* Page-break rules
* Fonts
* Images or SVGs
* Template variables

Do not copy Invoice Ninja’s invoice calculation services, database models, controllers, licence mechanisms or application branding.

## Step 4: Alternative extraction through Invoice Ninja

Run the pinned Invoice Ninja version locally.

Then:

1. Create a test company.
2. Create a test client.
3. Create a sample invoice containing every supported field.
4. Open invoice-design settings.
5. Duplicate the desired built-in design as a custom design.
6. Open every available design-code section.
7. Copy the HTML, CSS, header, footer and includes.
8. Use browser developer tools to save the design API response when the editor does not expose every section.

Interface labels may vary slightly by Invoice Ninja release, but copying a duplicated custom design prevents modifying the original.

## Step 5: Store the unmodified source copy

```text
AgencyOS/third_party/invoice-ninja/templates/modern/
├── original/
│   ├── template.html
│   ├── styles.css
│   ├── header.html
│   ├── footer.html
│   ├── includes.html
│   └── assets/
├── adapted/
│   ├── template.html
│   ├── styles.css
│   └── mapping.ts
└── README.md
```

Keep `original/` untouched.

Only modify files under `adapted/`.

## Step 6: Add attribution headers

At the top of adapted files:

```html
<!--
Derived from an Invoice Ninja invoice design.
Source version: v5.13.26
Licensed under Elastic License 2.0.
Modified for private internal use in AgencyOS.
See /third_party/invoice-ninja/LICENSE and NOTICE.md.
-->
```

For CSS:

```css
/*
 * Derived from an Invoice Ninja invoice design.
 * Source version: v5.13.26.
 * Licensed under Elastic License 2.0.
 * Modified for AgencyOS.
 */
```

## Step 7: Create one AgencyOS render model

Do not allow each template to query the database.

Create:

```ts
export interface InvoiceRenderModel {
  company: {
    legalName: string;
    displayName?: string;
    logoUrl?: string;
    address: string[];
    email?: string;
    phone?: string;
    website?: string;
    registrationNumber?: string;
    taxNumber?: string;
  };

  client: {
    legalName: string;
    contactName?: string;
    billingAddress: string[];
    email?: string;
    phone?: string;
    taxNumber?: string;
  };

  invoice: {
    number: string;
    issueDate: string;
    dueDate?: string;
    servicePeriod?: string;
    purchaseOrder?: string;
    currency: string;
    status: string;
  };

  lines: Array<{
    description: string;
    details?: string;
    quantity: string;
    unit?: string;
    unitPrice: string;
    discount?: string;
    tax?: string;
    total: string;
  }>;

  totals: {
    subtotal: string;
    discount?: string;
    taxes: Array<{
      label: string;
      amount: string;
    }>;
    total: string;
    paid: string;
    balance: string;
  };

  payment: {
    instructions?: string;
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    routingCode?: string;
    swift?: string;
    upi?: string;
  };

  notes?: string;
  terms?: string;
  footer?: string;
  qrCodeDataUrl?: string;
}
```

## Step 8: Map Invoice Ninja variables

Extract every dynamic token from the copied template.

Depending on its source format, search for:

```bash
rg -o '\{\{[^}]+\}\}' template.html | sort -u
rg -o '\$[A-Za-z0-9_.]+' template.html | sort -u
```

Create an explicit mapping file:

```ts
export const invoiceNinjaVariableMap = {
  invoice_number: "invoice.number",
  invoice_date: "invoice.issueDate",
  due_date: "invoice.dueDate",
  client_name: "client.legalName",
  company_name: "company.legalName",
  subtotal: "totals.subtotal",
  total: "totals.total",
  balance: "totals.balance",
};
```

Do not use uncontrolled global string replacements.

Convert each original variable into your selected server-side template syntax.

Example:

```html
<span>{{ invoice.number }}</span>
<span>{{ client.legalName }}</span>
<span>{{ totals.total }}</span>
```

## Step 9: Preserve exact layout first

During the first adaptation:

* Do not redesign
* Do not change spacing
* Do not change type sizes
* Do not rename CSS classes
* Do not restructure tables
* Do not alter page-break rules
* Do not alter total alignment

Only:

* Replace data variables
* Replace the logo
* Replace company data
* Remove unsupported application controls
* Connect the AgencyOS render model

After visual parity is achieved, create a separately named customized version.

## Step 10: PDF rendering

Use a controlled server-side HTML-to-PDF renderer.

Recommended flow:

```text
InvoiceRenderModel
    ↓
Server-side HTML template
    ↓
Sanitized HTML
    ↓
Headless browser
    ↓
PDF bytes
    ↓
SHA-256 hash
    ↓
Private MinIO object
    ↓
Invoice PDF metadata record
```

PDF requirements:

* A4 and Letter support
* Print background enabled
* Exact margins
* Embedded or approved fonts
* Header/footer control
* Automatic page numbering
* Repeating table headers
* Long-description wrapping
* Controlled page breaks
* No external arbitrary URLs
* No JavaScript from template content
* No remote font loading during production rendering

## Step 11: Pixel comparison

Create one reference Invoice Ninja PDF and one AgencyOS PDF using identical data.

Compare:

* Page size
* Margins
* Logo dimensions
* Font family
* Font weight
* Font size
* Line height
* Table widths
* Column alignment
* Borders
* Colors
* Totals position
* Footer position
* Page breaks

Create image snapshots of each PDF page and run visual regression tests.

## Step 12: Test cases

Every imported design must pass:

1. One line item
2. Fifty line items
3. Very long description
4. Long company name
5. Long client address
6. No logo
7. Large logo
8. No tax
9. One tax
10. Multiple taxes
11. Fixed discount
12. Percentage discount
13. Partial payment
14. Fully paid
15. Overdue
16. Credit note
17. Multiple currencies
18. Zero-value item
19. Negative adjustment
20. Optional fields missing
21. Unicode text
22. RTL text where required
23. Multi-page invoice
24. Long notes and terms

## Step 13: Keep copied templates isolated

Copied Invoice Ninja files must not be mixed into generic UI components.

Use:

```text
third_party/invoice-ninja/
```

for original material, and:

```text
templates/invoices/
```

for your final AgencyOS templates.

This makes licence attribution, future replacement and maintenance manageable.

---

# 12. HR module

## Employee lifecycle

```text
Candidate
→ Offer
→ Preboarding
→ Active Employee
→ Probation
→ Confirmed
→ Notice Period
→ Exited
→ Archived
```

## Recruitment-lite

* Candidate profile
* Position
* Department
* Resume
* Contact details
* Interview stages
* Interview notes
* Interview score
* Assignment status
* Salary expectation
* Offer status
* Rejection reason
* Convert candidate to employee

## Employee records

### Basic information

* Employee ID
* Full legal name
* Preferred name
* Photograph
* Personal email
* Work email
* Phone
* Date of birth
* Gender where legally appropriate
* Marital status where required
* Nationality
* Residential address
* Emergency contacts

### Employment information

* Joining date
* Employment type
* Department
* Designation
* Manager
* Work location
* Remote/hybrid/office status
* Probation dates
* Notice period
* Contract dates
* Employee status
* Working hours
* Weekly work schedule

### Sensitive information

* Salary
* Bank account
* Tax identifiers
* Government identification
* Passport
* Visa/work permit
* Medical or accommodation records
* Disciplinary records
* Background checks

Sensitive fields must require `hr.employee.view_sensitive`.

## Attendance

* Check-in
* Check-out
* Manual attendance
* Attendance correction request
* Late arrival
* Early departure
* Work-from-home day
* Half-day
* Overtime
* Attendance notes
* Manager approval
* Monthly attendance summary

Every attendance correction must preserve original and corrected values.

## Leave

* Leave types
* Leave balance
* Accrual rules
* Carry-forward
* Paid/unpaid status
* Half-day leave
* Multi-day leave
* Attachment requirement
* Manager approval
* HR approval
* Leave calendar
* Team conflict warning
* Cancellation
* Balance adjustment history

## Leave flow

1. Employee submits request.
2. System validates balance.
3. System checks overlapping leave.
4. Manager receives approval.
5. HR receives approval where configured.
6. Balance is reserved while pending.
7. On approval, calendar is updated.
8. On rejection or cancellation, reserved balance is restored.
9. All actions are audited.

A manager cannot approve their own leave.

## Salary and salary slips

* Salary structure
* Base salary
* Allowances
* Deductions
* Bonus
* Reimbursement
* Effective date
* Revision history
* Salary-slip upload
* Salary-slip generation
* Employee acknowledgement
* Download audit

Salary slips are visible only to:

* The employee
* Authorized HR users
* Owner
* Specifically authorized auditor

Managers do not automatically see employee salaries.

## HR documents

* Offer letter
* Appointment letter
* Employment agreement
* NDA
* Experience letter
* Relieving letter
* Promotion letter
* Salary-revision letter
* Warning letter
* Performance letter
* Identification documents
* Education documents
* Certificates
* Visa/work permit
* Background check
* Exit documents

## Onboarding

* Offer accepted
* Employment documents collected
* Account created
* Department assigned
* Manager assigned
* Equipment requested
* Email created
* Policies acknowledged
* NDA signed
* Mandatory training assigned
* First-day meeting scheduled
* Probation review scheduled

## Offboarding

* Resignation/termination record
* Last working date
* Knowledge transfer
* Project reassignment
* Open-task review
* Asset return
* Expense settlement
* Account suspension
* Vault access removal
* Document generation
* Exit interview
* Final clearance
* Employee archive

---

# 13. Documents module

## Features

* Folder hierarchy
* Categories
* Tags
* Entity linking
* File upload
* File preview
* Download
* Versioning
* Checksum
* Comments
* Access controls
* Expiry
* Review dates
* Retention
* Legal hold
* Archive
* Search
* Access history
* Download history
* Approval
* Publishing

## Entity linking

A document may be linked to:

* Client
* Contact
* Lead
* Project
* Task
* Invoice
* Estimate
* Employee
* Contract
* Asset
* Vendor
* Purchase order
* Ticket

One file object can be linked to multiple records without creating multiple physical copies.

## File storage model

PostgreSQL stores:

* File metadata
* Owner
* Organization
* Classification
* Storage key
* Size
* MIME type
* Checksum
* Version
* Access rules
* Retention state
* Scan status
* Related records

MinIO stores only the file bytes.

---

# 14. Legal document storage

## Legal document types

* Client contracts
* Master service agreements
* Statements of work
* NDAs
* Vendor agreements
* Employment agreements
* Contractor agreements
* Partnership agreements
* Data-processing agreements
* Privacy documents
* Corporate registrations
* GST records
* PAN records
* Licences
* Insurance policies
* Intellectual-property records
* Compliance certificates
* Board resolutions
* Legal notices
* Dispute records

## Legal document metadata

Every legal document must have:

* Document title
* Document type
* Internal reference
* Counterparty
* Responsible owner
* Department
* Effective date
* Expiry date
* Renewal date
* Notice period
* Jurisdiction
* Governing law
* Contract value
* Currency
* Related client/vendor/employee
* Related project
* Status
* Confidentiality level
* Signature status
* Retention category
* Legal-hold status
* Current version
* Original-file checksum

## Legal states

```text
Draft
Under Review
Awaiting Internal Approval
Awaiting Counterparty
Awaiting Signature
Active
Renewal Due
Expired
Terminated
Disputed
Archived
```

## Confidentiality levels

```text
Internal
Confidential
Restricted
Legal Privileged
Executive Only
```

## Contract flow

1. User creates contract request.
2. Legal template is selected.
3. Draft is generated.
4. Business owner supplies commercial fields.
5. Legal Manager reviews legal clauses.
6. Finance reviews financial obligations.
7. Owner approves where required.
8. Counterparty version is uploaded.
9. Changes create new versions.
10. Final version is approved.
11. Signature status is tracked.
12. Signed copy is uploaded.
13. Contract becomes active.
14. Renewal and notice reminders are created.
15. Termination or expiry creates a final lifecycle event.

## Legal version rules

* Never overwrite a legal document file
* Every replacement creates a new version
* Preserve uploader, timestamp and checksum
* Approved versions cannot be edited
* Draft metadata may change
* Final signed documents are immutable
* A superseded version remains accessible to authorized users
* Legal hold blocks deletion and retention expiry

## Legal deletion rules

A legal file may only be deleted when:

* It is not under legal hold
* It is not an active agreement
* Retention requirements permit deletion
* The user has deletion permission
* A second authorized user approves where configured
* The deletion event is permanently audited

Normal deletion should archive metadata and remove user visibility. Physical deletion should be a controlled retention job.

---

# 15. Support module

## Ticket features

* Ticket number
* Subject
* Description
* Client
* Contact
* Project
* Category
* Priority
* Status
* Assigned agent
* Assigned team
* Watchers
* Internal notes
* Public replies
* Attachments
* Due date
* SLA timestamps
* Resolution
* Satisfaction score
* Activity history

## Ticket statuses

```text
New
Open
Waiting for Client
Waiting Internally
Escalated
Resolved
Closed
Cancelled
```

## Support flow

1. Ticket is submitted.
2. System categorizes and assigns priority.
3. Support Manager or routing rule assigns an agent.
4. Agent responds.
5. Internal notes remain hidden from clients.
6. Waiting status pauses appropriate SLA clocks.
7. Resolution is recorded.
8. Client confirms or ticket auto-closes under policy.
9. Reopening preserves the original ticket history.

---

# 16. Calendar

## Event types

* Meetings
* Project deadlines
* Task deadlines
* Milestones
* Invoice due dates
* Contract renewals
* Licence expirations
* Employee leave
* Holidays
* Interviews
* Probation reviews
* Asset warranty expirations

## Features

* Month/week/day view
* Agenda view
* Personal calendar
* Team calendar
* Company calendar
* Department calendar
* Project calendar
* Filters
* Recurring events
* Reminders
* Attendees
* Location
* Meeting link
* Related records
* Private-event visibility

Calendar entries derived from projects, leave, invoices and legal records should link back to their source rather than duplicating source data.

---

# 17. Assets

## Asset categories

* Laptops
* Desktops
* Monitors
* Phones
* SIM cards
* Accessories
* Software licences
* Keys/access cards
* Furniture
* Other equipment

## Asset data

* Asset tag
* Serial number
* Category
* Manufacturer
* Model
* Purchase date
* Purchase price
* Vendor
* Warranty
* Condition
* Location
* Custodian
* Assignment history
* Maintenance history
* Attachments
* Disposal status

## Asset lifecycle

```text
Ordered
Received
Available
Assigned
Under Repair
Lost
Stolen
Retired
Disposed
```

## Assignment flow

1. Asset request is submitted.
2. Manager approves.
3. Asset Manager selects an available asset.
4. Employee acknowledges receipt.
5. Assignment date and condition are recorded.
6. Return request is created during transfer or offboarding.
7. Returned condition is recorded.
8. Damage or missing items create an incident.

---

# 18. Vendors and procurement

## Vendor features

* Vendor profile
* Vendor contacts
* Categories
* Tax information
* Payment terms
* Bank details
* Contracts
* Documents
* Performance notes
* Risk classification
* Status

## Procurement features

* Purchase request
* Requested items
* Business justification
* Project/department allocation
* Budget
* Approval workflow
* Vendor quotations
* Vendor selection
* Purchase order
* Delivery tracking
* Goods received
* Vendor bill
* Payment status
* Contract linkage

## Purchase flow

1. Employee submits purchase request.
2. Manager approves need.
3. Finance validates budget.
4. Procurement obtains quotations where required.
5. Vendor is selected.
6. Purchase order is issued.
7. Goods or services are received.
8. Receipt is confirmed.
9. Vendor bill is matched.
10. Finance approves payment.

Requester, approver and payment recorder should be separate users for controlled transactions.

---

# 19. Approval engine

One approval engine supports:

* Leave
* Attendance corrections
* Expenses
* Estimates
* Invoices
* Credit notes
* Purchases
* Vendor bills
* Contracts
* Asset requests
* Document publication
* Salary changes

## Approval capabilities

* Sequential approval
* Parallel approval
* Conditional steps
* Amount-based approval
* Department-based approval
* Manager approval
* Role-based approval
* Named-user approval
* Delegation
* Escalation
* Reminder
* Approval expiry
* Reassignment
* Comment requirement
* Rejection reason
* Revision request
* Complete history

## Generic approval tables

```text
approval_definitions
approval_definition_steps
approval_requests
approval_request_steps
approval_actions
approval_delegations
```

The approval engine stores a snapshot of the values being approved. Changing the underlying record after submission invalidates or restarts approval where necessary.

---

# 20. Notifications

## Channels

* In-app
* Email
* Optional browser push

## Notification categories

* Assignment
* Mention
* Approval requested
* Approval decision
* Task due
* Invoice overdue
* Leave status
* Contract expiry
* Licence expiry
* Asset return
* Support reply
* Security alert
* Integration failure

## Features

* Notification center
* Unread count
* Mark read
* Mark all read
* Deep links
* Category preferences
* Email preference
* Digest preference
* Quiet hours
* Delivery history
* Retry state

---

# 21. Audit logs

Audit logs must include:

```text
organization_id
actor_user_id
actor_type
action
entity_type
entity_id
request_id
source
before_state
after_state
changed_fields
ip_address
user_agent
timestamp
```

## Actions to audit

* Login success/failure
* MFA changes
* Session revocation
* User invitation
* Role changes
* Permission changes
* Record creation
* Record updates
* Record deletion
* Approvals
* Invoice issue/void
* Payment entry
* Salary access/change
* Document upload/download
* Legal-file access
* Export
* Integration changes
* API-key changes
* Security-policy changes

Audit logs must be append-only.

No user, including the Owner, should edit or delete individual audit events through the application.

Sensitive values must be redacted:

* Passwords
* Authentication tokens
* API secrets
* Bank credentials
* Private keys
* Full document contents

---

# 22. Global search

Search across:

* Leads
* Clients
* Companies
* Contacts
* Projects
* Tasks
* Employees
* Tickets
* Documents
* Contracts
* Assets
* Vendors
* Purchase orders
* Estimates
* Invoices

Search results must be permission-filtered before display.

A search index must not leak:

* Record existence
* Sensitive titles
* Salary information
* Restricted legal documents
* Other users’ private HR documents

---

# 23. Reports

## Required reports

### CRM

* Leads by source
* Leads by status
* Pipeline value
* Conversion rate
* Sales by owner
* Time in stage
* Lost reasons

### Projects

* Project progress
* Overdue projects
* Task completion
* Workload
* Estimated versus actual hours
* Project budget
* Project profitability
* Utilization

### Finance

* Revenue
* Outstanding invoices
* Overdue invoices
* Client balances
* Expense breakdown
* Tax summary
* Payment collection
* Profitability

### HR

* Headcount
* Department distribution
* Attendance
* Leave
* Employee turnover
* Upcoming probation reviews
* Expiring employee documents
* Asset assignments

### Support

* Open tickets
* Resolution time
* SLA breaches
* Tickets by category
* Tickets by client
* Agent workload
* Satisfaction

### Legal

* Active contracts
* Expiring contracts
* Pending signatures
* Renewal obligations
* Restricted-document access
* Licence expirations

Every report must apply the same permission rules as operational pages.

---

# 24. Automation and internal workers

AgencyOS owns automation definitions, authorization, scheduling, retries, and execution through registered internal handlers.

## Automation documentation and drift control

`docs/OPERATIONS.md` is the canonical setup and operations guide for AgencyOS workers, environment variables, scheduling, deployment verification, storage, and recovery.

**Mandatory rule:** every change to an automation worker, endpoint, schedule, environment variable, secret, handler contract, or helper script must update `docs/OPERATIONS.md` and `.env.example` in the same change. Automation work is incomplete when source, configuration, and documentation disagree.

When an automation definition is outdated:

1. Review its trigger, conditions, allowed modules, and registered handler key.
2. Compare the handler with `docs/OPERATIONS.md`, `.env.example`, and the handler registry.
3. Recreate the definition with a supported internal handler; never add arbitrary URLs, code, SQL, or secret references.
4. Run `npm run worker -- --once` and verify routing, retries, execution history, and audit evidence.
5. Update `docs/OPERATIONS.md`, `TASK.md`, and affected tests in the same change.

## AgencyOS automation records

* Automation name
* Trigger
* Conditions
* registered handler key
* Enabled status
* Allowed modules
* Last execution
* Last result
* Error count
* Owner
* Audit history

## Example triggers

* Lead converted
* Project created
* Invoice issued
* Invoice overdue
* Payment received
* Employee onboarded
* Employee offboarded
* Leave approved
* Contract expiring
* Ticket escalated
* Asset assigned

AgencyOS should execute only registered internal handlers with bounded inputs.

Automation execution must:

* Use only registered internal handler keys
* Accept bounded domain-event data
* Be idempotent and tenant-scoped
* Preserve immutable attempt and final execution history
* Use bounded retries and dead-letter recovery
* Be audited

---

# 25. Vaultwarden integration

AgencyOS must not become a password manager.

Allowed integration:

* Display “Open Vaultwarden”
* Store a non-secret Vaultwarden item reference
* Link a project, client or vendor to a vault item
* Track which role may see that a vault reference exists

AgencyOS must never store:

* Vault passwords
* Secure notes
* TOTP secrets
* Card details
* Recovery codes
* Vault exports
* Master passwords

The Vaultwarden session remains independent from AgencyOS.

---

# 26. Hard security constraints

## Authentication

* MFA mandatory for privileged roles
* MFA recommended for every user
* Secure, HTTP-only, same-site cookies
* No tokens in local storage
* Session expiration
* Idle timeout
* Session revocation
* Active-session viewer
* Password-reset rate limiting
* Login attempt throttling
* Suspicious-login alerts
* Reauthentication for critical actions

## Authorization

* Deny by default
* Authorize on the server
* Never trust hidden buttons
* Never trust client-supplied role names
* Check record ownership on every request
* Check organization scope on every request
* Apply RLS to tenant-owned tables
* Never expose the Supabase service-role key to the browser
* No unrestricted generic database APIs
* Field-level protection for sensitive data
* Permission tests for every protected route

## Files and MinIO

* MinIO is the sole runtime object store; Supabase Storage is not used by application code
* Existing Supabase Storage objects must be copied, checksum-verified and cut over before source cleanup
* All buckets private
* No permanent public URLs
* Short-lived signed download URLs
* Short-lived signed upload URLs
* Random storage keys
* Original filename stored only as metadata
* Validate extension, MIME and file signature
* Enforce file-size limits
* Quarantine new uploads
* Malware scan before release
* Calculate checksum
* Block executable uploads unless explicitly required
* Prevent SVG script execution
* Prevent HTML upload rendering
* Force safe download headers
* Log download events
* Revoke access immediately after permission changes

## Input and output

* Schema validation on every mutation
* Parameterized database queries
* Output encoding
* HTML sanitization
* Rich-text allowlist
* CSP headers
* CSRF protection
* Strict CORS
* Clickjacking protection
* Secure referrer policy
* File-path traversal prevention
* SSRF protection for URL-fetch features
* No user-controlled shell commands
* No user-controlled PDF-renderer scripts

## Secrets

* Secrets only in deployment secret storage
* No secrets committed to Git
* No secrets in audit logs
* No secrets in browser responses
* Separate credentials by environment
* Key rotation support
* Emergency credential revocation
* Separate worker, MinIO, database and email credentials
* Vaultwarden remains the human-secret store

## Financial security

* Issued invoices immutable
* Transactional invoice numbering
* Approval for invoice issue
* Approval thresholds
* No self-approval for controlled transactions
* Payment entries audited
* Credit notes reference original invoices
* Monetary calculations centralized
* PDF snapshots hashed
* Export permission separated from view permission

## HR security

* Salary fields encrypted or tightly database-restricted
* Salary access audited
* Employee documents private
* Managers see only required employee information
* Medical information separately classified
* Government IDs masked by default
* HR export explicitly permitted
* Deactivated employees lose login access immediately

## Legal security

* Legal privilege classification
* Legal hold
* Immutable signed copies
* Version preservation
* Download auditing
* Restricted search indexing
* Access review
* Retention controls
* No public links
* No direct bucket browsing

## Audit security

* Append-only audit records
* Server-generated timestamps
* Request IDs
* Redaction
* No edit UI
* No per-event deletion
* Restricted export
* Alerts for audit-pipeline failure

## Backups

* Encrypted backups
* Database backups
* MinIO backups
* Environment configuration backups
* Off-server copy
* Retention policy
* Restore testing
* Backup-access auditing

---

# 27. Implementation order

## Stage 0 — Existing-code reuse audit

* Inventory current modules
* Identify duplicate implementations
* Preserve working organization and connector code
* Normalize shared components
* Create migration baseline
* Create permission catalogue

## Stage 1 — Platform foundation

* Organizations
* Users
* Memberships
* Roles
* Permissions
* Sessions
* Audit
* Notifications
* Approval engine
* MinIO adapter with local Compose setup, private bucket bootstrap, bounded reads and verified Supabase-to-MinIO migration
* Redis adapter
* internal handler registry
* Vaultwarden links
* Global error handling

## Stage 2 — CRM and projects

* Leads
* Companies
* Contacts
* Pipeline
* Activities
* Projects
* Tasks
* Kanban
* Comments
* Attachments
* Time tracking
* Project reports

## Stage 3 — Finance

* Products/services
* Estimates
* Invoice calculation engine
* Invoice approval
* Invoice issue
* PDF generation
* Invoice templates
* Payments
* Expenses
* Credit notes
* Financial reports

## Stage 4 — HR

* Employees
* Departments
* Designations
* Attendance
* Leave
* HR documents
* Salary slips
* Onboarding
* Offboarding
* Employee self-service

## Stage 5 — Documents and legal

* Private uploads
* Versioning
* Tags
* Entity links
* Retention
* Legal contracts
* Renewals
* Signature tracking
* Legal holds
* Restricted access

## Stage 6 — Support, assets and procurement

* Tickets
* Support workflow
* Asset inventory
* Asset assignment
* Vendors
* Purchase requests
* Purchase orders
* Vendor bills
* Approval integration

## Stage 7 — Calendar and reports

* Unified calendar
* Operational reports
* Management dashboard
* Export permissions
* Scheduled reports

## Stage 8 — Automation and AI

* internal worker triggers
* Signed callbacks
* AI email writer
* AI proposal writer
* AI document search
* Permission-aware retrieval
* AI audit records

## Stage 9 — Hardening

* [x] Permission and cross-tenant test matrix
* [x] RLS and append-only evidence tests
* [x] Financial, invoice snapshot, document-access, and malware-scan regression coverage
* [x] Privileged MFA, session expiry, idle timeout, revocation, and critical-action reauthentication
* [x] Security headers, same-origin unsafe-request checks, and high-risk rate limits
* [x] Exhaustive TSX button inventory, complete page-route matrix, and isolated multi-role browser control crawler
* [x] Encrypted database, MinIO, configuration, and off-server backup runbook
* [x] Incident classification, containment, evidence, communication, and post-incident runbook
* [ ] Execute and record a production-like full restore drill against external infrastructure

---

# 28. Definition of done

A module is not complete merely because its screens exist.

Every module must include:

* Database migration
* RLS policies
* Permission catalogue
* Server-side authorization
* Validation schemas
* Audit events
* Notifications where relevant
* Approval integration where relevant
* Activity history
* Search integration
* File-access rules
* Error states
* Empty states
* Loading states
* Pagination
* Filtering
* Sorting
* Export controls
* Unit tests
* Integration tests
* Permission tests
* Security tests
* Documentation

The final product is:

> One AgencyOS application owning CRM, projects, finance, HR, support, calendar, documents, legal, assets, vendors, reports, approvals, permissions, notifications, search, audit, automation and AI, while using Supabase, MinIO, Redis and Vaultwarden as external infrastructure.

---

# 29. Zod validation addendum

Use Zod selectively at application trust boundaries. This adds implementation detail without replacing any validation, authorization, or database rule above.

Zod validation is required for:

* Environment variables when a server or browser integration is initialized
* Route parameters and query-string filters before repository calls
* Form submissions, Server Actions and API request bodies
* Worker requests, automation execution results, and connector webhook payloads
* Import rows after files are parsed and before records are written
* AI provider structured output before it enters business workflows
* Permission keys, permission scopes and mutation command objects
* Adapter configuration passed to MinIO, Redis, email, PDF and Vaultwarden integrations

Zod validation should not be repeated inside every component or on every trusted database row. Parse once at the boundary, pass typed values inward, and keep business invariants in domain services and PostgreSQL constraints.

Validation implementation rules:

* Keep schemas beside their owning module under `schemas/`
* Reuse shared primitives for UUIDs, money, dates, pagination and normalized text
* Normalize email addresses, currency codes, country codes and slugs during parsing where safe
* Return field-specific validation errors without exposing secrets or internal stack traces
* Use database constraints and RLS as the final authority even after Zod succeeds
* Add unit tests for accepted, rejected and boundary values of every mutation schema
* Version webhook and import schemas when external payload contracts change

---

# 30. Release verification and request-safety hardening

The open-source release baseline adds the following completed controls:

* Pull-request CI uses the single authoritative `npm run verify` command. Optional React Doctor scans are local diagnostics only.
* Node.js is pinned to 22.23.2 or newer in `.node-version`, `package.json`, the lockfile and CI.
* JSON and webhook routes count streamed bytes rather than trusting `Content-Length`; protocols that cryptographically require a declared length can opt into that stricter requirement.
* `datetime-local` values are formatted from local date components so UTC conversion does not shift user-visible wall-clock times.
* Repeated approval submissions carry unique completion IDs so each successful action closes and refreshes its dialog once.
* Repeated action-message markup uses one shared accessible component, while domain wrappers preserve existing imports and state types.
* Production responses receive a request-scoped nonce CSP from Proxy. Script `unsafe-inline` is removed, TypeScript build errors are not ignored, and generated Supabase link metadata is excluded from Git.
* Security-critical regression coverage should execute functions and rendered output directly. Source-text contracts are reserved for narrow architecture and migration invariants that cannot be exercised without external infrastructure.

Large workspace component decomposition is intentionally deferred until bundle analysis or measured interaction performance identifies a release-impacting problem.

## Remaining external release evidence

The only explicitly incomplete final-hardening item remains a production-like restore drill against real PostgreSQL, MinIO, configuration, Redis, DNS/TLS and secret-manager infrastructure. The repository can orchestrate and validate evidence, but it cannot truthfully mark this external exercise complete until operators run it in an isolated recovery environment.
