# AgencyOS test guide

> **Current database/auth architecture (August 2026):** AgencyOS owns authentication and runs on ordinary PostgreSQL. Use `DATABASE_URL`/`DATABASE_ADMIN_URL`, `npm run db:status`, `npm run db:migrate`, `npm run db:doctor`, and `npm run db:test`. Older sections that describe the former hosted provider are historical acceptance notes only; do not configure or link that provider for current verification.

Last updated: 2026-07-21

This file is the required manual and browser-MCP verification guide for every delivered feature. Every future feature must update this file in the same change set before it can be marked complete in `TASK.md`.

## Current release-candidate status (2026-07-21)

This section is authoritative when older feature notes below describe an earlier foundation state.

- Unit suite: **111 files, 519 tests** after documentation consolidation and removal of restore-template-only contracts. The previously failing timezone and Finance/HR PDF tests pass in this Linux runtime. PDF rendering must still be repeated inside the exact deployment image through `npm run test:pdf-runtime`.
- Browser suite: Playwright is now the required browser harness. It runs public and authenticated route checks at 1440, 1024, 768, and 375 CSS pixels, captures traces/screenshots on failure, runs Axe, records ARIA snapshots, checks keyboard focus, opens disclosures/tabs, checks 200% zoom and horizontal overflow, and compares discovered interactive controls with exercised controls. Failure video is opt-in because Playwright requires its separate ffmpeg package: run `npx playwright install ffmpeg` once, then `PLAYWRIGHT_VIDEO=1 npm run test:e2e`.
- Local browser evidence: the eight public routes passed at 1440 px and 375 px on 2026-07-21. The 1024 px and 768 px projects are configured; authenticated route evidence still requires disposable multi-role credentials and an isolated seeded environment.
- Source inventory: `test-results/ui-controls.json` now inventories buttons, links, tabs, disclosures, textboxes, checkboxes, and selects. It is a machine-readable coverage index, not proof that a business workflow succeeded.
- AI: `/ai` is a real permission-gated workspace with server-side Gemini and DeepSeek adapters. Models may call only MCP tools visible to the signed-in membership. Provider keys never reach the browser.
- MCP: **113 tools** are registered. Dashboard, Calendar read/create/cancel, Reports, Automation read/create/enable/retry, and Global Search are connected. Read tools use permission-scoped, short-lived Redis caching; mutations invalidate the organization cache generation.
- MCP transport: the same-origin cookie-authenticated Streamable HTTP endpoint validates `Origin`, `Accept`, `MCP-Protocol-Version`, and `Mcp-Session-Id`, enforces initialize/initialized lifecycle state in Redis, returns 405 for GET because SSE is not offered, and supports DELETE session termination.
- Security: local `.env.local` must be mode `0600` and must never be distributed. Production authenticated rate limits fail closed when Redis is unavailable. `/api/health/live` and `/api/health/ready` are available for platform probes.
- External release checks remain mandatory: rotate every credential from any previously shared archive, configure HTTPS/TLS production integrations, execute disposable multi-role authenticated Playwright runs, verify linked migration/pgTAP parity, run deployment HTTP checks, and test backup recovery in an isolated environment. Source changes do not substitute for deployed verification.

Required release candidate commands:

```bash
npm ci
npm run verify
npm run test:pdf-runtime
npm run test:e2e
npm run db:test
npm run security:deployment:verify -- --app-url https://YOUR-RC-HOST
```

## Test credentials and secrets

Do not commit real passwords, API keys, access tokens, webhook secrets, database passwords, or production customer data to this file. Keep actual values in `.env.local`, a password manager, or a private test-run note.

| Test value                              | Required for                                                  | Where to obtain/store                        | Safe placeholder                          |
| --------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `BASE_URL`                              | All browser tests                                             | Local or approved test deployment            | `http://localhost:3000`                   |
| Owner email and password                | Full administration, last-owner safeguards, all feature tests | Existing AgencyOS test owner account         | `owner@example.test` / `<password>`       |
| Admin email and password                | Delegated administration and role tests                       | Existing or owner-approved test member       | `admin@example.test` / `<password>`       |
| Sales email and password                | CRM scope and restricted navigation tests                     | Test member assigned a sales role            | `sales@example.test` / `<password>`       |
| Project member email and password       | Project visibility and assignment tests                       | Test member assigned to a project            | `delivery@example.test` / `<password>`    |
| Restricted email and password           | Negative permission tests                                     | Test member with a minimal custom role       | `restricted@example.test` / `<password>`  |
| `DATABASE_URL`                          | Server database access and tooling                            | Dedicated non-production PostgreSQL database | `postgresql://...`                        |
| `CRM_CONNECTOR_ENCRYPTION_KEY`          | CRM connector credential encryption                           | Generate once with `openssl rand -base64 32` | `<base64-32-byte-key>`                    |
| Meta app secret                         | Meta webhook signature validation                             | Meta app settings                            | `<meta-app-secret>`                       |
| Meta verification token                 | Meta webhook GET verification                                 | Generated when creating the connection       | `<meta-verify-token>`                     |
| Meta Page access token                  | Fetching Meta lead details                                    | Meta Graph API setup                         | `<meta-page-token>`                       |
| Google Ads webhook key                  | Google lead-form webhook validation                           | Generated when creating the connection       | `<google-webhook-key>`                    |
| HubSpot private-app token               | Default HubSpot client-managed connection                     | Client HubSpot account/private app           | `<private-app-token>`                     |
| Pipedrive API token                     | Default Pipedrive client-managed connection                   | Client Pipedrive personal settings           | `<api-token>`                             |
| Client-owned OAuth app ID and secret    | OAuth pull connection for supported CRM providers             | Client's provider developer/app settings     | `<client-id>` / `<client-secret>`         |
| Salesforce connected app and test org   | Salesforce OAuth, refresh, paging, health                     | Client-owned Salesforce sandbox/app          | `<client-id>` / `<client-secret>`         |
| Zoho OAuth client, region, and test org | Zoho OAuth, refresh, paging, health                           | Client-owned approved Zoho test org          | `us` / `<client-id>` / `<client-secret>`  |
| `INTERNAL_WORKER_SECRET`                | Trusted scheduled connector runner                            | Generate/store only in server and scheduler  | `<strong-random-bearer-secret>`           |
| `VAULTWARDEN_URL`                       | Independent Open Vaultwarden links                            | Test Vaultwarden deployment                  | `https://vault.example.test`              |
| `GEMINI_API_KEY`                        | Server-side Gemini AI provider                                | Approved secret manager                      | `<server-only-api-key>`                   |
| `GEMINI_MODELS`                         | Allowed Gemini model list                                     | Deployment configuration                     | `gemini-3.5-flash,gemini-3.1-pro-preview` |
| `DEEPSEEK_API_KEY`                      | Server-side DeepSeek AI provider                              | Approved secret manager                      | `<server-only-api-key>`                   |
| `DEEPSEEK_MODELS`                       | Allowed DeepSeek model list                                   | Deployment configuration                     | `deepseek-v4-flash,deepseek-v4-pro`       |

### Recommended test accounts

Use separate accounts so permissions are tested rather than assumed.

| Account        | Minimum role/purpose                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Owner          | Existing system Owner; used for organization-wide setup and recovery                              |
| Admin          | Custom or system administrator with user, role, structure, audit, CRM, and project administration |
| Sales          | CRM access limited to assigned/self-created records where possible                                |
| Project member | Project access only to assigned or visible projects                                               |
| Restricted     | Minimal role used to confirm hidden navigation and denied direct URLs                             |

## Safety and clean-state rules

1. Configure `DATABASE_URL` and direct `DATABASE_ADMIN_URL` only for an approved non-production PostgreSQL database dedicated to AgencyOS verification.
2. Never reset that database. The project reset script is intentionally blocked; schema changes must be forward-only migrations.
3. `npm run db:migrate`, `npm run db:status`, `npm run db:doctor`, and `npm run db:test` explicitly target the configured PostgreSQL database. `db:pull` is intentionally blocked.
4. pgTAP files run transactionally and roll back, but they must still use synthetic fixtures and must never target production.
5. Prefix manually created records with a unique run key such as `E2E-20260715-2200`.
6. Use fake `.test` email addresses and synthetic phone numbers. Do not import real customer data.
7. Record the run key, account, route, and any created record IDs in the test report.
8. Do not disable RLS, bypass server actions, modify cookies, or call the database directly to make a browser test pass.
9. Verify both the successful path and at least one denied, duplicate, invalid, or stale-data path.
10. Confirm sensitive values are not shown in browser logs, audit details, API responses, screenshots, or stored import errors.
11. Clean up test connector credentials and manual synthetic records through the UI after testing.
12. Stop the run and report the first security boundary failure before continuing with unrelated tests.

## Install, database, and automated verification

### Install and environment

Use Node.js 22.23.2 or newer; `.node-version` is the repository and CI baseline.

```bash
npm ci
cp .env.example .env.local
```

Fill the required values in `.env.local`. Provider OAuth environment variables are not required for the default client-managed flow. Generate the CRM connector key once:

```bash
openssl rand -base64 32
```

### Dedicated PostgreSQL test database

Authenticate and link the CLI to the approved non-production project once:

```bash

```

Apply forward-only migrations and run transactional pgTAP tests against that configured PostgreSQL database:

```bash
npm run db:migrate
npm run db:test
```

The database commands use the direct administrative connection explicitly. The shared pgTAP bootstrap resolves the installed extension schema dynamically, and each test remains inside a rolled-back transaction. The project reset script exits with an error and must never be bypassed.

### Full automated verification

```bash
npm run verify
npm run test:pdf-runtime
npm run test:e2e
npm run db:test
```

`npm run verify` must pass formatting, ESLint, TypeScript, source-control inventory, unit tests, migration validation, and the production build. `npm run test:pdf-runtime` repeats the PDF launch path explicitly. `npm run test:e2e` is the credentialed browser release gate; authenticated projects are skipped unless disposable account credentials are supplied. `npm run db:test` remains the separate credentialed linked-project pgTAP gate.

### Focused automated checks

```bash
npm test -- tests/unit/crm-imports.test.ts
npm test -- tests/unit/projects.test.ts
npm test -- tests/unit/secret-envelope.test.ts
npm test -- tests/unit/mcp-tool-registry.test.ts
```

## Browser MCP and Playwright execution protocol

Use this protocol with Playwright MCP or an equivalent browser MCP. Map the action names to the exact tools provided by the browser server.

### Required browser sequence

For every scenario:

1. Start a fresh browser context with no shared storage unless the scenario explicitly tests persistence.
2. Navigate to `BASE_URL` and capture the initial accessibility snapshot.
3. Open browser console and network monitoring before sign-in.
4. Sign in through the visible UI. Never inject session cookies or local storage.
5. Navigate by accessible link or button name where possible. Use a direct URL only for the explicit direct-route authorization check.
6. Locate controls by role, label, heading, or placeholder. Avoid brittle CSS and generated class selectors.
7. Before changing data, create a unique run key and include it in names, subjects, or notes.
8. After each action, wait for the visible success/error state and then capture an accessibility snapshot.
9. Assert the expected record, status, count, permission, or error text in the UI.
10. Inspect console errors and failed network requests. Ignore normal HMR messages in development; report application errors and unexpected 4xx/5xx responses.
11. Test keyboard access by using `Tab`, `Shift+Tab`, `Enter`, `Space`, and `Escape` for at least the primary flow.
12. Test responsive layout at widths `1440`, `1024`, and `768` for pages changed by the feature.
13. Take a screenshot only after sensitive values are hidden or redacted.
14. Sign out through the UI at the end of an account-specific scenario.
15. Save a compact result containing: scenario ID, run key, account, pass/fail, actual result, console errors, failed requests, and screenshot path.

### Clean browser-MCP prompt template

```text
Test AgencyOS scenario <SCENARIO_ID> against <BASE_URL>.
Use only visible browser interactions and accessible selectors.
Do not bypass authentication, RLS, server actions, or permissions.
Use synthetic data prefixed with <RUN_KEY>.
Capture an accessibility snapshot before and after every state-changing action.
Check console errors and failed network requests after every action.
Stop immediately and report if a permission boundary, secret-redaction rule,
or anti-duplicate rule fails.
At the end, report each assertion with expected and actual results.
```

### Browser-MCP result format

```text
Scenario: F10-CSV-01
Run key: E2E-20260714-2200
Account: owner@example.test
Result: PASS | FAIL | BLOCKED
Assertions:
- Expected: ...
  Actual: ...
Console errors: none | details
Failed network requests: none | details
Created records: names or safe IDs
Cleanup: completed | retained | blocked
Evidence: screenshot/accessibility snapshot references
```

## Manual and browser test scenarios

## Feature 1 — Authentication and controlled access

### F01-AUTH-01: protected route redirects signed-out users

Account: none.

1. Open a fresh private browser context.
2. Navigate directly to `/dashboard`.
3. Confirm the browser redirects to `/login`.
4. Confirm no workspace content flashes before the redirect.
5. Confirm the return URL is local and does not accept an external domain.

Expected: the workspace is inaccessible without a valid session.

### F01-AUTH-02: valid sign-in and sign-out

Account: Owner.

1. Open `/login`.
2. Enter the owner email and password.
3. Submit the form.
4. Confirm `/dashboard` loads and the signed-in user is shown in the shell.
5. Sign out through the visible account control.
6. Navigate back to `/dashboard`.

Expected: sign-in creates a valid session; sign-out removes access and returns to login.

### F01-AUTH-03: pending access has no organization permissions

Account: a newly confirmed signup not yet granted membership.

1. Complete signup and email confirmation in the approved test environment.
2. Sign in before an owner grants access.
3. Confirm the pending-access page appears.
4. Try direct URLs `/crm`, `/projects`, and `/settings`.

Expected: no organization data or module page is available until access is granted.

### F01-AUTH-04: owner grants, suspends, and restores access

Accounts: Owner and pending test user.

1. As Owner, open `/settings/users`.
2. In **Grant organization access**, enter the confirmed test email and choose a role.
3. Grant access and confirm the member appears as active.
4. Sign in as that member and confirm allowed navigation appears.
5. As Owner, change the member status to suspended.
6. Refresh the member session and try a protected route.
7. Restore the member to active and repeat sign-in.

Expected: membership status controls all organization access immediately or on the next authorization check.

### F01-AUTH-05: last-owner safeguard

Account: the only active Owner in a disposable test organization.

1. Open `/settings/users`.
2. Try to change the only active Owner to a non-owner role or inactive status.

Expected: the operation is rejected with a clear message and the owner remains active.

## Feature 2 — Audit log

### F02-AUDIT-01: state changes create audit events

Account: Owner or Admin with audit access.

1. Perform a safe change, such as updating the organization display name to include the run key.
2. Open `/settings/audit`.
3. Search by the acting email or action/entity text.
4. Open the matching event details.

Expected: actor, action, entity, timestamp, and safe before/after detail are available without exposing secrets.

### F02-AUDIT-02: filters, pagination, and export

1. Open `/settings/audit`.
2. Apply a text filter and a date range.
3. Confirm result totals and pagination update.
4. Export the filtered CSV.
5. Open the CSV locally and confirm the visible rows match the filters.
6. Confirm values beginning with spreadsheet formula characters are safely escaped.

Expected: only authorized, filtered events are exported and the export action is itself audited.

### F02-AUDIT-03: unauthorized audit access

Account: Restricted without audit permission.

1. Confirm **Audit log** is hidden or marked restricted in settings navigation.
2. Navigate directly to `/settings/audit`.
3. Try the export route directly with harmless filters.

Expected: both page and export are denied without leaking audit data.

## Feature 3 — Module authorization

### F03-AUTHZ-01: navigation and direct route use the same permission

Account: Restricted.

1. Note which module links are visible in the sidebar and command palette.
2. Try direct URLs for one hidden module, such as `/crm` or `/projects`.
3. Open `/settings/permissions` when the account is allowed to inspect itself.

Expected: hidden modules are also denied by direct URL; visible modules load; effective permission sources explain the result.

### F03-AUTHZ-02: explicit deny overrides an inherited allow

Accounts: Owner and test member.

1. As Owner, ensure the member role allows `crm.view` or the equivalent CRM view permission.
2. Add a member override with effect **Deny** and a required reason.
3. Sign in as the member and verify CRM navigation and `/crm` access are removed.
4. Inspect effective permissions for the member.
5. Delete the override and verify inherited access returns.

Expected: active explicit deny wins over role grants and is visible in permission inspection.

## Feature 4 — Organization profile

### F04-ORG-01: update organization defaults

Account: Owner or Admin with organization update permission.

1. Open `/settings/organization`.
2. Change the display name, country, timezone, currency, or financial-year default using synthetic test values.
3. Save.
4. Refresh the page.
5. Open `/settings/audit` and locate the update.

Expected: values persist, immutable organization identity fields remain unchanged, and an exact safe diff is audited.

### F04-ORG-02: stale update protection

1. Open `/settings/organization` in two browser tabs.
2. Save a change in tab A.
3. Save a different change from the stale form in tab B.

Expected: tab B receives a clear conflict/stale-data message instead of silently overwriting tab A.

### F04-ORG-03: timezone and currency labels

1. Inspect timezone options.
2. Confirm each option starts with a canonical UTC offset and that zero offset appears once as `UTC`.
3. Change country to India or another supported region and inspect recommended timezone/currency ordering.

Expected: labels are readable, aliases are normalized, and recommendations are country-aware.

## Feature 5 — Departments, teams, and reporting lines

### F05-STRUCT-01: department and team lifecycle

Account: Owner or Admin with structure permissions.

1. Open `/settings/structure`.
2. Create department `<RUN_KEY> Delivery` with code based on the run key.
3. Create team `<RUN_KEY> Launch`.
4. Edit each record and save.
5. Add an active member to the team and optionally mark them as lead.
6. Try to deactivate a department or team while active assignments exist.
7. Remove assignments, deactivate, then delete the inactive disposable record.

Expected: active assignment safeguards prevent destructive status changes; valid lifecycle actions are audited.

### F05-STRUCT-02: manager cycle prevention

1. Assign member B to report to member A.
2. Try to assign member A to report to member B.
3. Try to set a member as their own manager.

Expected: self-management and reporting cycles are rejected.

### F05-STRUCT-03: cross-organization isolation

Use only a dedicated automated or pgTAP environment.

1. Run `npm run db:test`.
2. Confirm the organization-structure pgTAP tests pass.

Expected: tenant triggers and RLS prevent cross-organization reads and writes.

## Feature 6 — Custom roles and member overrides

### F06-ROLE-01: create and assign a custom role

Account: Owner or role administrator.

1. Open `/settings/roles`.
2. Create `<RUN_KEY> CRM reviewer` with a clear description.
3. Select only the minimum CRM read permissions and save.
4. Open `/settings/users` and assign the role to the Restricted test member.
5. Sign in as the member and verify only intended pages/actions appear.

Expected: the role grants exactly the saved permissions and no administrative extras.

### F06-ROLE-02: allow, deny, scope, expiry, and reason

1. In **Member permission overrides**, select a member and permission.
2. Create an **Allow** override with a valid scope, reason, and future expiry.
3. Inspect effective permissions and verify the source is the active override.
4. Replace it with **Deny** and verify access is removed.
5. Use an already expired timestamp in a disposable database test or wait for a short approved expiry.

Expected: active overrides affect access, expired overrides do not, and every change is audited.

### F06-ROLE-03: protected role safeguards

1. Try to delete a system role.
2. Try to delete an active or assigned custom role.
3. Deactivate and unassign a disposable custom role, then delete it.

Expected: only inactive, unassigned, non-system roles can be deleted.

## Feature 7 — Roles and settings UI correction

### F07-UI-01: permission rows are not clipped

Account: Owner or role administrator.

1. Open `/settings/roles` at viewport widths 1440, 1024, and 768.
2. Select a role and expand every permission module accordion.
3. Confirm permission names, descriptions, selected counts, scopes, and controls are fully visible.
4. Search for a long permission name.
5. Navigate all controls using only the keyboard.

Expected: no hidden half-lines, overlap, horizontal truncation, or unreachable control.

### F07-UI-02: member override alignment

1. Scroll to **Member permission overrides**.
2. At 1440 width, confirm member, permission, effect, scope, reason, expiry, and save controls align cleanly.
3. Repeat at 1024 and 768.
4. Trigger validation by omitting the reason.

Expected: the form reflows without overlap and validation remains associated with the correct field.

### F07-UI-03: settings structure layout

1. Open `/settings/structure` at the same three widths.
2. Expand/edit departments, teams, assignments, and reporting controls.

Expected: labels and controls remain readable and aligned without clipping.

## Feature 8 — Permission-scoped MCP layer

### F08-MCP-01: list available tools

Account: Owner.

Open browser developer tools on an authenticated page and define:

```js
async function callMcp(method, params) {
  const response = await fetch("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  return response.json();
}
```

Then run:

```js
await callMcp("tools/list");
```

Expected: only tools permitted for the active session are returned. Owner access should include relevant organization, access, role, structure, CRM, import-sync, and project tools.

### F08-MCP-02: call a read tool

```js
await callMcp("tools/call", {
  name: "agencyos.access.get_current",
  arguments: {},
});
```

Expected: `isError` is false and identity/organization are derived from the active session rather than caller arguments.

### F08-MCP-03: denied tool is unavailable or rejected

Account: Restricted.

1. Run `tools/list` and confirm an unauthorized administration tool is absent.
2. Try to call that exact tool name manually.

Expected: the call is rejected after server-side reauthorization; changing arguments cannot select another organization or user identity.

### F08-MCP-04: malformed and oversized requests

Use an approved local/test environment.

1. Send malformed JSON.
2. Send an unknown method.
3. Send invalid tool arguments.
4. Send a request beyond the configured body limit.

Expected: bounded, generic JSON-RPC errors are returned without stack traces, secrets, or internal SQL details.

## Feature 9 — CRM foundation

### F09-CRM-01: company, contact, and lead flow

Account: Owner, Admin, or permitted Sales user.

1. Open `/crm`.
2. Select **Companies** and create `<RUN_KEY> Acme Ltd`.
3. Select **Contacts** and create a contact linked to the company.
4. Select **Pipeline** and create `<RUN_KEY> Website opportunity` with email, phone, source, value, owner, and stage.
5. Search for the run key and filter by owner, stage, and status.

Expected: all records appear only within the current organization and respect the active filters.

### F09-CRM-02: anti-duplicate checks

1. Create a lead with `buyer.<RUN_KEY>@example.test`.
2. Try to create another active lead with the same normalized email using different casing or whitespace.
3. Repeat with the same normalized phone.
4. For a company-only lead, repeat with the same normalized company name.

Expected: duplicate active leads are rejected or matched according to the safe duplicate policy; no silent second record is created.

### F09-CRM-03: pipeline, qualification, activity, and conversion

1. Move the test lead to another configured stage.
2. Add a call, email, meeting, note, or follow-up activity.
3. Qualify the lead.
4. Convert it to a client company and optional contact.
5. Refresh CRM and inspect the original lead.

Expected: stage transition and activity are recorded; only a qualified lead converts; the original lead remains linked and is not duplicated.

### F09-CRM-04: CRM scope enforcement

Accounts: Owner and Sales.

1. As Owner, create one lead assigned to Sales and one lead assigned to another member.
2. Sign in as Sales with assigned/self-created scope.
3. Confirm the assigned lead is visible and the unrelated lead is not.
4. Try direct MCP read/update calls using the unrelated lead ID if available from the owner test notes.

Expected: UI, server actions, and MCP enforce the same effective scope.

## Feature 38 — CRM relationships and record completeness

### F38-CRM-01: Company primary contact

Accounts: Owner, permitted Sales user, and a Sales user without Contact view permission.

1. Create Company `<RUN_KEY> Relationship client` and two active Contacts linked to it.
2. Open **Companies**, expand the Company record, select one Contact as the primary Contact, and save.
3. Refresh and confirm the Contact name and email remain visible on the Company.
4. Change the primary Contact to the second linked Contact, then clear the selection.
5. Inspect `audit_events` for `crm.company_primary_contact_updated` entries.
6. As the user without Contact view permission, confirm the selector and Contact metadata are absent.

Expected: only an active visible Contact linked to the same Company can be selected; every change is audited; missing Contact permission does not expose hidden Contact identity.

### F38-CRM-02: primary-contact integrity and tenant boundaries

Use two non-production organizations.

1. Attempt to set the Company primary Contact to a Contact from another Company in the same organization.
2. Attempt to use a Contact from the second organization.
3. After selecting a valid primary Contact, attempt to make that Contact inactive or move it to another Company.
4. Attempt direct authenticated table updates that bypass the server action.

Expected: database triggers reject cross-company, cross-tenant, inactive, and moved primary Contacts. RLS and server authorization still prevent unauthorized record updates.

### F38-CRM-03: Lead private attachments

Prerequisites: local/test MinIO and file-scanner worker are configured. Use only synthetic files.

1. Sign in with CRM Lead view plus Documents workspace/create/view permissions.
2. Open a visible Lead, expand **Attachments**, and upload a small PDF or PNG with a synthetic title.
3. Confirm the upload enters the existing private-file quarantine and scanner workflow.
4. After a clean scan, open the linked Document and download it through the Documents controls.
5. Upload an EICAR test file only in the isolated scanner test environment and confirm it never becomes downloadable.
6. Remove Documents create permission and verify the upload form disappears while authorized metadata remains visible.
7. Remove Documents view permission and verify attachment names and counts disappear.

Expected: CRM does not create a second file subsystem. Uploads use `/api/documents/upload`, existing entity links, private MinIO, scanner gates, integrity verification, no-store downloads, and current Documents permissions.

### F38-CRM-04: permission-filtered Company relationships

Prepare one Company linked to at least one Project, Invoice, Legal Contract, Support ticket, and Document.

1. Open the Company as Owner and expand **Related records**.
2. Confirm each visible record shows only safe metadata: title/reference, status, and owning-module link.
3. Open every link and verify it resolves to the existing source module.
4. Test roles with only CRM Company view plus exactly one of Project, Invoice, Legal, Support, or Documents view.
5. Test a Project that is outside the member's Project visibility, a restricted Legal Contract, an inaccessible Support ticket, and a Document without membership access.

Expected: each relationship group appears only when its source permission and record-level helper allow access. Hidden records do not affect visible counts, labels, or empty-state wording.

### F38-CRM-05: global search and MCP metadata

1. Search for the Company legal name and visible primary Contact from the command palette and `/search`.
2. Confirm the Company result includes only permitted relationship counts and primary-Contact metadata.
3. Remove each source-module permission and repeat the search.
4. Call `agencyos.crm.get_workspace` and verify Company `relatedRecords` and Lead `documents` contain identifiers, labels, statuses, classifications, and links only.
5. Call `agencyos.crm.set_company_primary_contact` with a valid Contact, then with an unauthorized, unrelated, malformed, and cross-tenant Contact identifier.
6. Inspect MCP and audit evidence for secret, note, file-content, and private-payload leakage.

Expected: global search and MCP preserve the same source permissions as the UI. MCP never returns Document bytes, Contact notes, ticket descriptions, Legal contents, internal file paths, storage credentials, or audit payloads.

### F38-CRM-06: automated verification

Run:

```bash
npm run db:check
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Dedicated non-production PostgreSQL verification:

```bash
npm run db:status
npm run db:migrate
npm run db:test
```

Expected: migration `20260718005300_crm_relationship_completeness.sql` is present remotely, pgTAP passes, unit/source contracts remain green, `/crm` builds, and React Doctor introduces no new findings above the accepted baseline.

## Feature 10 — CRM import and source connections

### F10-CSV-01: CSV import with skip duplicate policy

Account: user with CRM import permission.

1. Open `/crm` and select **Imports**.
2. Upload `tests/fixtures/crm-leads-import.csv`.
3. Choose a stage, owner, source label, and **Skip matching active leads**.
4. Select **Import leads**.
5. Review the result and import history.
6. Open the pipeline and search for the run-key records from the fixture.

Expected: valid unique rows import, the repeated normalized email is skipped, counts are accurate, and errors do not contain private payloads.

### F10-CSV-02: CSV merge policy and per-row savepoints

1. Import a unique lead with missing phone or notes.
2. Import a second file containing the same normalized email plus the missing values and one intentionally invalid row.
3. Choose **Fill missing fields on matching leads**.
4. Run the import.

Expected: missing fields are filled, no duplicate active lead is created, the invalid row is reported, and other valid rows still commit.

### F10-XLSX-01: Excel import

1. Convert the CSV fixture to `.xlsx` without changing headers.
2. Upload the `.xlsx` file.

Expected: the same normalization, duplicate, size, row, and per-row error rules apply.

### F10-LIMIT-01: file limits

1. Try a file larger than 5 MB.
2. Try a file with more than 5,000 data rows.
3. Try an unsupported file extension.

Expected: each file is rejected before unbounded processing with a clear safe message.

### F10-GOOGLE-01: Google Ads webhook and idempotency

1. In **Connect a lead source**, choose Google Ads and create a disposable connection.
2. Copy the one-time webhook URL and key to a private test note.
3. Send a synthetic payload:

```bash
export WEBHOOK_URL='PASTE_TEST_WEBHOOK_URL'
export GOOGLE_KEY='PASTE_ONE_TIME_KEY'

curl -X POST "$WEBHOOK_URL" \
  -H 'content-type: application/json' \
  --data "{
    \"google_key\": \"$GOOGLE_KEY\",
    \"lead_id\": \"<RUN_KEY>-google-001\",
    \"user_column_data\": [
      {\"column_id\": \"FULL_NAME\", \"string_value\": \"<RUN_KEY> Grace Hopper\"},
      {\"column_id\": \"EMAIL\", \"string_value\": \"grace.<RUN_KEY>@example.test\"},
      {\"column_id\": \"PHONE_NUMBER\", \"string_value\": \"+1 555 010 1000\"},
      {\"column_id\": \"COMPANY_NAME\", \"string_value\": \"<RUN_KEY> Compiler Labs\"}
    ]
  }"
```

4. Send the exact request a second time.
5. Inspect import history and pipeline.
6. Repeat with a wrong webhook key.

Expected: the first valid delivery creates or merges one lead, the repeat is idempotent, and the wrong key receives a generic rejection without secret detail.

### F10-META-01: Meta verification and signed delivery

1. Create a Meta Lead Ads connection.
2. Keep the verification token, app secret, and Page token private.
3. Verify the endpoint:

```bash
curl "${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345"
```

4. Confirm the correct token returns `12345` and an incorrect token is rejected.
5. In an approved Meta test app, send a signed synthetic lead delivery.
6. Repeat the same delivery ID.

Expected: verification is exact, delivery signature is required, lead detail retrieval uses the server-stored token, and repeated events do not duplicate a lead.

### F10-CONNECTOR-01: client-managed API-token sync

Run for HubSpot and Pipedrive using a client-owned test account.

1. Keep the provider OAuth environment variables empty. Set only `APP_URL`, `CRM_CONNECTOR_ENCRYPTION_KEY`, and the normal application database/authentication values.
2. Ask the client test account to create a HubSpot private app or copy its Pipedrive API token with the minimum read scopes needed for leads/contacts.
3. In `/crm?tab=imports`, choose the provider and confirm **Client-managed API token** is selected by default.
4. Enter the token once and save the connection.
5. Confirm the connection is active, the token is not shown again, and the connection card says **Client-managed API token**.
6. Select **Health check**, then **Sync now**, and confirm imported leads and history counts.
7. Open **Replace client API token**, save a replacement token, and confirm the credential version increments.
8. Pause the connection and try to sync, then reactivate and delete the disposable connection.
9. Tamper with a request to select `api_token` for Salesforce or Zoho.

Expected: AgencyOS does not require provider OAuth environment variables; only HubSpot and Pipedrive accept direct API tokens; the token is encrypted and never returned; replacement invalidates the previously stored value inside AgencyOS; repeated external IDs merge/idempotently skip; paused connections do not sync; deleting a connection retains imported records and audit history.

### F10-CONNECTOR-02: client-owned OAuth app sync

Run for Salesforce or Zoho, and optionally for HubSpot or Pipedrive when the client prefers OAuth.

1. In the client's provider account, create an OAuth/connected application and register the exact callback: `$BASE_URL/api/crm/oauth/<provider>/callback`.
2. Keep the AgencyOS provider OAuth client ID and secret environment variables empty.
3. In the web interface, choose **Client-owned OAuth app**, enter the client-owned app ID and secret, and save.
4. Select **Authorize with OAuth**, approve the client test account, and confirm AgencyOS returns to the Imports tab with a success message.
5. Select **Health check**, then **Sync now**.
6. Confirm the client secret, access token, and refresh token are absent from the page, URL, browser console, server logs, audit metadata, MCP output, and later responses.
7. Reuse the callback URL/state and confirm the second attempt is rejected.
8. Select **Reconnect OAuth**, authorize again, and confirm the credential version increments.

Expected: the client owns provider registration and approval; AgencyOS needs no provider-specific OAuth environment values; OAuth state is user/organization/connection-bound, expiring, and single-use; the client app secret remains encrypted across callback and token refresh; the connection cannot be activated before a provider access token exists.

### F10-PAGE-01: bounded cursor pagination and incremental checkpoint

Use a sandbox account with more than one provider page of synthetic leads.

1. Record the connection's current checkpoint and cursor from the connection card or approved test database inspection.
2. Run **Sync now**.
3. If a continuation cursor remains, run sync again until the provider window completes.
4. Add one new or modified synthetic lead at the provider after the saved checkpoint.
5. Run sync again.

Expected: each invocation is bounded to a small page/row budget, continuation resumes without restarting the provider window, the checkpoint advances only after the window finishes, and the later run imports only new/modified records without silently dropping a partially fetched page.

### F10-SCHEDULE-01: scheduled sync and authorization recheck

1. Enable automatic sync on a pull connection and choose a supported interval.
2. Set `INTERNAL_WORKER_SECRET` in the application and trusted local scheduler environment.
3. Invoke the runner:

```bash
curl -X POST "$BASE_URL/api/internal/workers/run" \
  -H "Authorization: Bearer $INTERNAL_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"job":"crm-sync"}'
```

4. Invoke with no bearer token and with a wrong bearer token.
5. Remove or deny `crm.import.execute` from the connection creator, make the connection due in a disposable database, and invoke the trusted runner again.

Expected: only the exact server secret is accepted; the caller cannot choose an organization or connection; due work is claimed once; unauthorized connection owners cause scheduling to be disabled and a deduplicated operator alert; no connector secret is returned.

### F10-BACKOFF-01: timeout, rate limit, and operator alert

Use an approved provider sandbox or controlled HTTP test stub.

1. Return HTTP 429 with `Retry-After`, or trigger a bounded timeout/provider failure.
2. Run the connection sync.
3. Inspect Next sync/backoff and Connector alerts.
4. Repeat the same failure.
5. Restore the provider and run a successful sync.

Expected: rate-limit delay is at least the provider's `Retry-After`, other failures use bounded exponential backoff, repeated failures increment one open alert instead of creating alert spam, and successful sync resolves applicable alerts and clears failure state.

### F10-HEALTH-01: health checks and credential rotation

1. Run **Health check** on each configured test provider.
2. For a HubSpot/Pipedrive API-token connection, use **Replace client API token** and confirm the credential version increments without displaying either token.
3. For a client-owned OAuth connection, select **Reconnect OAuth** and authorize again.
4. Confirm the client OAuth app ID/secret remain stored but hidden after callback and automatic token refresh.
5. For Google Ads, rotate the webhook key and copy the one-time replacement.
6. Confirm the previous Google key is rejected and the new key works.
7. For Meta, rotate the Page token, app secret, and verification token, then repeat verification/signature tests.
8. Confirm MCP cannot create connections, accept raw credentials, start OAuth, or rotate credentials.

Expected: health state and safe message update; client API tokens have a dedicated replacement flow; OAuth connections reconnect through the provider; webhook rotations invalidate the prior secret; credential versions and audit events advance; credential material stays outside MCP.

### F10-SEC-01: connector security checks

1. For Salesforce or Zoho, try an unapproved destination hostname or Salesforce login origin.
2. Submit an incomplete client-owned OAuth form, a direct API token for Salesforce/Zoho, and both token and OAuth credentials in the same request.
3. Save a client-owned OAuth connection but do not authorize it; try to activate or schedule it through the normal action boundary.
4. Trigger a provider timeout or oversized response in a controlled test stub if available.
5. Inspect browser/API errors, server logs, audit events, import history, and MCP responses for credential material.

Expected: unsupported authentication combinations are rejected; pending OAuth connections cannot run before an access token exists; host allowlisting, request timeout, response limits, redaction, and generic errors prevent SSRF and secret leakage; no raw credential appears outside the encrypted envelope.

### F10-MCP-01: safe connector MCP tools

1. Run `tools/list` as a permitted administrator.
2. Confirm safe status, sync, schedule, health, and delete connector tools may appear.
3. Confirm there is no MCP tool that starts OAuth, accepts raw connector credentials, rotates secrets, or uploads spreadsheet bytes.
4. Call a safe sync/status/schedule/health tool for an existing test connection.

Expected: MCP can operate only on stored, authorized connection IDs, rechecks permissions from the session, and never receives or returns connector credential material.

## Feature 11 — Projects and tasks foundation

### F11-PROJECT-01: create internal and client projects

Account: project administrator.

1. Open `/projects`.
2. Open the Create project dialog and confirm it has a visible close button and Cancel action.
3. Close it with Escape, reopen it, close it by clicking the backdrop, and reopen it again.
4. Create internal project `<RUN_KEY> Internal operations`.
5. Confirm the dialog closes automatically and the new project becomes selected.
6. Create client project `<RUN_KEY> Acme delivery` linked to the CRM company from F09.
7. Confirm unique project codes are assigned.
8. Search by project name and code and filter by status and owner.

Expected: the dialog has explicit and keyboard dismissal paths, successful creation closes it, both project types persist, client association is correct, and project codes are unique.

### F11-PROJECT-02: project duplicate prevention

1. Try to create another active project with the same normalized name, type, and client context.
2. Try the same name under a different valid client/type context.

Expected: the exact duplicate context is rejected; a genuinely different context is allowed according to the validation rules.

### F11-PROJECT-03: edit project and manage members

1. Open the client project.
2. Change priority, status, visibility, owner, dates, or description and save.
3. Add the Project member account with a valid project role.
4. Refresh and confirm the member is listed.

Expected: authorized edits and membership changes persist and are audited.

### F11-TASK-01: create task and prevent duplicates

1. Create task `<RUN_KEY> Prepare discovery report` with status, priority, assignee, dates, and estimated effort.
2. Try to create another open task with the same normalized title in the same project.
3. Create the same title in a different project.

Expected: duplicate open title in one project is rejected; a separate project may use the title.

### F11-TASK-02: Kanban movement and completion

1. Move the task through at least two configured statuses.
2. Move it to a terminal/completed status.
3. Observe project progress and health.

Expected: the task appears in the selected column, transitions are audited, and project summary values update.

### F11-TASK-03: internal comment and time tracking

1. Add an internal comment to the task.
2. Log time against the task.
3. Log project-level time without selecting a task.
4. Refresh the project.

Expected: comments remain internal, actual-time totals update, and entries are tied to the active organization/member.

### F11-SCOPE-01: project visibility and assignment scope

Accounts: Owner and Project member.

1. As Owner, create one project visible/assigned to the Project member and one private unrelated project.
2. Sign in as Project member.
3. Confirm the assigned/visible project appears and the unrelated project does not.
4. Try direct URLs or MCP calls using the unrelated project ID from the owner test notes.

Expected: UI, server actions, RLS, and MCP enforce the same project scope.

### F11-MCP-01: project MCP tools

```js
await callMcp("tools/call", {
  name: "agencyos.projects.get_workspace",
  arguments: {
    q: "",
    status: null,
    owner: null,
    project: null,
  },
});
```

Then, when permitted, test create/update/member/task/move/comment/time tools using synthetic data.

Expected: safe structured content is returned, organization identity is session-derived, duplicate rules still apply, and unauthorized records cannot be targeted by ID.

## Feature 12 — Projects planning, collaboration, reporting, and lifecycle

### F12-SETUP-01: linked test-project and attachment prerequisites

1. Confirm the CLI is linked to the approved non-production PostgreSQL database.
2. Set `AUTH_ENCRYPTION_KEY` to that project's server-only secret key.
3. Run `npm run db:migrate` and `npm run db:test`; both commands explicitly use the configured PostgreSQL database.
4. Start AgencyOS with `npm run dev` for interaction tests and `npm run build && npm run start` for latency measurements.

Expected: all forward-only migrations through the project Stage 2 and trigger-contract migrations apply, transactional pgTAP passes, and the private `project-attachments` bucket exists.

### F12-PLANNING-01: phases and milestones

1. Open the client project from F11.
2. Create phase `<RUN_KEY> Discovery` and phase `<RUN_KEY> Delivery`.
3. Create milestone `<RUN_KEY> Discovery approved` linked to the Discovery phase.
4. Move a phase through planned, active, and completed.
5. Complete the milestone and refresh.

Expected: phase/milestone links and statuses persist, duplicate normalized names are rejected, and long names wrap without clipping.

### F12-COLLAB-01: multiple assignees, labels, and watchers

1. Add two active organization members to one task.
2. Remove one assignee and confirm the other remains.
3. Create labels `<RUN_KEY> Urgent`, `<RUN_KEY> Design`, and `<RUN_KEY> Backend`.
4. Try case/whitespace variants of the same label name.
5. Add and remove the current member as a watcher.
6. Try using a membership ID from another organization through a direct action/MCP call.

Expected: multiple assignees persist, normalized duplicate labels are rejected, watcher state persists, and cross-organization IDs are rejected by server validation and RLS.

### F12-COLLAB-02: checklist, subtasks, and parent-child links

1. Add one required and one optional checklist item.
2. Toggle each item complete and incomplete and refresh.
3. Create a child task linked to an existing parent.
4. Attempt to make a task its own parent or create a parent cycle.
5. Leave required work incomplete and try a guarded completion/closure path.

Expected: checklist state persists, required items enforce the documented guard, valid hierarchy is shown, and self/cyclic hierarchy is rejected.

### F12-DEPENDENCY-01: dependency relationships and cycles

1. Create tasks A, B, and C.
2. Add `A blocks B`, `B blocks C`, `A related to C`, and one duplicate/parent relationship.
3. Try `C blocks A`, `A blocks A`, and a dependency to a task in another project.
4. Remove a dependency from its displayed incoming and outgoing views.

Expected: valid canonical relationships appear with reverse labels such as Blocked by/Child of, cycles and self-links fail, and cross-project dependencies are rejected.

### F12-RECURRENCE-01: recurring task idempotency

1. Configure daily, weekly, or monthly recurrence with a valid next-run date.
2. Complete or trigger the recurrence flow once.
3. Repeat the same operation or submit from two tabs.
4. Pause recurrence and complete the next occurrence.
5. Try an end date before the next-run date and an out-of-range interval.

Expected: exactly one next occurrence is created per due recurrence, it links to its template, paused recurrence creates nothing further, and invalid ranges fail safely.

### F12-FILE-01: private attachment allowlist and duplicate prevention

1. Upload small PNG, JPEG, PDF, TXT, and CSV files to a task.
2. Download each file and confirm attachment response headers.
3. Upload the exact same bytes again to the same task.
4. Try an empty file, a file over 10 MB, executable/HTML/JavaScript content, and a file renamed to an allowed extension with incompatible content.

Expected: allowlisted files upload privately, duplicate hashes, empty/oversized/unsafe/mismatched files fail, and public errors disclose no storage path, key, SQL detail, or stack trace.

### F12-FILE-02: attachment authorization and read-only enforcement

1. Copy an attachment download URL as the project administrator.
2. Open it as a user outside the project scope and as a user from another organization.
3. Close or archive the project, then try upload and delete using a stale open page.
4. Restore the archived project and delete the attachment as an authorized user.

Expected: unauthorized downloads fail, closed/archived server mutations fail even from stale UI, and authorized mutation resumes only after valid restore.

### F12-VIEW-01: list, calendar, timeline, workload, and reports

1. Create tasks with varied dates, phases, milestones, statuses, assignees, estimates, and tracked time.
2. Switch between Kanban, List, Calendar, Timeline, and Reports.
3. Compare task counts and project totals in every view.
4. Sign in as a member without time-view permission.

Expected: all views use the same scoped records, dates/counts agree, overdue/progress/workload values are consistent, and restricted time data is not disclosed.

### F12-LIFECYCLE-01: closure guards and permanent read-only state

1. Request closure with open tasks or incomplete required closure items.
2. Complete/cancel all tasks, complete required checks, add closure notes, and request closure.
3. Finalize closure.
4. From a stale tab, try editing project fields, tasks, phases, milestones, labels, comments, time, dependencies, recurrence, and attachments.

Expected: premature closure fails, valid closure sets completed/closed state, and all later mutations are rejected by server/database enforcement rather than UI alone.

### F12-LIFECYCLE-02: archive, filters, and restore

1. Archive an open test project.
2. Verify Active, Archived, and All filters.
3. Try a mutation through a stale page or direct action.
4. Restore the project.

Expected: archive visibility is correct, archived projects are read-only, restore retains the same ID/code/history, and an open restored project becomes editable again.

### F12-DATABASE-01: identity and trigger contract regression

1. Run `npm run db:check`.
2. Run `npm test -- tests/unit/projects-permission-contract.test.ts tests/unit/projects-ui-contract.test.ts`.
3. Create a uniquely named project after all linked-project migrations have been applied.
4. Inspect logs for SQLSTATE `42703`, `public.user_profiles`, or membership email-column references.

Expected: runtime SQL references only existing canonical tables/columns, shared triggers support every attached table, project creation seeds statuses/closure items, and no missing-column/relation error occurs.

### F12-LATENCY-01: warm production request measurements

1. Run `npm run build && npm run start`.
2. Warm `/projects`, `/settings`, `/settings/users`, `/settings/roles`, and `/favicon.ico` once.
3. Record five document timings per page in browser DevTools.
4. In a controlled test window, interrupt network access to the configured database and retry `/projects` once, then restore connectivity and use Retry request.

Expected: warm requests do not hang for tens of seconds, favicon is static, database failures are bounded and retryable, and there is no unbounded duplicate query/retry loop.

### F12-BROWSER-MCP-01: browser automation flow

Using the browser MCP or equivalent local browser automation:

1. Open `/projects` and click Create project.
2. Assert the dialog role/name, Close dialog button, and Cancel button.
3. Press Escape and assert the dialog is gone.
4. Reopen, create an internal project, and wait for the selected project URL/query to update.
5. Exercise one phase, milestone, assignee, watcher, checklist, dependency, recurrence, attachment, alternate-view, closure, archive, and restore action.
6. Capture console errors and failed requests.

Expected: the full workflow is keyboard-operable, success closes the create dialog, permission boundaries remain consistent, and no uncaught console/runtime error occurs.

## Feature 13 — Shared platform services (initial increment)

### F13-ERROR-01: root global error boundary

1. Run `npm test -- tests/unit/projects-ui-contract.test.ts`.
2. In a local-only branch or controlled fault injection, throw from the root layout or a provider above the workspace error boundary.
3. Confirm the root error page renders and use Retry page after removing the fault.
4. Inspect rendered text, HTML, browser console, and server response.

Expected: a generic retryable error page renders with its own document shell, and it never displays `error.message`, stack traces, SQL, environment values, credentials, or private payloads.

### F13-NOTIFICATIONS-01: in-app center and unread count

1. Apply migration `20260714001300_shared_notifications.sql`, restart AgencyOS, and sign in as a member with notification view/update permissions.
2. Cause a CRM connector health or synchronization failure for a connection created by that membership.
3. Confirm the top-bar bell shows a real unread count and opens `/notifications`.
4. Confirm the integration alert shows its category, safe message, occurrence count, in-app delivery state, and `/crm?tab=imports` deep link.
5. Repeat the same connector failure and refresh.
6. Mark the item read, then create another alert and use Mark all read.

Expected: the same unread dedupe key increments one notification instead of creating alert spam, unread counts update after read actions, and no external URL, token, stack trace, SQL, or provider payload appears.

### F13-NOTIFICATIONS-02: preferences and recipient isolation

1. Open Notification preferences. Disable Integration failures, save, and reload.
2. Confirm integration-failure records are hidden from the center and unread count while other enabled categories remain available.
3. Re-enable the category and confirm existing records become visible again.
4. Save daily/weekly/no-digest values, email preference, and quiet-hour start/end values; reload and confirm persistence.
5. Sign in as a second membership in the same organization and then a membership in another organization.
6. Attempt direct reads and read-state updates using a copied notification ID.

Expected: preferences are private to the membership, malformed time/digest values are rejected, recipients cannot read or mutate another member's notifications, and cross-organization data is never disclosed.

### F13-NOTIFICATIONS-03: database and UI contracts

1. Run `npm run db:check`.
2. Run `npm test -- tests/unit/notifications.test.ts tests/unit/notifications-ui-contract.test.ts`.
3. Against the dedicated non-production PostgreSQL database, run `npm run db:test -- database/tests/shared_notifications.test.sql` or the full `npm run db:test`.
4. Inspect `public.notifications` and `public.notification_deliveries` grants and policies.

Expected: recipient and retry indexes exist, tenant triggers reject mismatched memberships, authenticated clients cannot forge notification/delivery rows, and only the recipient can select or update read state.

### F13-NOTIFICATIONS-04: browser-MCP and tool-boundary checks

1. Sign in as a member with notification view permission only and call `tools/list`.
2. Confirm `agencyos.notifications.get_center` is present while mark-read tools are absent.
3. Grant notification update permission, refresh the MCP session, and confirm `agencyos.notifications.mark_read` and `agencyos.notifications.mark_all_read` appear.
4. Call the read tool with `status=unread`, then mark one returned ID read.
5. Try a notification ID belonging to another membership and try unknown categories or an external deep-link argument.

Expected: MCP returns only notifications for the active membership, mutation tools require update permission, foreign IDs fail safely, no notification-creation or arbitrary-link tool exists, and no delivery secrets or private provider payloads are exposed.

### F13-NOTIFICATIONS-05: recipient-scoped foreground refresh

1. Start AgencyOS and sign in as recipient A with the workspace shell visible.
2. Keep /notifications open in one browser window without manually refreshing.
3. In a second signed-in session, create an approval request or another supported event addressed to recipient A.
4. Confirm the notification list and top-bar counters refresh on the bounded foreground interval or immediately after focus/online recovery.
5. Mark a notification read in a second tab, then focus the first tab and confirm its unread count refreshes without a full-page reload.
6. Create notifications for recipient B and another organization and confirm recipient A never sees those records.
7. Disable and restore the network, return focus to the tab, and confirm the bounded resync catches missed changes.
8. Run npm test -- tests/unit/notification-realtime-contract.test.ts tests/unit/linked-database-safety.test.ts.

Expected: notification refresh uses only same-origin AgencyOS counter/data routes, no hosted database Realtime client or provider publication exists, recipient authorization remains server/database enforced, and focus/network recovery catches missed changes without opening provider-specific subscriptions.

### F10-UI-02: Salesforce and Meta connector-field alignment

1. Open `/crm?tab=imports` at 1440, 1024, 820, and 680 pixel widths.
2. Select Salesforce with client-owned OAuth and inspect app ID, app secret, login environment, instance URL, API version, sync interval, and helper text.
3. Select Meta Lead Ads and inspect Page token, app secret, verify token, Graph API version, and helper text.
4. Tab through every control and zoom the browser to 125%.

Expected: labels reserve consistent space, controls share a horizontal baseline within each row, helper text stays below its control, long copy wraps without overlap, and the single-column mobile layout removes unnecessary reserved height.

## Cross-feature regression suite

Run these after every feature touching authorization, shared UI, database policies, or MCP.

### R01: owner smoke test

1. Sign in as Owner.
2. Open `/dashboard`, `/crm`, `/projects`, and every available settings route.
3. Confirm no unexpected console errors or failed server requests.
4. Confirm the sidebar and command palette agree.

### R02: restricted-user smoke test

1. Sign in as Restricted.
2. Confirm hidden modules are absent from navigation.
3. Try direct URLs for hidden modules.
4. Run `tools/list` and compare it with visible capabilities.

### R03: responsive and keyboard test

1. Test changed pages at 1440, 1024, and 768 widths.
2. Complete the primary action using keyboard only.
3. Confirm visible focus, readable errors, no clipped text, and no overlapping controls.

### R04: duplicate and idempotency test

For every new record or intake flow:

1. Repeat the same normalized input.
2. Repeat the same external event/delivery ID when applicable.
3. Attempt simultaneous submissions in two tabs when practical.

Expected: the documented reject, skip, merge, or idempotent result occurs; no silent duplicate is created.

### R05: audit and secret-redaction test

1. Perform one state change in each changed module.
2. Inspect audit events, browser console, server/API response, and user-visible errors.

Expected: useful metadata is present; passwords, tokens, connector credentials, webhook secrets, private payloads, and stack traces are absent.

## Future feature test-documentation requirement

A future feature is not complete until its change set includes all of the following:

- Updated credential/API/webhook requirements at the top of this file.
- Automated unit and database tests where applicable.
- Manual happy-path steps.
- Manual invalid, unauthorized, duplicate, and stale/concurrent steps.
- Browser-MCP steps using accessible selectors and visible UI interactions.
- Responsive and keyboard checks for changed interfaces.
- Expected audit events and secret-redaction checks.
- Cleanup instructions and safe test-data naming.
- Updated `TASK.md` checkboxes only after the implementation and tests exist.
- Test steps summarized in the delivery chat so a human can verify immediately.

## Feature 13 external notification delivery workers

### Required test configuration

Configure only the channel being tested. Keep all values server-only.

```env
INTERNAL_WORKER_SECRET=<at-least-32-random-characters>
RESEND_API_KEY=re_non_production_test_key
NOTIFICATION_EMAIL_FROM=AgencyOS <notifications@verified-test.example>
NOTIFICATION_DELIVERY_ENCRYPTION_KEY=<base64-or-hex-32-byte-key>
NOTIFICATION_VAPID_PUBLIC_KEY=<generated-public-key>
NOTIFICATION_VAPID_PRIVATE_KEY=<generated-private-key>
NOTIFICATION_VAPID_SUBJECT=mailto:notifications@example.test
```

Generate push keys with `npm run notifications:vapid`. Apply the migration with `npm run db:migrate`, restart the app, and invoke the bounded worker with:

```bash
curl -i -X POST "$APP_URL/api/internal/workers/run" \
  -H "Authorization: Bearer $INTERNAL_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"job":"notifications"}'
```

### F13-DELIVERY-01 — Worker authorization and bounds

1. Call the worker from a shell without browser cookies and without a bearer token, then with an incorrect token. Expect `401`, never a `307` redirect to `/login`, and no delivery changes.
2. Call it with the configured token. Expect a no-store JSON summary.
3. Create more than 40 due deliveries and run it once. Confirm no more than 40 are claimed.
4. Start two worker requests together. Confirm `FOR UPDATE SKIP LOCKED` prevents duplicate claims.
5. Confirm provider failures retry with bounded delay and stop after six attempts.

### F13-DELIVERY-02 — Resend email delivery

1. Enable email delivery in `/notifications`, choose individual, daily, and weekly timing in separate runs, and create synthetic notifications.
2. Confirm requests go only to `https://api.resend.com/emails` and the Resend API key remains server-only.
3. Confirm recipient email, escaped title/message, safe AgencyOS link, and idempotency key are present.
4. Simulate `429` with `Retry-After`, then a `5xx`, then a permanent `4xx`. Confirm retry, exponential backoff, and suppression behavior.
5. Confirm Resend response bodies are bounded and never displayed to users or written to `last_error_message`.

### F13-DELIVERY-03 — Browser push

1. Open notification preferences in a supported browser and enable push. Confirm the browser permission prompt appears and the page reports an active device.
2. Inspect the database through an approved admin tool: the endpoint and keys must be encrypted, while only a SHA-256 endpoint hash is searchable.
3. Create a notification and run the worker. Confirm the push request contains no notification title, message, link, token, or other payload.
4. Confirm the service worker fetches `/api/notifications/push/latest` with the current session and displays only that recipient's latest unread notification.
5. Sign out or use another user and call the latest route. Confirm no notification data is returned.
6. Disable push and confirm the subscription is revoked. A `404` or `410` from the push service must also revoke it.
7. Try an endpoint outside the FCM, Mozilla, Apple, and Windows push hosts. Confirm it is rejected.

### F13-DELIVERY-05 — Preferences, quiet hours, UI, and isolation

1. Disable one category and confirm it is neither listed nor externally scheduled.
2. Disable each channel and confirm pending work is suppressed when the worker rechecks preferences.
3. Set quiet hours around the current UTC time. Confirm external work is deferred until the quiet-hours end.
4. Verify delivery chips show in-app, email, and browser-push state without exposing error bodies.
5. Test `/notifications` at 1440, 1024, 768, and 680 pixels. Channel cards, helper text, buttons, and quiet-hour fields must align and wrap without horizontal page scrolling.
6. Use two organizations and two recipients. Confirm subscriptions, latest-push data, delivery rows, and preference changes cannot cross recipient or organization boundaries.

## F13 — Shared approval engine

Use only the approved non-production configured PostgreSQL database. Apply `20260714001500_shared_approval_engine.sql` with `npm run db:migrate`, restart AgencyOS, and sign in with at least these accounts:

- Owner or Operations Administrator: policy administration and organization-wide visibility.
- Manager: active membership with `approvals.request.approve`, `reject`, and `reassign` at assigned scope.
- Employee A: request creator with a manager.
- Employee B: second eligible approver for parallel and delegation tests.
- Restricted employee: no organization-wide approval visibility.

Configure the worker secret in `.env.local`:

```env
INTERNAL_WORKER_SECRET=<separate-long-random-secret>
```

Generate it with `openssl rand -hex 32`. Invoke the bounded timer worker with:

```bash
curl -i -X POST "$APP_URL/api/internal/workers/run" \
  -H "Authorization: Bearer $INTERNAL_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"job":"approvals"}'
```

### F13-APPROVAL-01 — Route, navigation count, and responsive UI

1. Open `/approvals` as the Owner and create at least one pending request assigned to that account.
2. Confirm the sidebar/header approval badge uses the real pending-assignment count and changes after a decision or reassignment.
3. Test the workspace, policy dialog, request dialog, delegation dialog, request cards, snapshot, history, filters, and pagination at 1440, 1024, 768, and 680 pixels and at 125% browser zoom.
4. Open and close every dialog using its Close button, Cancel, Escape, and backdrop click.
5. Use only the keyboard to create a policy and make a decision.

Pass when labels and fields align, long role/member/policy names wrap without clipping, dialogs remain within the viewport, focus is visible, there is no page-level horizontal scrollbar, and the count never exposes another user's assignments.

### F13-APPROVAL-02 — Policy creation, versioning, and retirement

1. Create a policy with key `test_purchase_approval`, source module `procurement`, and entity type `purchase_request`.
2. Add a Stage 1 manager step, two Stage 2 role/named-member steps, and a Stage 3 finance role step.
3. Give the two Stage 2 steps the same stage number to make them parallel. Test both `Any approver` and `Every approver` policies.
4. Configure comment requirement, reminder, escalation, and expiry values.
5. Try duplicate active keys, malformed keys, more than 20 steps, invalid role/member selectors, maximum amount below minimum amount, escalation before reminder, and invalid timer ranges.
6. Retire the policy, then recreate the same key with different steps.

Pass when invalid policies are rejected without partial rows, the retired policy remains readable for historical requests, the recreated policy receives a higher version, and existing requests retain their original policy version and route.

### F13-APPROVAL-03 — Conditions and approver resolution

Create separate requests that exercise:

- Amount below, inside, and above configured ranges.
- Matching and non-matching department conditions.
- Requester manager selector.
- Role selector with one and multiple eligible members.
- Named-member selector.
- A role member who is inactive or lacks `approvals.request.approve`.
- A requester without a manager when the policy requires one.

Pass when only matching steps are materialized, inactive/unpermitted members are excluded, submission fails atomically when no eligible approver exists, and no cross-organization member can be selected or resolved.

### F13-APPROVAL-04 — Sequential and parallel decisions

1. Submit a request with Stage 1 followed by parallel Stage 2 steps and a final Stage 3 step.
2. Confirm only Stage 1 is pending initially; later stages must be waiting and must not accumulate reminder/expiry time while waiting.
3. Approve Stage 1 and confirm all applicable Stage 2 steps activate together.
4. For an `any` stage, approve one assignment and confirm sibling assignments become skipped and Stage 3 activates once.
5. For an `all` stage, approve only one assignment and confirm the stage remains pending until every assignment approves.
6. Submit simultaneous decisions from two browser sessions or API calls.

Pass when row locking prevents double progression, exactly one request-level transition is recorded, no next stage activates twice, and the complete action history remains ordered and append-only.

### F13-APPROVAL-05 — Rejection, revision, comments, cancellation, and invalidation

1. Try to decide a comment-required step without a comment.
2. Reject a pending step with a reason.
3. Submit another request and request revision with a comment.
4. Cancel a pending request as its requester; then try cancellation as an unrelated member.
5. Use a module integration or approved test helper to invalidate a pending request after changing the source record materially.
6. Try editing or deleting an existing `approval_actions` row through SQL as an authenticated client.

Pass when comments are enforced, rejection/revision terminates or returns the request exactly as designed, only authorized requesters/admins can cancel, invalidation notifies the requester, request snapshots remain unchanged, and action history cannot be updated or deleted.

### F13-APPROVAL-06 — Self-approval and permission enforcement

1. Create a policy with self-approval disabled and route it to a role or named member that includes the requester.
2. Submit as that requester.
3. Repeat with self-approval enabled.
4. Add an explicit active Deny override for `approvals.request.approve` to an Owner or manager and retry.
5. Remove `approvals.request.view`, approve, reject, reassign, and policy-management permissions one at a time.
6. Keep an old approval page open, remove permission in another session, then submit the stale form.

Pass when self-assignment is excluded or submission fails safely when disabled, self-approval works only when explicitly allowed, explicit Deny overrides role grants, every server action reauthorizes at execution time, and stale UI cannot bypass current permissions.

### F13-APPROVAL-07 — Delegation and reassignment

1. Create a future/active delegation from Manager A to Manager B for all modules, then a module-specific delegation.
2. Try self-delegation, cross-organization delegation, an inactive/unpermitted delegate, an end before start, more than 366 days, and overlapping active windows.
3. Submit requests before, during, and after the delegation window.
4. Confirm delegation affects only newly materialized assignments and retains the original approver in `delegated_from` history.
5. Reassign a pending step to another eligible approver with a reason.
6. Try reassignment when the policy disallows it, to the requester when self-approval is disabled, or by an unrelated user.
7. Submit two overlapping delegation creations concurrently.

Pass when advisory locking prevents overlapping races, delegation timing/module filters are respected, old requests are not silently rerouted, reassignment resets reminder/escalation timers, and every routing change is audited.

### F13-APPROVAL-08 — Reminder, escalation, request expiry, and worker safety

1. Call `/api/internal/workers/run` without a token and with the wrong token; expect `401` and no changes.
2. Create short-lived test steps and advance test timestamps so reminder, escalation, step expiry, request due expiry, and delegation expiry are due.
3. Run two worker requests concurrently.
4. Deactivate an organization/member or remove approval permission before processing.
5. Re-run the worker after the same events have been processed.

Pass when each run is bounded, concurrent workers do not duplicate actions or notifications, reminders increment once per due interval, escalation is recorded once, expired requests/steps cannot be decided, inactive or unauthorized assignees are not notified, stale locks recover safely, and repeated runs are idempotent.

### F13-APPROVAL-09 — Snapshot and deep-link security

Submit requests containing:

- The same JSON object with different property order.
- A snapshot over 64 KB.
- More than 20 nested levels.
- More than 5,000 values.
- Circular references through the server integration test.
- `NaN`, `Infinity`, Date/class instances, functions, or other non-JSON values.
- Keys such as `password`, `clientSecret`, `access_token`, `refresh-token`, `apiKey`, `privateKey`, `authorization`, `cookie`, or `sessionToken`.
- External, protocol-relative, backslash, control-character, and JavaScript deep links.

Pass when equivalent snapshots hash identically, every unsafe snapshot is rejected before persistence, no secret-like value enters logs/audit/notification/MCP output, and only one safe internal root-relative path is accepted.

### F13-APPROVAL-10 — RLS, scope, and tenant isolation

1. Submit requests in Organizations A and B.
2. As a normal employee, verify only requests submitted by or assigned to that membership appear.
3. As an Auditor/Owner with organization scope, verify organization-wide requests appear only in that organization.
4. Test assigned, assigned-or-created, and organization permission scopes plus an explicit Deny override.
5. Copy request, step, action, definition, and delegation identifiers between users and organizations and query them directly through the authenticated legacy database CLIent.

Pass when no definition, snapshot, amount, requester, approver, action, or delegation crosses organization or recipient scope, and authenticated clients have read-only access to approval tables while service-side actions remain authoritative.

### F13-APPROVAL-11 — Duplicate submission and concurrency

1. Submit the same organization/source-module/entity-type/entity-id while a request is pending from two browser sessions at the same time.
2. Repeat after the first request reaches a terminal state.
3. Create and retire/recreate the same policy key concurrently.

Pass when the partial unique index allows only one pending request, callers receive a safe duplicate message, terminal history allows a later new request, and policy versions remain unique and monotonic.

### F13-APPROVAL-12 — Notifications, audit, and MCP

1. Confirm assigned approvers receive one deduplicated `approval_requested` notification with a safe `/approvals` deep link.
2. Confirm requester/participants receive `approval_decision`, cancellation, invalidation, reminder, escalation, and expiry notifications only when relevant and enabled by preference.
3. Inspect audit events for policy creation/retirement, request submission, decisions, reassignment, cancellation, invalidation, delegation, and expiry. Sensitive snapshots or comments must not be duplicated into unsafe metadata.
4. With only view/create permissions, call MCP workspace and submit tools. Confirm decision/reassign/cancel tools remain unavailable without their exact permission.
5. Try using MCP to manage definitions/delegations, insert arbitrary history, read another tenant, or submit credential-like snapshots.

Pass when MCP exposes only the registered safe operations, reauthorizes the current session, never returns hidden snapshots or another tenant's requests, and produces the same audit/notification behavior as the UI.

### F13-APPROVAL-13 — Latency and query behavior

1. Seed at least 50 policies, 500 requests, 2,000 request steps, and 5,000 actions in a disposable database.
2. Warm `/approvals`, then record five production-mode document requests for inbox, submitted, all, status, search, and pagination filters.
3. Inspect database query logs for N+1 member/profile/step/action lookups.
4. Run the timer worker with more due rows than its batch limit.

Pass when request pagination remains bounded, member/profile/action data are batched, later waiting stages are not processed, worker scans use the due indexes, no page hangs for tens of seconds, and errors fail within configured database/network timeouts.

### F13-APPROVAL-14 — Automated checks

Run:

```bash
npm run verify
npm run db:migrate
npm run db:test
```

Also run focused tests:

```bash
npm test -- tests/unit/approvals.test.ts
npm test -- tests/unit/approvals-ui-contract.test.ts
npm test -- tests/unit/mcp-tool-registry.test.ts
```

The database suite must verify table/column/index/trigger/policy/grant contracts, immutable snapshots, append-only actions, tenant validation, permission scopes, duplicate-pending protection, and timer-worker indexes.

## Verification artifact isolation

### VERIFY-NEXT-01 — Stale or concurrently written `.next/dev/types` files

This test confirms that source typechecking is deterministic even when a development server has left a stale or partially written Next.js validator behind.

1. Start `npm run dev` and allow at least one application route to compile.
2. In a second terminal, run `npm run typecheck` while the development server remains active.
3. Repeat the typecheck while refreshing a route that causes Next.js to regenerate route types.
4. Stop the development server and run `npm run verify`.

Pass when:

- `npm run typecheck` reads `tsconfig.verify.json` and does not parse `.next/dev/types/validator.ts`.
- A stale or partially generated `.next/dev/types` file cannot fail source typechecking.
- Source, test, Next config, and Vitest config TypeScript errors still fail the command.
- `npm run build` still performs Next.js route and generated-type validation during the full verification run.
- No verification step deletes a running development server's `.next` directory.

For a one-time cleanup after an interrupted Next.js process, it is safe to run:

```bash
rm -rf .next
npm run verify
```

## Notification preference save regression

### F13-NOTIFICATION-PREFERENCES-01 — Save, permission repair, and safe diagnostics

1. Apply migration `20260714001600_notification_preference_contract_repair.sql` with `npm run db:migrate`.
2. Sign in with an Owner or another migration-managed default role and open `/notifications`.
3. Change at least one category, digest mode, and quiet-hours setting, then save and refresh.
4. Confirm the normalized settings persist and a second save updates the same `user_preferences` row rather than creating a duplicate.
5. Enable browser push on one device, then disable it, and confirm both operations update `browserPushEnabled` without violating `user_preferences_notification_object`.
6. Trigger a notification with metadata and confirm `notifications_metadata_object` remains satisfied.
7. Remove `notifications.preference.manage_settings` from a disposable custom role, sign in through that role, and retry.
8. Temporarily test against a disposable database missing a required preference column or grant.
9. Interrupt the database connection during one save and restore it before the bounded retry finishes.

Pass when default system roles can save after the forward permission repair, every notification JSON write uses the PostgreSQL client's JSON serializer rather than a pre-stringified value, custom roles remain unchanged, a denied role receives a clear permission message, database-contract failures produce a safe actionable message plus structured server metadata without preference values or secrets, transient infrastructure errors are retried at most once, and successful saves replace the complete normalized preference document atomically.

## F13 — Shared private-file lifecycle and malware scanning

Before these tests, start local MinIO and verify the private buckets:

```bash
docker compose --env-file .env.local -f compose.minio.yaml up -d
npm run storage:setup
npm run storage:check
```

Existing installations must already have completed the historical one-time move of object bytes into MinIO. Current AgencyOS has no hosted-storage runtime or migration command.

These checks use an explicitly configured disposable PostgreSQL test database. Apply only forward migrations:

```bash
npm run db:migrate
npm run db:test
```

Database resets are prohibited. AgencyOS uses forward-only migrations against the explicitly configured disposable PostgreSQL database, and the reset package script is a hard failure.

### F13-FILES-01 — Scanner and worker setup

1. Generate `INTERNAL_WORKER_SECRET` with `openssl rand -hex 32`.
2. Start the bundled official ClamAV container with `npm run scanner:start` and wait for its signatures to load.
3. Configure `PRIVATE_FILE_SCANNER_URL=clamav://127.0.0.1:3310` and leave `PRIVATE_FILE_SCANNER_BEARER_TOKEN` blank.
4. Run `npm run scanner:check`, apply migration `20260714001800_shared_private_files.sql` with `npm run db:migrate`, and restart AgencyOS.
5. Call `POST /api/internal/workers/run` with `{"job":"private-files"}` using the correct bearer token, no token, a wrong token, and a browser session cookie without the bearer token.

Pass when ClamAV answers `PONG`, the correct worker call returns a bounded summary, wrong or missing worker tokens return `401`, the route is never redirected to `/login`, missing scanner configuration returns `503`, and no file bytes or daemon response appears in browser/server errors.

### F13-FILES-02 — Quarantine before release

1. Open a writable project task and upload a valid PNG, JPEG, PDF, TXT, and CSV below 10 MB.
2. Before running the worker, confirm every attachment shows `Queued for scan` and has no download link.
3. Attempt the attachment download URL directly before scanning.
4. Inspect the linked test database and storage metadata through trusted admin tooling.
5. Run the scan worker against a scanner that returns a clean verdict.

Pass when new objects exist only in the local private MinIO `private-file-quarantine` bucket as `application/octet-stream`, download returns `409` before release, a clean verdict copies the exact bytes to the private `private-files` bucket, the project UI changes to `Available`, and the quarantine copy is removed or queued for bounded cleanup without deleting the released copy.

### F13-FILES-03 — File admission boundaries

1. Try an empty file, a file above 10 MB, missing/invalid `Content-Length`, and a multipart request above the bounded overhead.
2. Try `.exe`, `.dll`, `.bat`, `.cmd`, `.ps1`, `.sh`, `.js`, `.html`, `.svg`, `.jar`, and misleading double-extension names.
3. Submit a fake PNG/JPEG/PDF, binary data as TXT/CSV, HTML/script text as TXT, and a PDF containing active JavaScript markers.
4. Submit a valid file with traversal/control characters in the displayed name.

Pass when unsafe inputs fail before storage, valid names are normalized for display, storage keys contain only organization/file/random identifiers rather than the original name, and errors reveal no storage key, SQL text, stack, or secret.

### F13-FILES-04 — Malware and integrity rejection

1. Configure the scanner with its harmless antivirus test fixture and upload that fixture through an allowed test file format.
2. Run the worker and inspect the project UI, notification center, file row, lifecycle events, and storage.
3. In a disposable test row/object, alter the stored bytes after metadata creation so the size or SHA-256 no longer matches.
4. Run the worker again.

Pass when infected, size-mismatched, and checksum-mismatched files become `rejected`, never receive a released storage path, cannot be downloaded, enqueue one recipient-only security alert, append a rejection event without file bytes, and purge the quarantine object.

### F13-FILES-05 — Retry, stale locks, and exhaustion

1. Stop ClamAV, point the scanner URL at a closed local port, make the daemon close the connection, and test an oversized or malformed daemon response with a disposable local stub.
2. Run the worker repeatedly and inspect attempt counts and `next_scan_at`.
3. Create a stale `scanning` lock older than five minutes in the disposable linked test project, then run the worker.
4. Continue failures through the maximum attempt count.

Pass when responses are capped at 8 KiB, calls time out after 20 seconds, retries use bounded exponential scheduling, stale locks recover, attempts never exceed five, exhausted files remain quarantined and unavailable with retention hold, and the uploader receives one deduplicated security alert. If the optional HTTPS scanner-adapter mode is tested, redirects must be rejected and `Retry-After` must remain bounded.

### F13-FILES-06 — Duplicate and concurrent uploads

1. Upload the same bytes twice to the same task before the first copy is scanned.
2. Race two upload requests with the same task and bytes.
3. After a clean release, upload the exact bytes again.
4. After a malware rejection, upload the exact bytes again.
5. Upload the same bytes to a different task.

Pass when one active file exists per organization/module/entity/checksum, races produce no orphaned object, pending/available duplicates return a safe duplicate message, rejected duplicates remain blocked, and a different linked task may own its own file record.

### F13-FILES-07 — Authorization and tenant isolation

1. Test task viewers, task editors, unrelated project members, users outside project scope, suspended memberships, and another organization.
2. Copy an available download URL, then remove the viewer's permission or project membership and retry without signing out.
3. Close/archive the project and test download versus upload/delete rules.
4. Tamper with attachment, private-file, task, project, membership, and organization UUIDs.

Pass when every operation reauthorizes the current session and organization, permission changes revoke access immediately, closed/archived projects remain readable only where existing project rules allow but cannot be mutated, cross-tenant IDs return safe `403`/`404`, and direct authenticated access to `private_files` and `private_file_events` is denied, MinIO has no anonymous bucket policy, and direct unauthenticated object requests fail.

### F13-FILES-08 — Safe download and append-only evidence

1. Download a clean image, PDF, TXT, and CSV through the application route.
2. Inspect response headers and verify the browser downloads rather than renders the object inline.
3. Confirm one `file.downloaded` lifecycle event and project audit event are appended with actor/tenant/file identifiers but no file bytes.
4. Attempt to update or delete lifecycle history and hard-delete the private-file row directly as trusted test SQL inside a transaction.

Pass when responses use `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Download-Options: noopen`, and sandbox CSP; event updates/deletes and private-file hard deletion fail; and audit/event queries remain tenant bounded.

### F13-FILES-09 — Delete and object cleanup

1. Delete an attachment while it is quarantined, scanning, available, rejected, and scan-failed.
2. Simulate storage deletion failure and run the scan worker later.
3. Repeat deletion from stale tabs and concurrent requests.

Pass when the business link is removed atomically, the shared file becomes `deleted`, later downloads return `404`, available/quarantine objects are removed immediately or through the purge-due retry, repeated requests are idempotently safe, and cleanup never deletes another file's random object key.

### F13-FILES-10 — Legacy project attachment backfill

1. Before applying the migration in a disposable configured PostgreSQL database, create project attachments through the previous implementation.
2. Apply `20260714001800_shared_private_files.sql` with `npm run db:migrate`.
3. Verify each old attachment has one `private_file_id`, an available shared-file row, and its original private `project-attachments` object remains downloadable through the authorized route.
4. Test an attachment on a closed or archived project during migration.

Pass when backfill succeeds without temporarily reopening projects, existing IDs/checksums/metadata remain stable, legacy rows are marked `legacy-content-validation`, and all new uploads use quarantine.

### F13-FILES-11 — UI behavior and latency

1. Upload a file and leave the task panel open while the one-to-five-minute worker schedule runs.
2. Keep the tab visible, then hidden, and observe refresh behavior.
3. Upload several files rapidly and run a batch larger than 20 due rows.
4. Measure upload admission, project page load, worker runtime, and failure response time.

Pass when pending status is visible immediately, the open visible task refreshes at most every five seconds and stops after 24 attempts, hidden tabs do not poll, only 20 rows are claimed per run with concurrency two, project queries batch attachment/file status without N+1 calls, and scanner/provider failures return within configured bounds.

### F13-FILES-12 — Automated contracts

Run:

```bash
npm test -- tests/unit/private-files.test.ts tests/unit/minio-storage.test.ts tests/unit/minio-runtime-contract.test.ts
npm test -- tests/unit/private-file-worker-contract.test.ts
npm test -- tests/unit/project-private-file-contract.test.ts
npm test -- tests/unit/project-attachments.test.ts
npm test -- tests/unit/internal-worker-proxy-contract.test.ts
npm run verify
npm run db:test
```

The linked pgTAP suite must verify private tables, required columns, partial worker indexes, tenant/lifecycle/append-only triggers, project linkage, RLS, grants, and private bucket contracts. Verification must not invoke any database reset command.

## F13-AUTOMATION — Internal automation execution and Vaultwarden item links

### F13-AUTO-01 — Single worker boundary

1. Generate `INTERNAL_WORKER_SECRET` with `openssl rand -hex 32` and set the same value in the application and worker process.
2. Start the web application, then run `npm run worker -- --once`.
3. Call `POST /api/internal/workers/run` with JSON bodies for each fixed job key: `notifications`, `automation`, `private-files`, `approvals`, `crm-sync`, `finance-overdue`, and `reports`.
4. Confirm missing, malformed, or incorrect bearer tokens return `401`; unknown job keys return `400`; oversized or lengthless bodies are rejected.
5. Confirm the endpoint does not accept URLs, SQL, function names, organization IDs, or arbitrary executable input.

Pass when one secret protects one bounded worker endpoint and every job retains its own Redis lease, database claim, retry, and batch limits.

### F13-AUTO-02 — Registered automation handlers

1. Open `/automation` as an authorized owner.
2. Create a definition with a supported trigger, allowed source module, conditions, and either `notification.owner` or `notification.event_actor`.
3. Trigger the matching business event and run the automation job.
4. Confirm exactly one dispatch is created, the registered handler executes, an execution event is appended, and the notification recipient matches the selected handler.
5. Confirm a disabled definition, mismatched source module, failed condition, unknown legacy handler, or foreign-organization event does not execute.
6. Force a retryable failure and verify bounded backoff, immutable attempt history, and eventual dead-letter state after the maximum attempts.
7. Retry an eligible dead-letter dispatch through the authorized UI and verify an audit event is written.

Pass when AgencyOS executes only fixed internal handlers and no external URL, callback, dynamic code, or secret reference is required.

### F13-VAULT-01 — Vaultwarden references

1. Configure `VAULTWARDEN_URL` and open `/automation` with `automation.vault_link.view`.
2. Create project, client, and vendor item links using UUID item references only.
3. Confirm AgencyOS stores no vault password, token, session, or item content.
4. Confirm record-scope permissions hide links for records the user cannot view.
5. Revoke a link and verify it disappears from active results while audit evidence remains.

Pass when AgencyOS provides permission-aware open links while Vaultwarden remains the only holder of secret material.

## F14 — Finance foundation

### Credentials and setup

Use a dedicated non-production PostgreSQL database only. Apply migrations with `npm run db:migrate`; never reset the database. Confirm local MinIO is running, `npm run storage:check` passes, and the finance document-delivery migration is applied. Configure a restricted non-production `RESEND_API_KEY` and a verified test sender only when exercising delivery. Prepare test members for Owner, Finance Manager, Accountant, Auditor, workspace-only, invoice-view-only, invoice-issuer, payment-entry, and payment-reconciliation roles. Create two organizations, two CRM clients with different currencies/tax details, billing contacts, and projects. No real recipient, bank account, tax identifier, payment reference, credential, or client data may be used.

### F14-FINANCE-01 — Catalogue, duplicate rules, and currency precision

1. Open `/finance?tab=catalog` as Finance Manager and create a service with SKU, description, unit, rate, tax category/rate, currency, and invoice description.
2. Repeat the same item name/type and then the same SKU with different casing.
3. Create USD, JPY, and KWD items and attempt unsupported decimal precision or negative values.
4. Repeat as catalogue viewer and as a user without finance workspace access.

Pass when valid items appear once, name/SKU duplicates are rejected, rates retain 2/0/3 currency decimals, invalid/negative values fail before persistence, exact permissions control create/view, and cross-organization records never appear.

### F14-FINANCE-02 — Estimates and duplicate-safe numbering

1. Create an estimate with client, contact, project, dates, currency, multiple custom/catalogue lines, discounts, taxes, notes, terms, and internal notes.
2. Submit it for approval, approve and reject with appropriate roles, and retry each stale action.
3. Submit the exact same create payload concurrently from two sessions.
4. Create estimates concurrently for the same organization/year.

Pass when totals match the centralized calculation tests, one exact duplicate draft is reused, readable estimate numbers are unique and monotonic, contact/project tenants match the client organization, stale approval attempts are safe, and internal notes remain permission scoped.

### F14-FINANCE-03 — Invoice draft, approval, issue, and immutability

1. Create an invoice draft with PO reference, planned dates, service period, client/project/contact, lines, tax, terms, bank details, and internal notes.
2. Run approval, then issue it from two sessions at the same time.
3. Inspect seller, client, calculation, and payment snapshots through trusted test SQL.
4. Change the CRM client and organization details after issue and reload the invoice.
5. Attempt direct authenticated updates to the issued number, client, dates, currency, line description/rate/tax, and totals.
6. Void the invoice with a reason and repeat the void request.

Pass when only one issue wins, the final number is allocated transactionally and never reused, snapshots retain original legal/address/tax/payment/line/total data, every prohibited mutation fails at the database trigger, void requires permission and reason, and append-only invoice/audit events identify the action without secrets.

### F14-FINANCE-04 — Payments, allocation locking, and reconciliation

1. Issue invoices for two clients and currencies. Record a full payment, a partial payment, and one payment allocated across multiple same-client invoices through MCP.
2. Attempt allocations whose sum differs from the payment, exceeds balance, repeats an invoice, mixes clients/currencies, targets draft/void invoices, or uses a duplicate transaction reference.
3. Race two payments against the same remaining balance.
4. Change reconciliation through unreconciled, matched, reconciled, and exception using an authorized role and retry as an entry-only role.

Pass when payment/allocation/balance updates are atomic, invoice rows are locked, only one race can consume the balance, partial/full statuses and amounts are correct, transaction references are duplicate protected, and reconciliation needs its exact permission.

### F14-FINANCE-05 — Reports, permissions, responsive UI, and MCP

1. Compare `/finance?tab=reports` outstanding, overdue, and collected totals with trusted SQL for the organization default currency.
2. Test filters and all tabs at desktop, tablet, and 375 px width with long client/project/reference names.
3. Confirm focus order, labels, status text, visible error/success messages, and no clipped controls or horizontal page overflow.
4. Through browser MCP, list tools as viewer, creator, approver, issuer, payment-entry, and reconciler roles; create synthetic finance records and repeat without required permissions.
5. Inspect MCP schemas and traffic for file fields, raw credentials, secrets, connector tokens, or private attachment content.

Pass when reports use stored minor-unit totals, UI remains readable/responsive, server authorization and RLS override hidden controls, tools are permission filtered and re-authorized, and no sensitive file/credential payload is accepted or returned.

### F14-FINANCE-06 — Estimate acceptance, conversion, and version evidence

1. Approve an estimate, then record client acceptance with actor, timestamp, channel, and bounded evidence. Repeat as an unauthorized role and with missing evidence.
2. Record a rejection on another approved estimate and verify it cannot be converted.
3. Race two accepted-estimate conversion requests from separate sessions.
4. Compare the resulting invoice draft with the accepted estimate version, including client/contact/project, dates, currency, lines, discounts, taxes, totals, notes, and terms.
5. Edit a draft estimate through multiple versions, approve the current version, and inspect version history as an authorized and unauthorized role.

Pass when decisions require exact permission and evidence, only an accepted current version converts, one race creates exactly one linked invoice draft, repeated conversion returns the same invoice, copied values do not depend on later catalogue/CRM changes, and version evidence remains tenant isolated.

### F14-FINANCE-07 — PDF snapshots, download, and email delivery

1. Generate a PDF for an approved estimate and issue an invoice to create its immutable PDF. Inspect trusted rows for source version, private-file link, size, and SHA-256.
2. Download each snapshot with and without both document-download and source-view permissions. Verify forced attachment headers, PDF MIME, byte length, checksum, and append-only download evidence.
3. Send to a synthetic email sink with a unique request token, replay the same token, then test a provider failure and retry with a new token.
4. Confirm estimate/invoice status changes to `sent` only after successful provider delivery and that failed attempts retain bounded error evidence.
5. Change mutable CRM, organization, estimate-draft, or payment configuration after snapshot generation and download the original again.

Pass when each approved estimate version and issued invoice has the expected unique immutable snapshot, storage URLs are never exposed, integrity mismatches fail closed, replayed request tokens never call the provider twice, delivery history records success/failure safely, and the original issued PDF remains byte-for-byte unchanged.

### F14-FINANCE-08 — Automated contracts

Run:

```bash
npm test -- tests/unit/finance.test.ts tests/unit/finance-contract.test.ts tests/unit/finance-document-delivery.test.ts tests/unit/finance-document-delivery-contract.test.ts tests/unit/mcp-tool-registry.test.ts
npm run db:check
npm run verify
npm run db:test
```

The linked pgTAP suite must run `database/tests/finance_foundation.test.sql` and `database/tests/finance_document_delivery.test.sql` and verify finance tables, sequence/calculation/immutability functions, document-snapshot and delivery contracts, duplicate/idempotency indexes, append-only events, tenant validation, RLS, grants, and permission registration. Verification must not invoke a database reset command.

### F14-FINANCE-09 — Credit notes and correction lineage

1. Issue an invoice, then create a revised invoice draft with a bounded reason. Verify the new draft has the same tenant, client, currency, and copied line values while retaining `correction_of_invoice_id`.
2. Create a partial credit note from invoice lines, submit/approve it, then race two issue requests. Verify one permanent `CN-YYYY-NNNNNN` number, one immutable snapshot, and one applied credit.
3. Create additional credit notes whose combined total reaches the invoice total. Attempt an over-credit and a cross-tenant/currency correction.
4. Download and email an issued credit note, replay the email request token, and inspect download/delivery history. Change CRM/organization data and verify the stored PDF remains unchanged and references the original invoice number.
5. Void one issued credit note with a reason and verify only its amount is reversed. Inspect invoice status, balance, credited amount, credit due, credit-note events, invoice events, and audit records.
6. Repeat create, approve, issue, void, download, and MCP operations with roles missing each exact permission. Attempt direct authenticated mutation/deletion of issued credit notes, lines, snapshots, and correction lineage.

Pass when revised invoices and credit notes always reference an issued same-tenant invoice, permanent numbering is transactional, concurrent credits cannot exceed the original total, issued fields and lines are immutable, PDF/email behavior reuses the private MinIO document path, voiding recalculates balances atomically, and permission/RLS failures do not disclose records.

Run:

```bash
npm test -- tests/unit/finance-credit-notes-contract.test.ts tests/unit/finance.test.ts tests/unit/mcp-tool-registry.test.ts
npm run db:check
npm run verify
npm run db:test
```

The linked pgTAP suite must include `database/tests/finance_credit_notes_corrections.test.sql` and verify tables, permissions, RLS, grants, immutable triggers, original-invoice validation, numbering, snapshot entity support, credit application/reversal, and over-credit rejection.

### F14-FINANCE-10 — Attachments, operational statuses, receipts, refunds, and overdue automation

1. Upload PDF, PNG, text, and CSV attachments to a draft invoice. Attempt an unsupported type, an oversized body, cross-origin upload, duplicate bytes, and an upload without both invoice-view and attachment-manage permissions. Run the private-file scanner, download the clean object, verify size/SHA-256 and audit evidence, then issue the invoice and attempt attachment upload/removal again.
2. Mark an issued invoice viewed, record a bounded dispute reason, and resolve it with evidence. Repeat each action without the status permission and attempt duplicate view evidence.
3. Create issued, sent, viewed, partially paid, disputed, paid, credited, void, and future-due invoices. Call `POST /api/internal/workers/run` with `{"job":"finance-overdue"}` using a wrong secret, the correct secret, twice concurrently, and again after completion.
4. Generate and download a payment receipt with and without payment-view plus document-download permissions. Confirm the receipt is a MinIO-backed immutable PDF whose lines match stored allocations.
5. Record partial and full refunds, then attempt an over-refund, duplicate reference, update, deletion, cross-tenant payment, and a refund without the exact permission.
6. Create an invoice in a non-default currency with an exchange rate, issue it, inspect its calculation/PDF snapshots, then attempt to change the rate directly. Send estimate, invoice, and credit-note emails to a synthetic relay and compare totals, balance, and due date with stored minor-unit values.
7. Confirm the application `.env.example`, `docs/OPERATIONS.md`, worker script, `.env.example`, and operations documentation all include the finance overdue secret and endpoint without embedding credentials.

Pass when attachments remain quarantined until scanning, issued links and exchange rates are immutable, operational evidence is append-only and permission gated, only eligible invoices become overdue once, payment receipts are integrity checked, refunds are bounded and immutable, templates use shared monetary formatting, and the application and worker documentation remain synchronized.

Run:

```bash
npm test -- tests/unit/finance-invoice-payment-operations-contract.test.ts tests/unit/finance-document-delivery.test.ts tests/unit/finance.test.ts tests/unit/mcp-tool-registry.test.ts
npm run db:check
npm run verify
npm run db:test
```

The linked pgTAP suite must include `database/tests/finance_invoice_payment_operations.test.sql` and verify attachment/refund tables, permissions, RLS, grants, tenant validation, issued immutability, refund bounds, payment-receipt snapshot support, and append-only evidence.

### F14-FINANCE-11 — Expenses, approvals, allocations, and private receipts

1. Create employee, project, and vendor expenses in the organization default currency and a second currency. Verify category, amount, tax, billable/reimbursable flags, employee/vendor evidence, notes, and generated total.
2. Create a project expense allocated across two active projects. Attempt an under-allocation, over-allocation, duplicate project, closed project, and cross-tenant project.
3. Submit an expense, approve and reject separate records, then attempt decisions without the exact approval permission and after payment processing begins.
4. Move approved or approval-exempt expenses through unpaid, scheduled, paid, reimbursed, and waived. Attempt reimbursement on a non-reimbursable expense and settlement while approval is pending or rejected.
5. Upload PDF, PNG, JPEG, text, and CSV receipts. Attempt unsupported, oversized, cross-origin, duplicate, unauthorized, cross-tenant, and post-approval uploads. Run the private-file scanner, then download and remove allowed receipts while checking byte length, SHA-256, private-file events, expense events, and audit evidence.
6. Sign in as Employee, Accountant, Finance Manager, Auditor, and a role without finance permissions. Verify own-scope employee records, organization-scope finance access, hidden controls, server reauthorization, and RLS.
7. At desktop, tablet, and 375 px width, verify the Expenses tab, filters, long categories/vendors/projects, allocation rows, status badges, category manager, receipt controls, keyboard focus, 40 px targets, and no horizontal page overflow.
8. Through browser MCP, call `agencyos.finance.get_workspace` with `tab=expenses` and verify permission-scoped metadata and summaries are returned without receipt bytes, MinIO paths, or credentials.

Pass when expense money uses minor units, type-specific evidence is enforced, project expenses commit only with exact same-tenant allocations, approval/payment transitions require their exact permissions, receipts remain quarantined until scanning and integrity checked on download, event history is immutable, and own/organization scopes are identical across UI, server actions, MCP, and RLS.

Run:

```bash
npm test -- tests/unit/finance-expenses-contract.test.ts tests/unit/finance.test.ts tests/unit/mcp-tool-registry.test.ts
npm run db:check
npm run verify
npm run db:test
```

The linked pgTAP suite must include `database/tests/finance_expenses.test.sql` and verify all expense tables, type/status fields, allocation and tenant triggers, immutable events, permissions, role-template scopes, RLS, grants, policies, and safe execution access for the expense scope helper. Verification must not invoke a database reset command.

### F14-FINANCE-12 — Financial reports and client statements

1. Issue invoices across at least three months, two clients, two projects, and multiple catalogue services. Issue partial and full credit notes, then verify monthly, client, project, and service revenue subtracts credits without changing original invoice totals.
2. Record approved, approval-exempt, pending, and rejected expenses across categories and projects. Verify category/project totals and project gross profit include only approved or approval-exempt evidence and use enforced project allocations.
3. Fully pay invoices on different dates and verify average and median collection days use the invoice issue date and latest allocated payment date. Leave one invoice partially paid and confirm it is excluded.
4. Move estimates through sent, accepted, rejected, expired, and converted outcomes. Verify the conversion denominator excludes drafts and internal approval states, while converted value uses stored minor-unit totals.
5. Add invoice tax, credit-note tax, and expense input tax. Verify the tax summary reports each component and the net tax position as invoice tax less credits and eligible expense tax.
6. Select a client and date range. Verify opening balance, invoices, credit notes, payment allocations, refunds, running balances, and closing balance. Download CSV and check formula-injection escaping, no-store headers, bounded rows, absence of file/storage secrets, and one `reports.exported` audit event containing the client identifier, dates, format, and exported row count without statement contents.
7. Create same-period foreign-currency documents and expenses. Verify operational records remain visible but consolidated reports explicitly exclude them until conversion support exists.
8. Sign in as Employee, Accountant, Finance Manager, Auditor, and a role without report permission. Verify employees retain own-expense Finance access but cannot see organization reports. Accountant and Finance Manager roles with `reports.export.create` receive the same statement through UI, CSV, and MCP. The Auditor retains report UI/MCP access but sees no CSV action and receives `403` from the direct client-statement export route.
9. At desktop, tablet, and 375 px width, verify date/client filters, report tables, bars, long client/project/service names, horizontal table containment, keyboard focus, and 40 px controls.
10. Through browser MCP, call `agencyos.finance.get_workspace` with `tab=reports`, `from`, `to`, and optional `company`. Verify permission-scoped aggregates and statement metadata are returned without PDF bytes, receipt bytes, MinIO paths, credentials, or banking details.

Pass when all required Stage 7 report items derive from canonical issued/approved evidence, consolidated values are currency-safe, client statements reconcile to their running balance, report access remains separate from employee expense access, and CSV/MCP outputs enforce the same authorization and data-minimization rules.

Run:

```bash
npm install
npm run check
npm test -- tests/unit/finance-reports-contract.test.ts tests/unit/finance-expenses-contract.test.ts tests/unit/mcp-tool-registry.test.ts
npm run db:check
npm run db:test
```

`minio` is a locked runtime dependency. After applying a patch that changes `package.json` or `package-lock.json`, refresh local dependencies with `npm install` (or `npm ci` in a clean checkout) before running TypeScript. A `Cannot find module 'minio'` type error with `minio` present in both manifests indicates stale `node_modules`, not a missing source declaration.

## X1 — React Doctor remediation and regression checks

### X1-RD-01 — Automated verification

Run from a dependency-current checkout:

```bash
npm ci
npm run check
npm test -- tests/unit/intl-formatters.test.ts tests/unit/react-doctor-remediation-contract.test.ts tests/unit/notification-realtime-contract.test.ts
npm test
npm run db:check
npx react-doctor@latest --verbose --no-score
```

Pass when formatting, ESLint, TypeScript, all unit tests, and migration validation succeed; React Doctor scans only AgencyOS source, reports zero errors, and does not report the server-action authentication, effect-cleanup, repeated `Intl` construction, deprecated Zod string-format, request-local static-column, modal accessibility, missing-label, locale-rendering, index-key, handler-only state, or repeated-array-lookup findings fixed in these passes. The accepted baseline is 59 non-blocking warnings pending context-aware risk review.

### X1-RD-02 — CRM server-action authorization

1. Sign out and call each exported CRM connection action directly with syntactically valid form data.
2. Sign in with a role lacking `crm.connection.manage` and repeat create, health, status, schedule, credential rotation, notification acknowledgement, and delete.
3. Sign in with a role lacking `crm.import.execute` and call sync.
4. Sign in with the exact required permission and repeat the operation against synthetic records.

Pass when signed-out requests and insufficient roles cannot reach CRM persistence, authorized requests retain existing behavior, and each exported action performs `authorizeCurrentUser` before calling its server service.

### X1-RD-03 — Realtime cleanup

1. Open the notification-enabled workspace and verify one recipient-filtered notification refresh channel is created.
2. Navigate away, sign out, or otherwise unmount the workspace shell.
3. Inspect the browser/network Realtime connection and repeat mount/unmount several times.

Pass when the effect removes focus, online, and visibility listeners; clears any pending refresh timer; calls `channel.unsubscribe()`; tears down a successfully unsubscribed channel; and does not accumulate duplicate notification refreshes.

### X1-RD-04 — Zod and formatter compatibility

1. Exercise UUID route parameters, local and offset date-time fields, push-subscription URLs, CRM/project/finance forms, and approval snapshots with valid and invalid values.
2. Change organization country, timezone, currency, and locale-sensitive finance data, then revisit dashboard, CRM, projects, approvals, notifications, reports, organization settings, and audit pages.
3. Compare repeated formatter calls and verify currency-specific formatters do not leak options between currencies.

Pass when validation behavior remains unchanged under Zod 4, invalid identifiers/dates/URLs still fail closed, rendered values match the requested locale/currency/timezone, and repeated identical formatter requests reuse the same cached formatter.

### X1-RD-05 — Accessibility and deterministic-render follow-up

1. Open the approval, project-create, and command-palette dialogs with keyboard and pointer input. Verify each dialog has an accessible name, Escape and the explicit close button work, focus lands in the project-name field after a user opens the modal, and removing backdrop-click dismissal does not trap the user.
2. Exercise owner assignment, expense receipt upload, and invoice attachment upload with a screen reader. Verify every select and file input has a usable announced label.
3. Render expense history and estimate version history on server and client with different host timezones. Verify the text is identical and uses the organization locale with UTC as the explicit timezone.
4. Reorder breadcrumbs and statement entries in test fixtures. Verify breadcrumb identity uses href/label and statement rows use database movement IDs rather than array position.
5. Inspect Finance reports at desktop, tablet, and 375 px. Verify revenue bars and ranked results expose native list semantics, report and statement data use native tables with captions/headers, and horizontal containment remains intact.
6. Change expense categories and amounts repeatedly. Verify tax suggestions use the latest category rate without causing a render solely for the stored rate. Toggle notification categories and verify saved preferences are unchanged.

Run:

```bash
npm run check
npm test -- --maxWorkers=2
npm run db:check
npx react-doctor@latest --verbose --no-score --no-dead-code --no-supply-chain
```

Pass when all automated checks succeed, React Doctor reports zero errors and no accessibility findings, all 290+ unit tests remain green, statement rows retain stable source IDs, and the accepted warning baseline is 59 or lower without suppressing rules.

## F15 — HR employee records foundation

### F15-HR-01 — Automated verification

Run from a dependency-current checkout:

```bash
npm run check
npm test -- tests/unit/hr.test.ts tests/unit/hr-contract.test.ts tests/unit/mcp-tool-registry.test.ts
npm test -- --maxWorkers=2
npm run db:check
npm run db:test
```

Pass when TypeScript, lint, formatting, all unit tests, migration validation, and the linked pgTAP suite succeed; the migration creates `hr_designations` and `hr_employee_profiles`, enables RLS in the same file, preserves organization boundaries, and registers the HR permission catalogue and default scopes.

### F15-HR-02 — Employee records and anti-duplicate behavior

1. Invite or activate two synthetic users through the existing Settings → User access flow; do not create a second HR-specific identity record.
2. Open `/hr` as Owner or HR Manager and complete one employee record with employee ID, legal/preferred name, personal contact, joining date, employment type, department, designation, manager, work mode/location, lifecycle status, and weekly hours.
3. Save the same membership again with changed values and verify the same `hr_employee_profiles` row is updated rather than duplicated.
4. Attempt to assign an employee number already used by another membership, create a designation with a duplicate case-insensitive name or code, assign the employee as their own manager, and submit malformed email/date/hour values.
5. Inspect `memberships`, `hr_employee_profiles`, `hr_designations`, and `audit_events` through trusted SQL.

Pass when one organization membership maps to at most one employee profile, employee numbers and designation names/codes are duplicate safe, validation fails before persistence, self-management is rejected, and create/update audit events identify actor and target without storing private form payloads.

### F15-HR-03 — Permission scopes, RLS, and self-service

1. Sign in as Owner, HR Manager, Team Lead with direct/indirect reports, Employee, and a role without HR permissions.
2. Verify Owner and HR Manager can view and update organization employee records and manage designations.
3. Verify Team Lead sees only employees in the existing recursive `managed_employees` reporting scope and cannot edit records or designations by default.
4. Verify Employee sees only their own record and can change only preferred name, personal email, and personal phone through the self-service form.
5. Call the exported HR actions directly while signed out, with insufficient permissions, with another employee membership ID, and with a cross-organization membership/designation/department/manager ID.
6. As the authenticated PostgreSQL test role, attempt direct selects, inserts, and updates against both HR tables outside the effective organization and permission scope.

Pass when UI visibility, server actions, MCP, and RLS agree; self-service cannot change employee number, department, manager, designation, lifecycle, or employment fields; cross-organization references fail closed; and roles without `hr.workspace.view` cannot open the page or discover records.

### F15-HR-04 — UI, accessibility, responsive behavior, and MCP

1. Test `/hr` at desktop, tablet, and 375 px with long names, emails, designations, departments, and manager names.
2. Verify summary cards, search, employee cards, edit disclosures, designation creation/editing, success/error messages, keyboard focus, visible labels, and 40 px targets.
3. Confirm inactive designations remain visible to HR, cannot be newly selected unless already assigned, and retain their employee count.
4. Through browser MCP, list tools as HR Manager, Team Lead, Employee, and a role without HR access; call `agencyos.hr.get_workspace`.
5. Inspect tool output for personal email, personal phone, date of birth, residential address, emergency contacts, salary, bank details, government IDs, file contents, or storage keys.

Pass when the workspace remains readable without horizontal page overflow, every form control is labelled, scoped users receive only visible directory records, and the MCP response contains directory-safe employment fields while excluding personal and sensitive HR data.

## F16 — HR attendance and correction approvals

### F16-HR-01 — Automated verification

Run from a dependency-current checkout:

```bash
npm run check
npm test -- tests/unit/hr-attendance.test.ts tests/unit/hr-attendance-contract.test.ts tests/unit/hr.test.ts tests/unit/hr-contract.test.ts
npm test -- --maxWorkers=2
npm run db:check
npm run db:test
npm run build
npx react-doctor@latest --verbose
```

Pass when formatting, lint, TypeScript, all unit tests, migration validation, the linked pgTAP suite, and the production build succeed; React Doctor introduces no new errors; and the attendance migration creates both tables with RLS in the same file.

### F16-HR-02 — Check-in, check-out, manual attendance, and summaries

1. Set the organization timezone to a non-UTC zone, sign in as an Employee, and open `/hr`.
2. Check in once, attempt a second check-in, then check out and attempt a second check-out.
3. Verify the local attendance date follows the organization timezone and the stored timestamps remain UTC `timestamptz` values.
4. As HR Manager, create and update manual records for present, work-from-home, half-day, and absent days with late, early-departure, overtime, and notes.
5. As Team Lead, attempt the same operations for a direct report, indirect report, unrelated employee, and cross-organization membership.
6. Inspect the current-month table and summary after every change.

Pass when one employee has at most one record per date, repeat check actions fail safely, manual updates increment the revision instead of duplicating rows, scoped managers cannot cross their reporting boundary, and summary totals match the visible records.

### F16-HR-03 — Attendance correction approval flow

1. Assign the employee an active manager who has approval permission.
2. Submit a correction for a past or current date with a reason, proposed times, status, late minutes, early-departure minutes, overtime, and notes.
3. Attempt a second pending correction for the same employee/date, a future date, another employee membership ID, and a date with reversed times.
4. Open `/approvals` as the assigned manager and approve the request; repeat with rejected and revision-requested decisions.
5. Inspect `hr_attendance_corrections`, `approval_requests`, `approval_request_steps`, `approval_actions`, `hr_attendance_records`, and `audit_events`.
6. Remove the employee manager or remove the manager approval permission and submit another correction.

Pass when the fixed default policy is created at most once, requests route through the shared approval engine, duplicate pending requests are blocked, no-manager/no-approver requests fail without leaving orphan corrections, approved requests atomically create or revise attendance, non-approved terminal outcomes do not mutate attendance, and reviewer/audit evidence is retained.

### F16-HR-04 — RLS, accessibility, responsive UI, and MCP

1. Test `/hr` as Owner, HR Manager, Team Lead, Employee, signed-out user, and a role without HR attendance permissions.
2. Through the authenticated PostgreSQL test role, attempt direct attendance/correction reads and writes across organization and effective employee scopes.
3. Test the attendance controls, forms, table, correction list, labels, focus order, status messages, and horizontal containment at desktop, tablet, and 375 px.
4. Through browser MCP call `agencyos.hr.get_workspace` under each role.
5. Inspect MCP output for individual check-in/check-out timestamps, correction reasons, notes, personal contact data, or approval payloads.

Pass when UI, server actions, RLS, approval visibility, and MCP agree; all controls are labelled and keyboard usable; mobile layout contains the wide table without page overflow; and MCP exposes only aggregate attendance totals, never individual attendance or correction details.

## F17 — HR leave management

### F17-HR-01 — Automated verification

Run:

```bash
npm run check
npm test -- tests/unit/hr-leave.test.ts tests/unit/hr-leave-contract.test.ts --maxWorkers=1
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Pass when leave calculations, schemas, source contracts, all unit tests, migration validation, linked pgTAP, the production build, and the React Doctor security scan succeed.

### F17-HR-02 — Policies, balances, approvals, and cancellation

1. As Owner or HR Manager, create paid, unpaid, monthly-accrual, annual-accrual, and non-accruing leave types; include one evidence threshold and one manager-plus-HR policy.
2. Refresh balances, apply positive and negative adjustments, and inspect the append-only adjustment history.
3. As Employee, save a draft, upload scanner-gated evidence, submit it, and attempt duplicate or overlapping leave.
4. Approve through the assigned manager and optional HR stage; repeat with rejection, revision requested, expiry, pending cancellation, and approved future cancellation.
5. Inspect leave requests, balances, approval rows, private-file events, and audit events.

Pass when balances reserve atomically while pending, consume only on approval, restore after non-approved terminal outcomes or allowed cancellation, prevent overlaps, preserve conflict counts, and never orphan approvals or private files.

### F17-HR-03 — RLS, private evidence, UI, and MCP

Verify Employee own-scope, Team Lead managed-employee scope, Owner/HR Manager organization scope, signed-out denial, cross-organization denial, scanner quarantine, integrity-checked downloads, mobile layout, labelled controls, and aggregate-only MCP output without leave reasons or attachment details.

## F18 — HR salary structures and private salary slips

### F18-HR-01 — Automated verification

Run:

```bash
npm run check
npm test -- tests/unit/hr-salary.test.ts tests/unit/hr-salary-contract.test.ts tests/unit/redis-coordination-contract.test.ts --maxWorkers=1
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Pass when integer salary calculations, component parsing, bounded pay periods, a real Chromium salary-slip PDF, source contracts, all unit tests, 33-migration validation, linked pgTAP, production build, and security scanning succeed.

### F18-HR-02 — Effective-dated salary revisions

1. As Owner or HR Manager, create an initial salary structure with base salary, multiple allowances, multiple deductions, currency, effective date, and notes.
2. Add future, backdated, and middle-history revisions; attempt a duplicate effective date, duplicate component name, malformed component line, unsupported currency, negative amount, and deductions greater than gross salary.
3. Inspect `hr_salary_structures` and `hr_salary_structure_components` after every revision.
4. Attempt direct update/delete through the authenticated PostgreSQL test role.
5. Inspect audit events and confirm salary amounts are absent from audit payloads.

Pass when revisions are immutable, revision numbers are monotonic, effective ranges remain non-overlapping, component names are duplicate safe, all amounts use integer minor units, authenticated clients have read-only scoped access, and audit evidence identifies the revision without copying compensation values.

### F18-HR-03 — Salary-slip generation, upload, scanning, and acknowledgement

1. Generate a salary slip for a pay period fully covered by a structure, with bonus, reimbursement, and an additional deduction.
2. Attempt generation across an uncovered structure boundary and with deductions above gross pay.
3. Upload an existing PDF with matching bounded metadata; attempt a non-PDF, scripted PDF, empty file, and file larger than 10 MB.
4. Run the private-file scanner and verify generated and uploaded files transition from quarantine to available or rejected.
5. Download the available slip, verify its SHA-256 and byte length, then acknowledge it as the employee.
6. Generate or upload another slip for the same period and verify version increment rather than destructive replacement.
7. Submit two same-period slips concurrently and verify the advisory-locked transaction assigns distinct, consecutive database versions without relying on a pre-render version guess.

Pass when generated PDFs preserve Unicode and escaped employee data, external requests are blocked, salary snapshots remain immutable, versions are allocated only inside the locked link transaction, files are scanner-gated, downloads are integrity checked and audited, acknowledgements are one-way and own-scope, and rejected/quarantined files cannot be downloaded or acknowledged.

### F18-HR-04 — Permission isolation and privacy

1. Sign in as Owner, HR Manager, Team Lead, Employee, Auditor, a custom role, signed-out user, and users from another organization.
2. Verify Owner and HR Manager can manage organization salary and slips; Employee can view only their own salary/slips and acknowledge only their own available slips.
3. Verify Team Lead receives no salary permissions automatically even for direct reports.
4. Verify Auditor access requires explicit Auditor role assignment and remains read-only.
5. Call salary actions and download/upload routes directly with cross-organization IDs and insufficient permission scopes.
6. Inspect employee-directory responses, MCP tools, audit events, logs, notification payloads, and browser responses for salary values.

Pass when salary data appears only in the dedicated RLS-restricted salary UI/API and private PDFs, managers cannot infer compensation, cross-tenant identifiers fail closed, and no salary amount is copied to MCP, generic employee records, audit payloads, or logs.

### F18-HR-05 — Redis fallback diagnostics

1. Confirm a normal Redis connection with `npm run redis:check` or the project Redis diagnostic script.
2. During dev compilation, force or simulate `SocketTimeoutError`, `ConnectionTimeoutError`, and `SocketClosedUnexpectedlyError` operations.
3. Observe the throttled fallback warning and database-safe behavior.
4. Verify logs include the concrete constructor name while excluding Redis URLs, credentials, commands, payloads, and stack traces.
5. Verify the retry cooldown still avoids repeated connection attempts and a later successful connection clears the retry state.

Pass when transient Redis operation failures remain non-fatal, database fallback remains unchanged, warnings say `Redis operation failed` rather than claiming total unavailability, and the diagnostic object distinguishes Redis-specific error classes safely.

## F19 — Swappable private HR legal-document templates

### F19-HR-01 — Template source, sanitization, and immutable generation

1. Run the focused document-template and employment-letter unit tests plus `npm run db:check`.
2. Generate every built-in letter type and one custom MinIO-backed template as a real PDF.
3. Attempt scripts, event handlers, forms, frames, SVG, external URLs, CSS URLs, placeholders in attributes/styles, unknown placeholders, and integrity-mismatched template bytes.
4. Switch the default template, generate a new document, then switch back to an earlier active version.
5. Verify old documents retain the original template source, version, digest, render context, private file, and acknowledgement history.

Pass when templates are private, immutable by version, sanitized before storage and rendering, external browser requests are blocked, PDFs are scanner gated, and default changes never rewrite generated documents.

## F20 — Extended HR employment letters

### F20-HR-01 — Catalogue extension without a second document system

1. Verify experience, relieving, promotion, salary-revision, warning, and performance letters appear in built-in generation, custom-template upload, default selection, and version history.
2. Generate each type, replace its default with a MinIO version, and generate again.
3. Verify the migration widens only existing type constraints and does not create another table, bucket, renderer, permission family, or download route.
4. Confirm every starter template displays its legal/policy review warning and escapes custom values.

Pass when all ten letter types share the same catalogue, storage, sanitization, PDF, permission, acknowledgement, and audit paths.

## F21 — Private employee supporting documents

### F21-HR-01 — Automated verification

Run:

```bash
npm run check
npm test -- tests/unit/hr-supporting-documents.test.ts tests/unit/hr-supporting-documents-contract.test.ts --maxWorkers=1
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Pass when category/schema tests, source contracts, all unit tests, 36-migration validation, linked pgTAP, production build, and security scanning succeed.

### F21-HR-02 — Upload, immutable replacement, review, and expiry

1. As Employee, upload identification, education, certificate, and visa/work-permit evidence for the current employee using PDF, JPEG, and PNG files.
2. Attempt an employee background-check or exit-document upload, another employee membership ID, a complete identifier longer than four characters, invalid dates, HTML/SVG/executable content, MIME/signature mismatch, empty file, and a file larger than 10 MB.
3. As HR Manager, upload all six categories, choose employee-visible or HR-only access, verify/reject pending records, and replace an existing category/reference.
4. Inspect `hr_employee_supporting_documents`, `private_files`, `private_file_events`, and `audit_events` after upload, replacement, review, visibility change, scan completion, and download.
5. Set past and future expiry dates and confirm the UI marks expired records without changing immutable file history.

Pass when employee uploads are forced to own scope and employee-visible categories, HR-only categories reject self upload, identical bytes deduplicate safely, replacements allocate consecutive versions under an advisory lock, prior versions become superseded, and only the optional final-four identifier suffix appears in searchable metadata.

### F21-HR-03 — Permissions, RLS, download integrity, and privacy

1. Test Owner, HR Manager, Team Lead, Employee, custom role, signed-out user, and cross-organization users.
2. Verify Owner/HR Manager organization access, Employee own visible access, no Team Lead default access, and HR-only records hidden from Employee even when the membership matches.
3. Attempt direct authenticated table reads outside scope and direct writes without the service role.
4. Keep a file quarantined, mark another rejected, make one available, then try every download state.
5. Modify stored bytes or expected size in a disposable environment and verify download fails closed.
6. Inspect MCP tools, logs, audit payloads, browser responses, and searchable metadata for complete government, passport, visa, licence, background-check, or document contents.

Pass when RLS and server authorization agree, quarantined/rejected files cannot download, available files are size and SHA-256 verified, responses force private no-store downloads, every download is audited, and private contents or full identifiers never reach MCP or logs.

## HR employee onboarding workflow

### Automated verification

```bash
npm run check
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npx react-doctor@latest --verbose
```

Expected automated coverage:

- `tests/unit/hr-onboarding.test.ts` verifies shared checklist progress, plan-state derivation, and schedule validation.
- `tests/unit/hr-onboarding-contract.test.ts` verifies explicit server authorization, audit/notification reuse, source-record derivation, employee-write restrictions, and accessible workflow controls.
- `database/tests/hr_onboarding.test.sql` verifies both onboarding tables, indexes, sensitive permissions, default scopes, RLS, checklist seeding, status refresh, and employee-update guard triggers.
- `npm run db:check` must validate 37 migrations and 99 public tables after this slice.

### Owner or HR Manager acceptance flow

1. Open `/hr` with Owner or HR Manager access.
2. Create an onboarding plan for an employee who has no existing plan.
3. Confirm that the plan creates exactly one checklist containing offer acceptance, employment documents, account, department, manager, equipment, email, policy, NDA, training, first-day meeting, and probation review items.
4. Confirm that account and work-email items complete from the existing membership and authenticated account rather than duplicate onboarding fields.
5. Assign a department and manager through the employee record, then use **Refresh evidence** and confirm those checklist items complete.
6. While signed in as the employee, explicitly accept the offer from the onboarding checklist. Confirm this is separate from merely acknowledging receipt of an offer-letter PDF. Have HR complete the NDA item only after signed evidence is available.
7. Schedule the first-day meeting and probation review. Confirm their items complete and the dates remain on the onboarding plan.
8. Assign equipment and training items to an active member, add a due date, and confirm a deduplicated assignment notification links to `/hr`.
9. Complete or exempt the remaining manual items and confirm status moves from `draft` to `in_progress`, then `ready`, and finally `completed`.
10. Confirm all create, schedule, checklist, evidence-refresh, policy-acknowledgement, assignment, and cancellation changes appear in append-only audit history without private document contents.

### Employee flow

1. Sign in as the onboarding employee and open `/hr`.
2. Confirm only the employee's own onboarding plan is visible.
3. Confirm schedule, checklist status, assignee, and due dates are readable but management controls are absent.
4. Complete **Accept offer** and **Policies acknowledged** and confirm each records an explicit employee action.
5. Attempt to alter another checklist item through a direct authenticated database request. Confirm RLS plus the employee-update trigger rejects it.

### Team Lead and scope checks

1. Sign in as a Team Lead and confirm onboarding plans are visible only for recursively managed employees.
2. Confirm Team Leads have no create, edit, assignment, refresh, or cancellation controls by default.
3. Move an employee outside the Team Lead's reporting tree and confirm onboarding visibility is revoked immediately.
4. Attempt cross-organization plan and checklist access and confirm RLS rejects every read or write.

### Duplicate and lifecycle checks

1. Attempt to create a second active plan for the same employee and organization. Confirm the partial unique constraint returns an operator-visible duplicate message.
2. Cancel an incomplete plan and confirm further schedule or checklist updates are rejected. Then create a new plan and confirm the next immutable onboarding cycle number is allocated.
3. Confirm completed and cancelled plans remain visible to authorized users for history and are not deleted.
4. Remove a department or manager after its onboarding item completed and confirm the historical checklist completion is preserved rather than silently rewritten.

### Responsive and accessibility checks

1. Test desktop, tablet, and mobile widths.
2. Confirm all fields have visible labels, checklist progress has an accessible label, status is conveyed in text, and forms are keyboard-operable.
3. Confirm long employee names, assignee names, notes, and meeting links wrap without horizontal overflow.
4. Confirm action success and error messages are announced through status regions.

## Stage 8 — Employee offboarding workflow

### Automated verification

```bash
npm run check
npm test -- --maxWorkers=1 tests/unit/hr-offboarding.test.ts tests/unit/hr-offboarding-contract.test.ts
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npm run doctor -- security
```

Expected automated evidence:

- `hr_offboarding_plans` and `hr_offboarding_items` are tenant isolated, RLS enabled, and read-only to ordinary authenticated SQL clients.
- One active plan per employee is enforced while completed and cancelled cycles remain immutable history for rehires.
- Employee resignation creation is own-scope only; Team Lead visibility remains `managed_employees`; Owner and HR Manager management remains organization scoped.
- Project ownership, active project membership, and non-terminal task assignments transfer to one active replacement without copying project data into HR.
- Open-task, unsettled-expense, account-status, exit-letter, and employee-archive checklist items are synchronized from source records and reject client-side derived writes.
- The shared membership-status helper prevents self-deactivation and suspension/deactivation of the last active Owner in both Settings and HR offboarding.
- Final clearance rejects dates before the last working date and rejects any required checklist item that is not complete or explicitly not applicable.
- Completion deactivates organization membership, archives the employee profile, and preserves audit history; cancellation restores the prior lifecycle state when possible.

### Manual browser verification

1. Sign in as Owner or HR Manager and open `/hr`. Create an offboarding plan for an active employee. Confirm the employee enters `notice_period` and the 13-item checklist is seeded.
2. Sign in as the employee. Submit a resignation for a different test employee account and confirm only the employee's own plan is visible. Confirm another employee's plan is not queryable through the browser.
3. Assign the departing employee to an active project and a non-terminal task. Use **Reassign work** and confirm project ownership/membership and open-task assignment move to the replacement while closed project/task history remains unchanged.
4. Create an unpaid or pending employee expense. Use **Refresh evidence** and confirm expense settlement stays blocked. Settle the expense in Finance and refresh again; the item should complete.
5. Generate both Experience and Relieving letters from the existing HR Documents panel. Refresh evidence and confirm the document-generation item reports `2 of 2`.
6. Before the last working date, confirm **Suspend account** and **Final clearance** are rejected. On or after that date, suspend the account and confirm the source-derived item completes.
7. Complete or exempt knowledge transfer, asset return, vault removal, and exit interview. Confirm the plan becomes `ready` only after every pre-clearance item is terminal.
8. Run **Final clearance**. Confirm membership becomes `deactivated`, employee lifecycle becomes `archived`, the plan becomes `completed`, and historical documents, salary slips, attendance, leave, project history, and audit events remain available to authorized users.
9. Create another active plan and cancel it before completion. Confirm the employee's prior lifecycle state is restored and the cancelled plan remains visible as history.
10. Attempt to offboard the only active Owner. Confirm account suspension/final deactivation is blocked until another active Owner exists.

### Negative and security verification

- Attempt cross-organization plan, replacement, assignee, item, and download identifiers; each must fail without leaking employee or separation details.
- Attempt direct authenticated updates to derived checklist items; the database trigger must reject them.
- Attempt to select separation reasons or checklist notes through MCP. MCP may return status, type, date, and progress only.
- Attempt concurrent plan creation for the same employee. Advisory locking plus the partial unique index must leave exactly one active plan and monotonic cycle numbers.
- Attempt concurrent work reassignment. Project/task unique constraints must prevent duplicate replacement memberships or task assignments.
- Confirm audit events exist for plan creation/update/cancellation, item updates, work reassignment, evidence refresh, account status changes, and final completion.

## Stage 9 — Private documents module foundation

### Credentials and local services

- A normal AgencyOS account with a role containing `documents.workspace.view`.
- Owner, System Administrator, Operations Administrator, or Legal Manager credentials for folder, taxonomy, access-grant, legal-hold, and archive tests.
- A second active employee account for own-scope and explicit-grant tests.
- A Team Lead or custom role with a non-organization document scope for scope-boundary tests.
- Configured MinIO and malware-scanner workers for end-to-end upload availability tests.
- A configured PostgreSQL database for pgTAP and direct authenticated RLS tests.

### Automated verification

```bash
npm run check
npm test -- --maxWorkers=1 tests/unit/documents.test.ts tests/unit/documents-contract.test.ts tests/unit/private-files.test.ts
npm test -- --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
npx react-doctor@latest --verbose
```

Expected automated evidence:

- `tests/unit/documents.test.ts` verifies classification, review/expiry, and legal-hold retention-state behavior.
- `tests/unit/documents-contract.test.ts` verifies shared private-file reuse, advisory-locked immutable versions, SHA-256 checks, audited preview/download, permission-scope helpers, current-membership RLS wrappers, related-module visibility checks, dedicated workspace controls, and metadata-only MCP exposure.
- `tests/unit/private-files.test.ts` verifies PDF/image/text signatures and rejects generic ZIP files disguised as DOCX/XLSX unless Office package markers are present.
- `database/tests/documents_foundation.test.sql` verifies all ten document tables, RLS, append-only version/comment/history triggers, role scopes, legal-hold/archive constraints, safe authenticated column grants, service-only arbitrary-membership helpers, and the authenticated current-membership access wrapper.
- `npm run db:check` must validate 42 migrations and 122 public tables after the legal compliance-record extension.

### Folder, category, and tag flow

1. Sign in as Owner or Legal Manager and open `/documents`.
2. Create a root folder and a child folder. Move the child between roots and confirm its displayed path changes.
3. Attempt to make a folder its own parent or create a longer cycle through direct database writes. Confirm the database trigger rejects it.
4. Create duplicate active sibling folder names with case differences and confirm the unique index rejects the duplicate.
5. Create active and inactive categories and multiple tags. Confirm inactive categories remain visible on existing records but cannot be selected for a new upload.
6. Archive and restore a folder. Confirm archived folders remain historical but are not offered for new uploads.

### Upload, scanning, preview, and download

1. Upload one valid PDF, JPEG, PNG, TXT, CSV, DOCX, and XLSX within the 25 MB limit.
2. Confirm every upload begins in quarantine and cannot be previewed or downloaded before the scanner marks it available.
3. Attempt HTML, SVG, executable, script, empty, oversized, signature-mismatched, active-JavaScript PDF, generic ZIP renamed to DOCX, and generic ZIP renamed to XLSX uploads. Confirm each fails before clean storage.
4. Mark one file rejected and confirm preview/download returns a blocked state without bytes.
5. Mark valid files available, preview PDF/image/text/CSV inline, and confirm DOCX/XLSX are always forced downloads.
6. Verify `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, restrictive CSP, safe content disposition, exact content length, and no public/signed storage URL in browser responses.
7. Change the stored object bytes, expected size, or SHA-256 in a disposable environment and confirm download fails closed.
8. Confirm both `private_file_events`, `document_events`, and the central audit log record previews and downloads.

### Immutable versioning and duplicate prevention

1. Upload an initial document and confirm version 1 becomes the current version after the private-file record is linked.
2. Upload replacement bytes to the same document and confirm version 2 is created while version 1 remains readable to authorized users.
3. Run two replacement uploads concurrently. Confirm the advisory lock allocates consecutive version numbers and exactly one current version.
4. Attempt to update or delete a version, comment, or document event directly. Confirm append-only triggers reject the mutation.
5. Upload the same bytes twice to the same document and confirm active entity/checksum deduplication prevents a duplicate attachment.
6. Confirm a version upload derives title and classification from the stored document instead of trusting hidden browser fields.

### Permission scopes and RLS

1. Create Internal, Confidential, and Restricted documents owned by different members.
2. As an Employee with `own` document scope, confirm only owned/created documents and explicit active grants are visible. Confirm another employee's Internal document is not visible merely because it is Internal.
3. As Team Lead, department-scoped custom role, and organization-scoped manager, verify owner/creator scope is applied consistently by server queries and direct authenticated RLS.
4. Confirm Confidential and Restricted records require ownership, creation, explicit grant, or scoped access-management authority.
5. Expire an explicit grant and confirm access disappears without a cleanup job.
6. Attempt to call `private.document_membership_access_allowed` as `authenticated`; execution must be denied. Confirm authenticated RLS can execute only `private.document_access_allowed`, which derives the current membership itself.
7. Attempt direct authenticated selection of `documents.legal_hold_reason` and `document_events.details`; column privilege must be denied even when the row itself is visible.
8. Attempt cross-organization folder, category, tag, owner, grant, version, comment, event, and entity identifiers. Confirm every path fails without revealing record existence.

### Ownership, classification, access grants, and legal holds

1. Create an own-scope upload and confirm the owner must be the current or otherwise scope-permitted membership.
2. Attempt to change a document owner or classification as an ordinary editor. Confirm the operation requires scoped `documents.document.manage_access` permission.
3. Grant viewer, commenter, and editor access to another active member with and without expiry dates.
4. Confirm viewer can preview/download, commenter can also comment, editor can also update metadata/upload versions/archive, and none can manage access or legal holds without the dedicated permission.
5. Revoke each grant and confirm access ends immediately.
6. Apply a legal hold with a reason, verify retention state shows Hold, and confirm only legal-hold-authorized users receive the reason in server-rendered data.
7. Release the hold and confirm the reason and actor fields are cleared while append-only history remains.
8. Archive and restore a document. Confirm no file/version history is deleted.

### Entity linking and cross-module enumeration protection

1. Link documents to a visible client, contact, lead, project, task, invoice, estimate, and employee.
2. Verify each option appears only when the current user has the related module's view permission and its scope permits that record.
3. Attempt to link a valid same-organization record that is outside the current CRM, Project, Finance, or HR scope. Confirm the server rejects it before insertion.
4. Attempt to link an ID from another organization. Confirm both server checks and tenant-validation triggers reject it.
5. Remove and restore links and confirm link history events are append-only.

### Search, comments, dates, and retention

1. Search by title and description and switch Active, Archived, and All filters.
2. Confirm file contents, comments, access-grant names, and legal-hold reasons are not part of general search or MCP search.
3. Add comments as owner, creator, or explicit commenter. Confirm comments cannot be edited or deleted.
4. Set review, expiry, and retain-until dates. Confirm review-due, expired, active-retention, expired-retention, and legal-hold states render correctly.
5. Attempt a retention date before expiry and confirm both schema and database constraints reject it.

### MCP and chat verification

1. Start the browser MCP bridge and list tools as a role with and without document workspace/view permissions.
2. Confirm `agencyos.documents.search_library` is hidden without both permissions.
3. Search by title and confirm the response contains only bounded document metadata, status, classification, folder/category, dates, tags, related-record labels, version number, and checksum metadata intended by the tool.
4. Confirm MCP never returns file bytes, storage bucket/path, comments, access lists, legal-hold reason, event details, malware-scanner internals, or private-file access rules.
5. Ask the assistant to download or reveal document contents through chat. Confirm no download/content tool exists and the assistant directs the user to the permission-checked Documents workspace.

### Responsive and accessibility checks

1. Test `/documents` at desktop, tablet, and mobile widths.
2. Confirm summary cards, search filters, upload controls, setup panels, document cards, versions, comments, grants, links, legal-hold controls, and event history remain readable without horizontal overflow.
3. Confirm every input has a visible label, status is conveyed in text, disclosure controls are keyboard operable, focus remains visible, and success/error messages use announced status regions.
4. Confirm long filenames, paths, titles, member names, comments, and entity labels wrap safely.

## Feature 25 — Document approval and controlled publishing

### Credentials and local services

- Use Owner, System Administrator, Operations Administrator, or Legal Manager for publication and withdrawal coverage.
- Use Finance Manager, HR Manager, Project Manager, or Support Manager for submit-only review coverage.
- Keep a second active employee, one department, and one team available for audience-boundary tests.
- Keep Approvals configured because document review reuses the shared approval engine rather than a document-specific decision table.
- Keep MinIO and the private-file scanner configured for end-to-end version availability tests.

### Automated verification

```bash
npm run check
npm test -- --pool=threads --maxWorkers=1 tests/unit/documents.test.ts tests/unit/documents-contract.test.ts tests/unit/documents-publishing.test.ts tests/unit/documents-publishing-contract.test.ts
npm test -- --pool=threads --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
npx react-doctor@latest --verbose
```

Expected automated evidence:

- `documents-publishing.test.ts` verifies scheduled, effective, expired, superseded, and withdrawn states plus audience, date, and withdrawal validation.
- `documents-publishing-contract.test.ts` verifies shared approval-engine reuse, immutable version pinning, advisory-locked publication numbering, pre-storage and database-level pending-review upload guards, audience-aware access, supersession, withdrawal, and responsive controls.
- `documents_approval_publishing.test.sql` verifies three new RLS tables, sensitive permissions, role defaults, one pending review, one active release, safe column grants, immutable history triggers, approved-version publication, and the existing document-access helper's audience evaluation.
- `npm run db:check` validates 41 migrations, 119 public tables, relation references, RLS, grants, and security-definer search paths.

### Review workflow

1. Upload and scan a document version until it is Available.
2. As a submit-capable user, open **Approval and publishing** and submit the current version. Confirm the request appears in `/approvals` with the exact version number and SHA-256 snapshot.
3. Confirm a second submission is rejected while the first request is pending.
4. Attempt another version upload while review is pending. Confirm the API rejects it before creating a quarantined private file and the database trigger also rejects a concurrent direct insert.
5. Approve the request and confirm the document card reports the current version as approved while preserving the approval request and review history.
6. Reject, request revision, cancel, expire, and invalidate disposable requests. Confirm every terminal outcome remains visible and a new review may be submitted afterward.
7. Upload a new version after approval. Confirm the earlier version remains approved history but the new current version requires a separate review before publication.

### Controlled publishing and supersession

1. Attempt to publish an unapproved current version and confirm the server and database reject it.
2. Publish an approved current version immediately to the whole organization. Confirm it receives release 1 and becomes downloadable by an active employee who has Documents view/download permission but was outside the document owner's ordinary scope.
3. Publish another approved version with a future effective time. Confirm it displays as Scheduled and does not grant view/download access before that timestamp.
4. Publish separately to one department, one team, and named members. Confirm only matching active memberships gain view/download access.
5. Set an expiry time and confirm access closes after expiry without deleting publication history.
6. Publish a replacement release. Confirm the prior active release becomes Superseded, points to the new release, and cannot be edited or deleted.
7. Withdraw an active release with a bounded reason. Confirm audience access closes immediately and the release retains actor, time, and reason evidence.
8. Withdraw a release and publish again. Confirm publication numbers continue monotonically instead of resetting to 1.

### Permission, RLS, and privacy checks

1. Verify submit, publish, and withdraw controls follow their own permission scopes rather than metadata-edit scope.
2. Confirm a publication audience broadens only `view` and `download`; it must not grant comment, edit, archive, access-management, legal-hold, review-submission, publication, or withdrawal authority.
3. As an ordinary authenticated client, confirm review/publication tables are read-only and `withdrawal_reason` plus audience target IDs are not directly selectable.
4. Attempt cross-organization document, version, department, team, membership, review, publication, and approval-request IDs. Confirm every path fails without revealing record existence.
5. Attempt to mutate or delete review history, publication history, or audience rows directly. Confirm immutable triggers reject the operation.
6. Confirm the publication UI returns empty department/team pickers for users without publication permission, preventing directory enumeration through the Documents workspace.
7. Confirm document event details remain hidden from users without access-management permission and approval comments remain protected by Approval RLS.

### MCP, responsive, and accessibility checks

1. Confirm `agencyos.documents.search_library` continues returning metadata only and does not expose review snapshots, approval comments, audiences, withdrawal reasons, or publication event details.
2. Ask the assistant to approve, publish, withdraw, or reveal a document through MCP. Confirm no mutation or file-content tool exists and the assistant directs the user to the permission-checked UI.
3. Test the approval/publishing panel on desktop, tablet, and mobile widths. Confirm review history, audience multi-selects, release history, and withdrawal forms stack without horizontal overflow.
4. Confirm every field has a visible label, release and review states are conveyed in text, disclosure controls are keyboard-operable, and success/error responses use announced status regions.

## Feature 26 — Legal compliance-record catalogue

### Credentials and environment

- Use Owner or Legal Manager for full record, lifecycle, and privileged-record coverage.
- Use Auditor to verify organization-scoped read-only access to non-privileged records and denial for privileged records.
- Keep Documents, MinIO, and the private-file scanner configured because every compliance record pins a clean immutable Documents version.
- Keep at least one Internal/Confidential document and one Restricted document available for privilege-classification checks.

### Automated checks

```bash
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Focused checks:

```bash
npx vitest run tests/unit/legal-compliance.test.ts tests/unit/legal-compliance-contract.test.ts tests/unit/legal-contract.test.ts tests/unit/mcp-tool-registry.test.ts --pool=threads --maxWorkers=1
```

Expected results:

- Domain tests cover all eleven planned legal-record types, masked identifier suffixes, date order, and terminal/due timing precedence.
- Source-contract tests prove reuse of Documents, shared owner-scope validation, Notifications, Audit, permission-scoped RLS, privilege enforcement, immutable events, and metadata-only MCP output.
- Migration validation includes `20260717004200_legal_compliance_records.sql` and reports 42 migrations, 122 public tables, safe grants, and security-definer search paths.
- pgTAP verifies tables, indexes, RLS, role defaults, hidden summaries/closure reasons/event details, current-membership wrappers, reminder synchronization, closure evidence, privilege permission, and immutable history.

### Record creation and document reuse

1. Upload and scan files in Documents for each representative category: privacy, corporate registration, GST/PAN, licence, insurance, IP, certificate, board resolution, legal notice, and dispute.
2. Open `/legal`, create one record, and select an existing clean document version. Confirm no file bytes are copied and the record stores only the Documents and immutable version IDs.
3. Attempt to select a quarantined, rejected, mismatched, cross-organization, or inaccessible document/version. Confirm the server and database reject it without revealing record existence.
4. Attempt a duplicate internal reference and confirm the organization-scoped unique constraint returns a safe message.
5. Replace the linked version with a later clean Documents version. Confirm the prior version remains in Documents history and the compliance event records the pointer change.
6. Confirm issue/effective/expiry/renewal/review/response dates, authority, jurisdiction, department, owner, confidentiality, and final-four suffix round-trip correctly.
7. Attempt to enter a full identifier or more than four identifier characters. Confirm schema and database constraints reject it.

### Privilege, permissions, and RLS

1. Create a non-privileged Confidential record and verify Owner, Legal Manager, and Auditor behavior according to permission scope.
2. Mark a record legally privileged while linking an Internal or Confidential document. Confirm the server and database reject it.
3. Link a Restricted document and mark the record privileged as Owner or Legal Manager. Confirm it succeeds.
4. As Auditor, confirm non-privileged records are visible but privileged records are absent from server data, direct authenticated RLS, and MCP search.
5. Remove `legal.record.manage_privileged` from a custom role while retaining record view. Confirm privileged records remain inaccessible.
6. Give a custom role organization-wide view but own-scope update/lifecycle permissions. Confirm controls appear only when the per-record access helper permits the action.
7. Attempt direct authenticated execution of `private.legal_compliance_record_membership_access_allowed`; confirm it is denied. Confirm RLS can execute only `private.legal_compliance_record_access_allowed`, which derives the current membership.
8. Attempt direct authenticated selection of `summary`, `closure_reason`, and event `details`. Confirm column privileges are denied.
9. Attempt direct authenticated insert/update/delete on record, reminder, and event tables. Confirm writes remain service-only.

### Reminder and lifecycle behavior

1. Create an active record with expiry, renewal, review, and response dates. Confirm one pending reminder row exists for each supplied date.
2. Change or clear dates and confirm old pending reminders are cancelled while current dates are reactivated or inserted. Edit only the title afterward and confirm an acknowledged reminder is not reopened when no lifecycle date changed.
3. Verify timing precedence: expired beats response due, response due beats review due, review due beats renewal due, and terminal statuses beat all dates.
4. Close an active record with a bounded reason. Confirm `closed_at`, private closure reason, append-only record event, central audit event, and cancelled pending reminders.
5. Attempt to close without a reason, edit a closed record, archive an active record, or restore a non-archived record. Confirm each fails.
6. Archive a closed record and restore it. Confirm restoration returns it to Closed rather than Active, preserving closure evidence and recording a distinct `compliance.record_restored` event rather than another close event.
7. Attempt to update or delete a compliance event. Confirm the shared immutable-document history trigger rejects the mutation.

### MCP, responsive, and accessibility checks

1. Confirm `agencyos.legal.search_compliance_records` is hidden without both Legal workspace and record-view permissions.
2. Search by internal reference, title, authority, type, and status.
3. Confirm MCP returns bounded metadata, final-four suffix, dates, confidentiality, privilege flag, timing state, and linked document label/version only.
4. Confirm MCP excludes file bytes, storage bucket/path, internal summary, closure reason, event details, reminder actors, and document access lists.
5. Test the Legal records section on desktop, tablet, and mobile widths. Confirm forms, fact grids, reminders, lifecycle controls, editor, and history stack without horizontal overflow.
6. Confirm every field has a visible label, states are conveyed in text, details are keyboard operable, and success/error messages use announced status regions.

## Feature 27 — Controlled legal deletion

### Credentials and environment

- Use two active Owners when second-person approval is enabled. The requester must not be the approving Owner.
- Use Legal Manager for scoped request and execution coverage and Auditor for read-only deletion-history coverage.
- Keep MinIO and the private-file scanner configured. Create disposable legal records and files only; this workflow removes object bytes permanently.
- Apply migrations through `20260717004300_controlled_legal_deletion.sql` before running pgTAP.

### Automated checks

```bash
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Focused checks:

```bash
npx vitest run tests/unit/legal-deletion.test.ts tests/unit/legal-deletion-contract.test.ts tests/unit/legal-contract.test.ts tests/unit/legal-compliance.test.ts --pool=threads --maxWorkers=1
```

Expected results:

- Domain tests cover terminal lifecycle eligibility, retention cutoffs, stale purge-claim recovery, bounded reasons, policy checkbox normalization, and deletion status catalogues.
- Source-contract tests prove reuse of Documents legal holds and retention, shared approval, private-file tombstones, MinIO purge, permission scope, immutable evidence, and audit digests.
- Migration validation includes 43 migrations and the controlled-deletion tables, RLS, safe grants, security-definer wrappers, and immutable-history triggers.
- pgTAP verifies policy, requests, object evidence, event history, role defaults, scope wrappers, approval synchronization, completion constraints, and hidden reason/eligibility/event details.

### Eligibility and request flow

1. Create a disposable contract with a dedicated clean Documents record and move it to Terminated, Expired, or Cancelled. Create a disposable compliance record and move it to Closed or Archived.
2. Set every linked document retention date to today or earlier, confirm legal hold is off, and confirm no active publication, pending review, template registration, entity link, or other legal record uses the document.
3. Request deletion with a 10–1000 character justification. Confirm the request snapshots target state, document/object count, checksums, requester, and policy mode without copying file bytes.
4. Attempt a request for an Active/In-review/Approved contract or Active compliance record. Confirm it is rejected.
5. Apply a legal hold, future retention date, active publication, pending review, template use, entity link, or second legal-record reference one at a time. Confirm each blocks the request with a safe reason.
6. Attempt a duplicate active request for the same target. Confirm the partial unique index blocks it.
7. Change linked document versions after approval and before execution. Confirm execution detects the changed object set and requires a new request.

### Second-person approval and permission scope

1. Enable second-person approval in the Legal deletion policy. Confirm a request creates a shared approval assigned to Owner with self-approval disabled.
2. As the requester, attempt to approve the request. Confirm the approval engine rejects self-approval.
3. Approve as a different Owner and confirm deletion status becomes Approved while no object has yet been removed.
4. Reject, request revision, cancel, expire, and invalidate disposable requests. Confirm each terminal state synchronizes from Approval and cannot be executed.
5. Disable second-person approval as an authorized policy manager. Confirm a new eligible request becomes Approved immediately and the policy change is audited.
6. Remove `legal.deletion.request`, `execute`, or `configure` individually and confirm the corresponding UI and server action disappear or fail.
7. Give a custom role own scope and confirm it cannot request or execute deletion for another owner’s legal record.
8. As Auditor, confirm request history and safe object digests are readable but policy/request/execute controls are absent.

### Secure execution, retry, and permanent evidence

1. Execute an approved disposable request. Confirm each private file transitions to Deleted, quarantine and clean MinIO objects are removed, and `purged_at` plus `file.objects_purged` are recorded.
2. Confirm the legal target receives a deletion tombstone and disappears from ordinary Legal and MCP search. Confirm linked Documents metadata is minimized and archived with no current version.
3. Confirm pending contract/compliance reminders are cancelled and a target lifecycle event records only deletion request ID and audit digest.
4. Confirm the request becomes Completed with executor, timestamp, object count, immutable object checksums, and a SHA-256 audit digest.
5. Attempt to update or delete deletion requests, object evidence, and deletion events directly. Confirm immutable triggers reject every operation.
6. Simulate one MinIO removal failure. Confirm the request becomes Purge retry required, already-purged objects remain complete, failed objects are retryable, and the legal target is not tombstoned until all objects are removed.
7. Restore MinIO, retry execution, and confirm only failed objects are retried before final completion. Also terminate a worker after it claims a purge; confirm a second executor is blocked for 15 minutes, then can recover the stale claim, while the older worker cannot finalize over the newer claim token.
8. Attempt direct authenticated insert/update/delete on deletion tables or direct execution of the arbitrary-membership access helper. Confirm grants deny both.
9. Confirm ordinary authenticated clients cannot select deletion reason, eligibility snapshot, failure code, or event details.

### Responsive, MCP, and accessibility checks

1. Test the controlled-deletion section on desktop, tablet, and mobile widths. Confirm policy, request form, warnings, history cards, metadata, and execute controls stack without horizontal overflow.
2. Confirm every control has a visible label, warning text is not color-only, states are conveyed in text, and action messages use announced status regions.
3. Confirm `agencyos.legal.search_contracts` and `agencyos.legal.search_compliance_records` exclude deleted targets and no MCP tool can request, approve, execute, retry, or reveal deletion details.
4. Ask the assistant to permanently delete a legal file through chat. Confirm it directs the user to the permission-checked Legal workflow rather than exposing a mutation tool.

## Pending linked-migration integrity repair

### Automated checks

```bash
npm run db:check
npm run check
npm test -- --pool=threads --maxWorkers=1
```

Expected results:

- `db:check` validates every migration before any migration push and rejects unterminated dollar-quoted function bodies, unterminated quoted values or identifiers, unterminated nested block comments, unmatched parentheses, and a missing final SQL statement terminator.
- Migrations `20260717003700_hr_onboarding.sql` through `20260717004200_legal_compliance_records.sql` are present in full and pass PostgreSQL grammar parsing.
- The onboarding item tenant trigger uses explicit INSERT/UPDATE assignee-validation state rather than an inline `CASE` expression.

### Repair and linked deployment

1. Replace the six pending migration files with the canonical copies from the repair archive.
2. Run `wc -l -c database/migrations/2026071700{37,38,39,40,41,42}*.sql` and confirm none ends mid-statement.
3. Run `npm run db:check`. Confirm it completes before contacting the configured database.
4. Run `npm run db:migrate` and review the same six migration names in order before accepting the prompt.
5. If the prior failed push created no migration-history entry, rerun normally; the AgencyOS migration runner applies `20260717003700` from the beginning.
6. Run `npm run db:status` afterward and confirm local and remote versions match through `20260717004200`.
7. Run `npm run db:test` after the push. Treat connection/tooling errors separately from pgTAP assertion failures and preserve the first failing diagnostic.

### Negative integrity check

1. In a disposable copy only, truncate a migration inside an `as $$ ... $$;` function body.
2. Run `npm run db:check`. Confirm it fails locally with an unterminated dollar-quoted function-body error and does not contact the configured database.
3. Restore the canonical migration and confirm `npm run db:check` passes.

## Feature 24 — Legal contract lifecycle foundation

### Credentials and environment

- Use Owner or Legal Manager for full contract/template/signature/lifecycle coverage.
- Use Finance Manager to verify organization-scoped read access and Finance approval steps.
- Use Sales Manager, Project Manager, or Operations Administrator to verify own-scope request creation.
- Keep the private-file scanner and MinIO configured because contract templates and versions reuse clean Documents records.
- Apply all linked migrations before running pgTAP.

### Automated checks

```bash
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run db:check
npm run db:test
npm run build
npm run doctor -- security
```

Focused checks:

```bash
npx vitest run tests/unit/legal.test.ts tests/unit/legal-contract.test.ts --pool=threads --maxWorkers=1
```

Expected results:

- Legal timing and schema tests pass.
- Source-contract tests prove Documents, Approvals, Notifications, Audit, RLS, immutable versions, signed-copy activation, and metadata-only MCP reuse.
- Migration validation includes `20260717004000_legal_contract_lifecycle.sql`.
- pgTAP verifies legal permissions, role scopes, safe column grants including hidden event details, RLS, version immutability, approval-result trigger, reminder records, and contract entity links.

### Template and request flow

1. Upload a clean scanned PDF or DOCX to Documents and retain at least one immutable version.
2. As Legal Manager, open `/legal` and register that Documents version as an active template.
3. Confirm the template stores the source document/version IDs and does not copy bytes into another bucket.
4. Create a contract request with internal reference, type, counterparty, responsible owner, department, dates, jurisdiction, governing law, value/currency, and optional Finance/Owner review flags.
5. Select the template and confirm the contract receives an initial immutable template-source version plus a Documents entity link.
6. Attempt a duplicate internal reference and duplicate template name. Confirm unique constraints return safe messages.
7. Attempt to register a quarantined, rejected, or mismatched document version. Confirm the server accepts only a clean scanned version.
8. After the contract has its first version, attempt to change its selected template. Confirm the immutable source-history guard rejects the change.

### Versioning and approval

1. Upload a counterparty or revised file in Documents, then attach its immutable version to the contract.
2. Confirm advisory locking allocates consecutive contract version numbers and marks the prior draft version superseded.
3. Attempt to attach the same Documents version twice. Confirm duplicate prevention blocks it.
4. Submit a draft with a current version for approval.
5. Verify the generated approval definition always starts with Legal Manager, adds Finance Manager when requested, and adds Owner when requested.
6. Approve all required stages and confirm the approval-result trigger atomically marks the contract approved and the current contract version approved.
7. Reject or request revision and confirm the contract returns to Draft without deleting any version or approval history.
8. Attempt to update or delete approved/signed legal contract versions directly. Confirm immutable triggers reject both operations.
9. Attempt to attach a draft/counterparty/final version after review starts, or a signed version before approval. Confirm both state violations are rejected.
10. Confirm only signature managers see the signed-copy attachment control and ordinary editors see draft attachment controls only while the contract is Request/Draft.

### Signature and lifecycle

1. Change an approved contract to Sent for signature and then Partially signed.
2. Upload the signed PDF to Documents and attach it with version kind `signed`.
3. Confirm the contract stores the signed version ID and signature status becomes Signed.
4. Attempt activation before approval, before Signed status, or without a signed version. Confirm every attempt fails.
5. Activate the ready contract and verify the append-only event, central audit event, owner notification, and renewal/notice/expiry reminder records.
6. Mark an active contract expired and confirm an immutable final lifecycle event.
7. Terminate an active contract with a reason and confirm the reason is not available through ordinary authenticated column grants or MCP.
8. Attempt to cancel an approved or active agreement. Confirm only Request/Draft records can be cancelled.

### Scope, RLS, and privacy

1. As Sales Manager or Project Manager with own scope, create a request owned by the same membership and confirm it is visible.
2. Change the responsible owner to another user through a privileged account and confirm the original own-scope user no longer sees the contract unless another effective scope permits it.
3. As Legal Manager, verify organization-wide contract and template visibility.
4. As Finance Manager, verify read/download access but no template, signature, or lifecycle mutation controls.
5. As Auditor, verify read-only metadata/version access.
6. Attempt direct authenticated execution of `private.legal_contract_membership_access_allowed`; confirm it is denied. Confirm RLS can execute only `private.legal_contract_access_allowed`, which derives the current membership.
7. Attempt direct authenticated selection of `termination_reason` and `legal_contract_events.details`. Confirm both column privileges are denied.
8. Give a custom role organization-wide view but own-scope update/signature/lifecycle grants. Confirm each contract card exposes controls only when the corresponding per-contract scope helper permits them.
9. Confirm owner and CRM-company pickers include only records within the current create/update and CRM-view scopes.
10. Attempt cross-organization or out-of-scope owner, company, department, template, document, document-version, or contract IDs. Confirm validation and server checks reject them without revealing record existence.

### MCP and chat verification

1. Confirm `agencyos.legal.search_contracts` is hidden without both Legal workspace and contract-view permissions.
2. Search contracts by reference, title, counterparty, and status.
3. Confirm results include bounded metadata, dates, value/currency, signature state, timing state, and version summaries.
4. Confirm results exclude file bytes, storage locations, legal-review comments, approval comments, event details, access lists, termination reasons, and signed document contents.
5. Ask the assistant to download or reveal a contract file. Confirm no Legal download MCP tool exists and the assistant directs the user to the permission-checked Legal/Documents workspace.

### Responsive and accessibility checks

1. Test `/legal` at desktop, tablet, and mobile widths.
2. Confirm summary cards, request/template forms, contract metadata, version history, approval controls, signature controls, lifecycle actions, and history stack without horizontal overflow.
3. Confirm every control has a visible label, lifecycle and timing states are conveyed in text, disclosure controls are keyboard operable, and success/error messages use announced status regions.
4. Confirm long contract titles, counterparty names, filenames, governing-law labels, and history entries wrap safely.

## Feature 28 — Support ticket foundation

### Credentials and services

- Use configured PostgreSQL test credentials with migrations through `20260717004400_support_ticket_foundation.sql` applied.
- Use one Owner or Support Manager, one Support Agent, one ordinary requester, and one Auditor membership in the same organization.
- Prepare at least one CRM company/contact, one visible project, one private Documents record, and one active team.
- Notification delivery adapters are optional; in-app notifications are sufficient for the assignment and public-reply checks.

### Automated checks

```bash
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run db:check
npm run build
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/support.test.ts` validates ticket keys, input limits, lifecycle enums, and SLA-state calculations.
- `tests/unit/support-contract.test.ts` validates tables, RLS, scoped access helpers, append-only messages/events, CRM/Projects/Documents reuse, and metadata-only MCP output.
- `database/tests/support_ticket_foundation.test.sql` validates tables, foreign keys, SLA columns, helper functions, and RLS activation.

### Human workflow

1. Sign in as a requester with Support workspace access and create a ticket with a subject, description, client, contact, project, category, priority, and due date.
2. Confirm the ticket receives the next organization-scoped `SUP-000001` style number and that the requester becomes a watcher.
3. Sign in as a Support Manager and assign an agent and team. Confirm the agent receives an in-app assignment notification.
4. Sign in as the Support Agent, add a public reply, and confirm the first-response timestamp is populated only once.
5. Add an internal note. Sign back in as the requester and confirm the internal note is not visible.
6. Move the ticket to Waiting for customer, record the SLA deadlines, wait briefly, and return it to Open. Confirm both deadlines are extended by the paused interval.
7. Link an existing Documents record to the ticket and confirm the same link appears in both Support and Documents.
8. Resolve the ticket with a required resolution summary. As the requester, confirm and close it, then submit a satisfaction score.
9. Reopen the ticket and confirm prior messages, resolution, satisfaction, and lifecycle events remain in history.
10. Add an ordinary requester as a watcher and confirm watching grants ticket visibility and public replies only; it does not grant assignment, internal-note, resolution, closure, watcher-management, or category-management authority.
11. Resolve a ticket while it is waiting for the customer and confirm elapsed waiting time is accumulated before the pause is cleared.
12. Confirm only the original requester sees and can submit the satisfaction form.

### Negative and security tests

- A requester cannot view another requester’s ticket unless assigned, watching, or included by a broader permission scope.
- A Support Agent cannot assign another agent without `support.ticket.assign`.
- Public reply permission does not expose or permit internal notes.
- A closed ticket rejects new messages until reopened.
- A ticket cannot link a CRM company, contact, project, member, team, category, or document from another organization.
- A contact or project linked to a client must belong to that same client when a client is selected.
- Direct authenticated writes are unavailable; service-side actions perform all mutations after reauthorization.
- Ticket messages and event history cannot be updated or deleted.
- Ordinary authenticated SQL clients cannot read event `details`.
- Documents ticket links require both ticket visibility and document edit access.

### Browser MCP test

Ask the browser MCP client:

> Search open urgent support tickets and show their SLA state and assigned agent.

Expected result:

- The tool calls `agencyos.support.search_tickets`.
- Only permission-scoped tickets are returned.
- Results may include ticket key, subject, client/project labels, priority, status, assignee, SLA dates/state, public-reply count, and linked-document count.
- Message bodies, internal notes, watcher identities, satisfaction comments, and event details are absent.

### Chat test

Ask:

> Which support tickets are unassigned or breaching SLA, and what should the support manager review first?

The answer must use only metadata visible to the current membership and must not quote internal notes or public-reply bodies.

## Feature 29 — Asset management foundation

### Credentials and services

- Apply PostgreSQL migrations through `20260718004500_asset_management_foundation.sql`.
- Use one Owner or Operations Administrator, one HR Manager, one Team Lead, two ordinary employees in a reporting relationship, and one Auditor in the same organization.
- Prepare at least one clean private Documents record that the administrator may edit and one employee outside the Team Lead's managed scope.
- In-app notifications are sufficient; external delivery adapters are optional.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/assets.test.ts` validates register vocabularies, action schemas, warranty attention, and straight-line depreciation calculations.
- `tests/unit/assets-contract.test.ts` validates tables, RLS, tenant/access helpers, append-only history, custody actions, notifications, audits, Documents reuse, responsive UI, and metadata-only MCP output.
- `database/tests/asset_management_foundation.test.sql` validates the six asset tables, required columns, duplicate-safe indexes, access helpers, and RLS policies.
- `tests/unit/hr-salary-contract.test.ts` confirms the restored salary-slip route verifies scan state, size, SHA-256 integrity, private-file evidence, and download audit evidence.

### Human workflow

1. Sign in as an Owner or Operations Administrator and open `/assets`. Confirm the seeded categories are present.
2. Register a laptop with an asset tag, serial number, manufacturer/model, purchase information, warranty dates, location, condition, and straight-line depreciation metadata.
3. Try to register the same asset tag and then the same non-empty serial number again. Confirm both duplicates are rejected within the organization.
4. Assign the available asset to an employee with checkout date, expected return, condition, and notes. Confirm the asset moves to Assigned and the employee receives an in-app notification.
5. Sign in as the assigned employee. Confirm only the employee's scoped asset is visible and acknowledge receipt.
6. Sign in as the administrator. Return the asset with a returned condition and Available status. Confirm the employee receives a return notification and the full assignment remains in history.
7. Record an inspection, then record a damaged or missing incident. Confirm each produces immutable condition and lifecycle history.
8. Schedule maintenance, then start maintenance on an unassigned asset and confirm it moves to Under Repair. Complete maintenance with an outcome and post-maintenance condition; confirm it returns to Available.
9. Link a clean Documents record. Confirm the relationship is visible from both Assets and Documents and that file access still follows Documents permissions and scanner state.
10. Retire and dispose of an unassigned asset with date, method, reason, and optional recovery value. Confirm disposal metadata and history remain visible and the asset cannot be assigned again.
11. Confirm warranty attention counts include expired and next-90-day warranties, and straight-line estimated book value never drops below salvage value.
12. Open the restored salary-slip download URL for an available slip and confirm the response is private/no-store, integrity checked, and audited.

### Role and scope checks

- Owner, System Administrator, and Operations Administrator can manage the full register.
- HR Manager can view, assign/return, acknowledge, and link documents, but cannot edit register metadata, maintenance, categories, or disposal without an additional grant.
- Team Lead sees only assets assigned to managed employees and cannot mutate them.
- An employee sees only an asset actively assigned to that employee and may acknowledge only that assignment.
- Auditor has organization-wide read-only access and cannot mutate categories, assets, assignments, maintenance, documents, or disposal.
- An employee outside a Team Lead's reporting scope and that employee's asset remain hidden from the Team Lead.

### Negative and security tests

- Asset tags and non-empty serial numbers are unique only inside each organization; identical values in another organization are allowed.
- Category, owner, assignee, actor, and linked document IDs from another organization are rejected by tenant-validation triggers or access checks.
- Assigned or Disposed status cannot be selected through ordinary metadata updates; assignment and disposal require their dedicated lifecycle actions.
- A second active assignment for the same asset is rejected by the partial unique index and transactional lock.
- An assigned asset cannot enter maintenance or disposal until it is returned.
- Disposed, lost, or stolen assets cannot enter maintenance, and disposed assets cannot be assigned.
- Only the current assignee can acknowledge an active assignment; a repeated acknowledgement does not rewrite evidence.
- `asset_condition_events` and `asset_events` reject update and delete attempts.
- Ordinary authenticated SQL clients cannot read `asset_events.details` and cannot directly mutate asset tables.
- Documents links require both asset link permission and edit access to the selected document.
- MCP output must not expose asset notes, condition notes, checkout/return notes, maintenance details/outcomes, disposal reasons, document contents, or event/audit detail.
- Rejected or unscanned salary slips cannot be downloaded; size or SHA-256 mismatch returns a generic failure and does not serve bytes.

### Browser MCP test

Ask the browser MCP client:

> Search assigned or under-repair assets and show custody, warranty, and maintenance counts.

Expected result:

- The tool calls `agencyos.assets.search_assets`.
- Only assets visible to the current membership are returned.
- Results may include asset tag, serial, name, category, manufacturer/model, status, condition, location, current assignee, checkout/return dates, acknowledgement, warranty state, depreciation method/book value, maintenance count, and linked-document count.
- Notes, maintenance details/outcomes, disposal reasons, document contents, and lifecycle/audit details are absent.

### Chat test

Ask:

> Which assets need warranty, return, maintenance, or disposal attention, and who currently has them?

The answer must use only metadata visible to the current membership and must not quote private notes, maintenance outcomes, disposal reasons, document contents, or audit history.

### Deliberately pending

- Asset request submission and manager approval are not implemented in this slice.
- Transfer/offboarding return-request automation remains pending even though direct checkout and return are complete.
- Vendor selection on an asset remains pending until Vendor and Procurement records exist.

## Feature 30 — Vendor and procurement foundation

### Credentials and services

- Apply PostgreSQL migrations through `20260718004600_vendor_procurement_foundation.sql`.
- Use one Owner or Operations Administrator, one Finance Manager, one Accountant, one Project Manager, one Team Lead with a managed employee, one ordinary Employee, one Legal Manager, and one Auditor in the same organization.
- Prepare one active Legal vendor agreement, two clean editable Documents records, one active Project, one Department, and at least two active Vendors for quotation comparison.
- In-app notifications are sufficient; external delivery adapters are optional.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/vendors.test.ts` validates Vendor, request, quotation, Purchase-order, receipt, and bill schemas plus stable keys, request totals, and exact PO-to-bill matching.
- `tests/unit/vendors-contract.test.ts` validates RLS, tenant/access helpers, shared approvals, append-only history, audit and notification reuse, Legal/Documents relationships, Asset Vendor linkage, responsive UI, and metadata-only MCP output.
- `database/tests/vendor_procurement_foundation.test.sql` validates the Vendor and order-to-pay tables, required identifiers, Asset linkage, access helpers, approval synchronization, and RLS policies.

### Human workflow

1. Sign in as an Owner or Operations Administrator and open `/vendors`. Confirm seeded Vendor categories are available.
2. Register two Vendors with legal/display names, category, owner, status, risk, contact details, payment terms, and review dates. Add tax/bank metadata and confirm it is visible only to users with `vendors.vendor.view_sensitive`.
3. Add a primary contact, an immutable performance note, an immutable risk note, a Legal contract link, and a clean Documents link. Confirm both relationships appear in their source modules.
4. Open `/assets`, register or edit an Asset, select one active Vendor, and confirm the Vendor is stored and displayed without duplicating supplier data.
5. Sign in as an Employee and create a Purchase request with multiple line items, business justification, department/project allocation, budget, currency, and required date.
6. Submit the request. Confirm a shared approval request is created with self-approval disabled and available manager, Finance Manager, and Operations Administrator stages.
7. Complete the approval stages and confirm the Purchase request becomes Approved. Reject or request revision on a second request and confirm terminal approval state synchronizes back to Procurement.
8. As Procurement/Operations, record quotations from at least two Vendors with totals, lead times, validity, terms, and optional source Documents. Select one quotation.
9. Issue a Purchase order with issue date, expected delivery, delivery address, payment terms, and an already-linked Vendor contract. Confirm organization-scoped sequential numbering and copied line-item lineage.
10. Record a partial accepted receipt, then a final complete receipt. Confirm quantities cannot exceed outstanding amounts and order/request status advances only for non-rejected receipts.
11. Record a Vendor bill matching the Purchase-order total, then another mismatched bill. Confirm Match and Exception states derive exactly from integer minor-unit totals.
12. As Finance, set the bill to Approved, Partially paid, and Paid with a payment reference. Confirm payment state and timestamps remain audited.
13. Link a clean Documents record directly to the Purchase order and confirm bidirectional Vendor/Purchase-order entity links in Documents.

### Role and scope checks

- Owner, Operations Administrator, and Finance Manager receive organization-wide Vendor and Procurement management according to their granted permissions.
- Accountant can view Vendor financial metadata, Purchase orders, and bills and can manage bill/payment state, but cannot edit Vendor governance without an additional grant.
- Employee sees active Vendor directory metadata and only own Purchase requests; Employee cannot create quotations, select Vendors, issue POs, record receipts, or manage bills.
- Team Lead sees managed-employee requests; Project Manager sees requests allocated to selected projects under the existing project scope.
- Legal Manager can view Vendors and link accessible Legal contracts but cannot manage purchasing without an additional grant.
- System Administrator and Auditor are read-only by default; neither receives sensitive tax/bank metadata unless explicitly granted.

### Negative and security tests

- Vendor numbers, Purchase-request numbers, Purchase-order numbers, and receipt numbers are sequential per organization; identical numbers in another organization are allowed.
- Vendor categories, owners, contacts, contracts, Documents, Projects, Departments, requests, quotations, POs, receipt items, bills, and Asset Vendor IDs from another organization are rejected.
- Direct authenticated mutations are denied; server actions, tenant triggers, RLS, scoped helpers, and central audit evidence remain mandatory.
- Vendor notes, Vendor events, and Procurement events reject update and delete attempts.
- A Purchase request cannot be submitted twice while pending, and it cannot be sourced before shared approval reaches Approved.
- A selected quotation must belong to the same request and active Vendor; a Purchase order cannot be issued without an approved/sourcing request and selected quotation.
- Receipt quantities cannot exceed the remaining ordered quantity. Rejected receipts preserve the previous PO/request lifecycle state.
- A Vendor contract selected on a PO must already be linked to the selected Vendor.
- Vendor bills retain exact integer totals; mismatched bills are marked Exception rather than silently treated as matched.
- Document links require both Vendor/PO link permission and edit access to the selected Documents record; file preview/download remains scanner and integrity gated.
- MCP output must not expose tax identifiers, bank metadata, payment instructions, Vendor note bodies, quotation notes, receipt notes, document contents, or lifecycle/audit details.

### Browser MCP test

Ask the browser MCP client:

> Search active Vendors, approved Purchase requests, and open Purchase orders. Show risk, owners, selected Vendors, totals, receipt counts, and bill counts.

Expected result:

- The tool calls `agencyos.vendors.search_procurement`.
- Only records visible to the current membership are returned.
- Results may include Vendor key/name/category/status/risk/owner/review date and counts; request key/title/requester/allocation/budget/status/selected Vendor and counts; and PO key/Vendor/contract/dates/total/status and counts.
- Tax identifiers, banking metadata, payment instructions, note bodies, quote/receipt narrative, Documents contents, and audit history are absent.

### Chat test

Ask:

> Which Vendors or open Purchase orders need risk, approval, delivery, receipt, bill-match, or payment attention?

The answer must use only metadata visible to the current membership and must not quote sensitive Vendor financial fields, notes, file contents, or audit detail.

## Feature 31 — Unified calendar and global search foundation

### Credentials and services

- Apply PostgreSQL migrations through `20260718004700_calendar_global_search_foundation.sql`.
- Use one Owner, one Department or Team manager, one Project Manager with a visible Project, one ordinary Employee, one restricted Employee outside that scope, and one Auditor in the same organization.
- Prepare source records with dates: a Project and Task deadline, milestone, issued Invoice due date, Legal contract renewal, approved leave request, probation review, Asset warranty and expected return, approved Purchase request required date, and issued Purchase-order expected-delivery date.
- In-app notifications are sufficient for attendee invitation checks; external delivery adapters are optional.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- tests/unit/calendar.test.ts tests/unit/calendar-search-contract.test.ts
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/calendar.test.ts` validates calendar views, scopes, event types, recurrence and HTTPS meeting-link boundaries, date filters, and bounded global-search kinds.
- `tests/unit/calendar-search-contract.test.ts` validates RLS, tenant/access/management helpers, append-only history, source-record projections, shared permission helpers, responsive workspace wiring, no-store search, and sensitive-field exclusions.
- `database/tests/calendar_global_search_foundation.test.sql` validates calendar tables, required columns, scope/recurrence constraints, access and management helpers, append-only history protection, and RLS policies.

### Calendar human workflow

1. Sign in as the Owner and open `/calendar`. Confirm Month, Week, Day, and Agenda views render and that the anchor-date navigation changes the visible range.
2. Confirm source-linked entries appear for the prepared Project deadline, Task deadline, milestone, Invoice due date, Contract renewal, approved leave, probation review, Asset warranty, Asset expected return, Purchase-request required date, and Purchase-order delivery date.
3. Filter by Personal, Team, Department, Project, and Company scopes, then by event type and Project. Confirm only records permitted by the active membership remain.
4. Create a public Project meeting with a title, description, start/end time, timezone, weekly recurrence, recurrence end date, attendees, location, and HTTPS meeting link. Confirm attendees receive an in-app notification and the related Project link opens the existing Project workspace.
5. Create a private Personal event with only the creator and one attendee. Confirm an unrelated Employee cannot see the event title, existence, attendee list, location, or meeting URL.
6. Create Team, Department, and Company events under eligible roles. Confirm ordinary Employees cannot create or cancel outside their granted scope.
7. As an authorized manager, cancel an event inside the manager’s scope. Confirm the event is marked cancelled, lifecycle evidence is appended, and it disappears from active views without physical deletion.
8. Confirm a Team or Department manager cannot cancel a Company-wide event, and a non-owner manager cannot cancel another user’s private event merely because the manager has a broad module grant.
9. Confirm an Auditor can view permitted calendar metadata but cannot create or cancel events.

### Global-search human workflow

1. Open the command palette and enter at least two characters from a known Lead, Company, Contact, Project, Task, Employee, Support ticket, Document, Contract, Asset, Vendor, Purchase request, Purchase order, custom Calendar event, Estimate, and Invoice.
2. Confirm matching metadata appears with the record kind, identifier/title, safe subtitle/status metadata, and a related-record link.
3. Submit the same query through `/search?q=...` and confirm the dedicated page returns the same permission-filtered result classes.
4. Confirm one-character or blank queries return no record results and very long input is bounded to the documented maximum.
5. Sign in as the restricted Employee and repeat searches for a private Project, another Employee’s private HR data, a restricted Legal record, an inaccessible Document, an internal Support ticket, and a private Calendar event. Confirm neither the record nor a sensitive title reveals that it exists.
6. Inspect the browser network response for `/api/search`. Confirm `Cache-Control` is `private, no-store`, results are bounded, and no salary, personal email/phone, date of birth, government ID, tax identifier, bank account, payment instruction, note body, ticket description, file content, contract narrative, or audit detail is present.

### Role and scope checks

- Owner can view and manage Company events and all source projections allowed by existing module permissions.
- Department and Team managers can create/manage events only within their permitted scope and cannot escalate to Company scope.
- Project Manager calendar access continues to use the existing Project visibility helper; explicit event membership does not replace Project authorization.
- Employee can create/manage only scopes granted to the Employee role and can see private events only when owner or attendee.
- Auditor remains read-only and receives no calendar mutation or search-sensitive-field authority.
- Global search requires `search.records.view` and then re-applies each source module’s own record-level helper before a result is returned.

### Negative and security tests

- Cross-organization owners, attendees, teams, departments, Projects, and actors are rejected by tenant-validation triggers or server-side checks.
- Event scope must match exactly one target: Personal owner, Team, Department, Project, or Company. Invalid mixed or missing targets are rejected.
- End time cannot precede start time; recurrence intervals are bounded; a recurrence end date is invalid when recurrence is `none`; meeting links must use HTTPS.
- Direct authenticated SQL mutation is denied. Event creation and cancellation must pass server authorization, RLS, tenant validation, central audit, and append-only lifecycle recording.
- `calendar_event_events` rejects update and delete attempts.
- Private events are not returned to non-owner/non-attendees, even when they share an organization or a manager can see other scoped source records.
- Management permission alone does not permit cancellation outside the grant scope or cancellation of another owner’s private event.
- Derived calendar entries remain projections of source records; cancelling or modifying a custom event cannot alter Project, Finance, Legal, HR, Asset, or Procurement source records.
- Search never returns unauthorized record existence and never searches or returns salary, private HR identity fields, Vendor tax/bank data, payment instructions, narrative notes, ticket descriptions, document bodies, restricted legal contents, or audit payloads.
- Search API and page responses remain no-store and queries/results stay bounded.

### Browser test

Ask the browser agent:

> Open the calendar for this month, filter to Project and Procurement deadlines, then search globally for the related project, purchase request, and purchase order.

Expected result:

- The agent uses `/calendar`, the visible filters, the command palette or `/search`, and ordinary application routes rather than bypassing authorization.
- Calendar entries and search results are limited to records visible to the current membership.
- Related-record links resolve to existing module workspaces.
- No private event details, salary data, tax/bank metadata, note bodies, document contents, or audit details appear.

### Chat test

Ask:

> What deadlines, renewals, leave, warranty returns, and procurement deliveries are coming up, and which related records can I safely open?

The answer must rely only on calendar/search metadata visible to the current membership, distinguish source-projected entries from agency-created events, and avoid private event details or restricted source data.

### Deliberately pending

- Cross-module reports and management dashboards remain pending in ordered Stage 11.
- Event rescheduling/editing and attendee RSVP workflows are not part of this foundation; cancellation preserves history instead of rewriting completed evidence.
- External calendar synchronization is not included.

## Feature 32 — Reports and management dashboards foundation

### Credentials and services

- Apply PostgreSQL migrations through `20260718004800_reports_management_dashboards.sql`.
- Prepare one Owner, one Department or Team manager, one ordinary Employee, one restricted Employee outside the manager's scope, and one Auditor in the same organization.
- Prepare representative CRM Leads, active and overdue Projects and Tasks, Project estimates, approved Project expenses, time entries, issued and overdue Invoices, HR attendance/leave/onboarding/offboarding records, Support tickets and satisfaction, Legal contracts/licences/restricted-file access events, Asset assignments, Vendor bills, approvals, Calendar meetings, notifications, and audit events.
- Use the organization's default currency for Finance comparisons; mixed-currency records must not be silently combined into default-currency totals.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- tests/unit/reports.test.ts tests/unit/reports-dashboard-contract.test.ts
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/reports.test.ts` validates bounded report periods, previous-period comparison dates, conversion/utilization rates, filter parsing, stable query strings, and spreadsheet-formula-safe CSV output.
- `tests/unit/reports-dashboard-contract.test.ts` validates canonical-ledger reuse, source-module visibility helpers, role-aware dashboards, static-demo removal, sensitive-field exclusions, permission-gated exports, no-store headers, and export audit evidence.
- `database/tests/reports_management_dashboards.test.sql` validates canonical source tables, the sensitive export permission, intended role-template grants, and absence of broad Employee/Auditor export grants.

### Role-aware dashboard workflow

1. Sign in as the Owner and open `/dashboard`. Confirm monthly and year-to-date revenue, outstanding and overdue Invoices, active/at-risk Projects, overdue Tasks, employee utilization, pending leave, open Support, approvals, expiring contracts, overdue Asset returns, Vendor bills, alerts, and recent authorized activity use live records.
2. Confirm each metric and list item links to its existing source workspace rather than a duplicate dashboard record.
3. Sign in as the ordinary Employee. Confirm the dashboard changes to personal Tasks, Projects, meetings, leave balance/requests, assigned Assets, visible Documents, notifications, and submitted time only.
4. Sign in as the manager. Confirm managed-member workload, overdue work, approval queue, Team leave, visible Project status, accepted-estimate budget consumption, members missing current-week time, and metadata-only Team activity appear only for managed/visible records.
5. Sign in as the restricted Employee and Auditor. Confirm neither receives Owner or Manager dashboard data through route access, hidden markup, or direct server calls.

### Reports workflow

1. Open `/reports` as the Owner and confirm Overview, CRM, Projects, Finance, HR, Support, and Legal sections appear only when the active membership has the relevant source-module permission.
2. Apply date, previous-period comparison, owner, Team, Department, Project, client, and status filters. Confirm totals, tables, and export URLs preserve the same normalized filter set.
3. Verify CRM source/status/pipeline/owner/stage-time/lost-reason/conversion reporting against visible Leads.
4. Verify Project progress, overdue work, task completion, workload, estimated-versus-actual time, accepted-estimate budget consumption, profitability, and utilization against visible Projects and approved Finance records.
5. Verify Finance revenue, receivables, overdue balances, client balances, expenses, tax, collection, and profitability use issued/approved canonical records and the organization default currency.
6. Verify HR headcount, Department distribution, attendance, leave, turnover, probation, expiring employee documents, and Asset assignments remain limited to the manager's allowed employee scope.
7. Verify Support totals, resolution time, SLA breaches, categories, clients, agent workload, and satisfaction include only tickets visible through the existing ticket-access helper.
8. Verify Legal active/expiring contracts, pending signatures, renewals, restricted-file preview/download counts, and licence expirations include only records authorized by the existing Legal helpers.

### Export, negative, and security tests

- A user with report-view access but without `reports.export.create` can view authorized reports but receives no export action and cannot call `/api/reports/export` successfully.
- Exported CSV cells beginning with `=`, `+`, `-`, or `@` are prefixed safely; filenames are bounded; responses include `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
- Every successful export appends one `reports.exported` audit event with the section, normalized filters, and exported row count, without embedding report contents in the audit payload.
- Cross-organization owner, Team, Department, Project, client, and status filter identifiers do not broaden access or reveal whether unauthorized records exist.
- Dashboard and report output never contains salary values, personal HR email/phone/birth/government fields, Vendor tax/banking information, payment instructions, note bodies, Support descriptions, Document contents, Legal narratives, Team comment bodies, or raw audit before/after payloads.
- Finance totals do not combine non-default currencies into default-currency totals, and Project budget status uses the latest accepted Project estimate against approved allocated expenses rather than inventing a separate budget ledger.
- Direct authenticated SQL cannot grant report exports or bypass source-record RLS; the server must reauthorize the session and source permission before aggregation or export.

### Responsive browser test

Ask the browser agent:

> Open my dashboard, identify the work and financial items that need attention, then open Reports, compare this period with the previous period, filter to one visible Project, and export the authorized Project report.

Expected result:

- The browser uses ordinary `/dashboard`, `/reports`, and `/api/reports/export` routes.
- Role mode, report sections, filter options, totals, rows, links, and CSV contents are limited to records visible to the signed-in membership.
- The dashboard and report remain usable on narrow and wide viewports without clipped labels, inaccessible controls, horizontal page overflow, or hidden table context.
- No sensitive narrative or credential fields appear in the page, network response, CSV, or audit metadata.

### Chat test

Ask:

> Summarize the revenue, overdue invoices, project risks, Team workload, pending approvals, leave, Support, contract renewals, Asset returns, and Vendor bills I am allowed to see. Which report should I open next?

The answer must use only permission-filtered dashboard/report metadata available to the active membership, distinguish current-period values from comparisons, and avoid salaries, personal identity data, tax/bank data, notes, file contents, and audit payloads.

### Current report-delivery status

- Saved report views, schedules, snapshots, PDF generation, and the report builder are implemented. Scheduled delivery still requires production worker secrets and a configured delivery channel.
- PDF tests pass in the current Linux runtime, but the exact deployment image must pass `npm run test:pdf-runtime`.
- Dashboards and reports remain read-only projections; source records must be changed in their owning modules.

## Feature 33 — Permission-aware AI workspace

### Setup

Configure at least one server-side provider in the disposable environment: `GEMINI_API_KEY` or `DEEPSEEK_API_KEY`. Restrict allowed model names with `GEMINI_MODELS` and `DEEPSEEK_MODELS`. Never expose either key through `NEXT_PUBLIC_*`, browser storage, logs, screenshots, or test artifacts. Redis is required for production MCP sessions, cache generations, and fail-closed rate limiting.

### Automated checks

```bash
npm test -- tests/unit/ai-mcp-production-contract.test.ts tests/unit/mcp-tool-registry.test.ts
npm run test:e2e
```

### Browser and tool workflow

1. Sign in as an Owner or another account with `ai.workspace.view`; open `/ai`.
2. Confirm only configured providers are selectable and allowed models come from server configuration.
3. Ask for a dashboard summary. Confirm the response uses `agencyos.dashboard.get_workspace` and cannot reveal records outside the account's effective permissions.
4. Ask to search for a known authorized client or project. Confirm `agencyos.search.records` returns only visible metadata.
5. Ask to create a personal Calendar event. Confirm the model requests or supplies bounded required fields, the event appears in `/calendar`, and audit/tool evidence records the operation.
6. Ask to cancel a managed event. Confirm the sensitive/destructive approval flow is respected when configured and cancellation is not claimed before the tool succeeds.
7. Ask for a filtered report summary, inspect Automation, create an Automation definition, enable/disable it, and retry an eligible dispatch. Confirm every action is permission-gated and external internal worker delivery is not claimed unless configured.
8. Repeat with a restricted account. Confirm unavailable tools are absent from the provider tool declaration and direct API requests receive an authorization denial.
9. Confirm no provider key, full hidden system prompt, cookie, MCP session ID, or unbounded raw tool result appears in the browser, console, network error text, screenshots, or audit metadata.
10. Exercise provider failure, timeout, rate-limit, malformed response, approval-required, and Redis-unavailable states. Confirm the UI provides a recoverable error and no mutation is invented.

### Pass criteria

- Gemini and DeepSeek each complete one read-only tool call in an isolated environment.
- At least one Calendar write and one Automation write complete under an authorized role.
- Restricted-role and cross-organization negative cases pass.
- Tool loops stop at the configured bound, request/history sizes are bounded, and every MCP call is re-authorized.
- Production provider credentials remain server-only.

## Feature 34 — Final security hardening and operational readiness

### Required setup

- Apply `20260718005000_final_security_operational_readiness.sql` after every earlier migration.
- Configure AgencyOS first-party email/password authentication and TOTP MFA.
- Configure Redis, PostgreSQL, MinIO, `INTERNAL_WORKER_SECRET`, the AgencyOS worker process, and a production HTTPS application URL.
- Create an Owner, privileged administrator, standard Employee, view-only Auditor, suspended member, and a second organization for isolation checks.
- Read `docs/OPERATIONS.md` and `docs/SECURITY.md` before a production exercise.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- tests/unit/security.test.ts tests/unit/security-hardening-contract.test.ts
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Expected focused coverage:

- `tests/unit/security.test.ts` validates bounded policy, reauthentication, revocation, incident, UTC drill, RPO/RTO, and evidence-hash inputs.
- `tests/unit/security-hardening-contract.test.ts` validates privileged MFA, HTTP-only cookie handling, session enforcement, reauthentication boundaries, rate limits, headers, RLS/evidence contracts, and synchronized operational runbooks.
- `database/tests/final_security_operational_readiness.test.sql` validates security tables, sensitive permissions, RLS, append-only triggers, membership-driven revocation, and safe authenticated grants.

### MFA and session workflow

1. Sign in as a privileged member with password assurance only. Confirm workspace access redirects to `/mfa` before module authorization.
2. Enroll TOTP through the server-generated QR flow, verify the current code, and confirm the workspace opens at AAL2.
3. Sign in as a standard member without MFA. Open `/settings/security` and confirm the recommendation links to enrollment without blocking ordinary access.
4. Confirm session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` under HTTPS, and absent from `localStorage` and `sessionStorage`.
5. Confirm absolute and idle expiration redirect to login with a session-ended notice.
6. Revoke the current session and another authorized session. Confirm revoked sessions fail immediately and immutable security evidence is appended.
7. Suspend and deactivate a test membership. Confirm every active session for that membership is revoked by the database trigger.

### Critical-action and recovery workflow

1. Attempt a security-policy, access-management, role, permission, organization-session, another-member MFA-reset, or restore-evidence mutation without recent confirmation. Confirm it fails with a reauthentication requirement.
2. Confirm the current password in `/settings/security`, repeat the action within policy time, and verify success plus audit/security evidence.
3. Reset another member's MFA after out-of-band identity verification. Confirm verified factors are removed and all sessions are revoked.
4. Create a high-severity incident, move it through investigating, contained, resolved, and closed states, and verify immutable incident events.
5. Run an isolated database/MinIO/configuration/worker or full recovery exercise. Record runbook version, UTC start/completion, measured RPO/RTO, evidence summary, and optional SHA-256.
6. Confirm restore-drill evidence cannot be updated or deleted directly.

### Rate-limit, CSRF, and header checks

- Exceed the organization login and password-reset ceilings and confirm generic bounded responses without account-existence leakage.
- Exceed search/API, report export, MCP, and internal-worker ceilings and confirm `429` plus bounded retry guidance.
- Send an unsafe authenticated API request without `Origin` and with a foreign `Origin`; both must return `403` before mutation.
- Confirm worker and webhook endpoints continue to require their independent bearer/signing secrets and replay/idempotency controls.
- Verify CSP, HSTS in production, clickjacking, MIME, referrer, browser-permissions, opener/resource-policy, no-store export/MCP, and safe download headers.
- Confirm CSP contains no wildcard script, frame, object, or connection source.

### Cross-module permission and negative tests

Execute every row in the security acceptance matrix in `docs/SECURITY.md` for Owner, privileged administrator, Manager, Employee, Auditor, suspended member, and foreign-organization membership.

- Hidden controls, client-supplied role names, foreign identifiers, filter values, or MCP arguments never broaden access.
- Security Events, Audit, HR salary/government fields, Legal restricted records, Vendor tax/bank data, private files, report exports, and AI evidence preserve their existing field and record scope.
- No browser response, notification, audit/security metadata, MCP argument, export, incident summary, or restore evidence contains a password, access token, API key, private key, TOTP secret, recovery code, database URL, bank credential, or file content.
- Direct authenticated SQL cannot update session state, insert security evidence, rewrite incident history, or modify restore evidence.

### Backup and disaster-recovery acceptance

1. Produce encrypted PostgreSQL, MinIO, environment/configuration, and credential-free worker configuration backup sets using the backup and recovery section in `docs/OPERATIONS.md`.
2. Verify hashes, retention, immutable weekly/off-server copy, named backup operators, MFA, and centralized create/read/restore/delete/key-access logs.
3. Restore into an isolated environment with outbound integrations disabled and fresh recovery secrets.
4. Run database validation, static checks, all unit tests, production build, private-file integrity checks, RLS/permission matrix, Finance/HR/Legal smoke tests, workers, webhooks, exports, MCP, DNS/TLS, and session/MFA tests.
5. Record the measured result in AgencyOS. Do not mark the external restore requirement complete until actual infrastructure evidence exists.

### Responsive browser test

Ask the browser agent:

> Open Security controls, explain my current MFA and session posture, confirm my identity, review active sessions, and show the incident and restore-drill evidence I am authorized to see.

Expected result:

- The browser uses `/mfa` and `/settings/security` only through the signed-in session.
- Privileged AAL1 access is blocked, standard-member MFA is recommended, and sensitive actions require recent password confirmation.
- Tables and forms remain usable at narrow and wide widths without exposing another organization's members, sessions, incidents, events, or recovery evidence.
- Authenticator setup keys appear only during enrollment and are never logged, audited, stored in AgencyOS tables, or returned after verification.

### Deliberately pending external proof

- The application and runbooks are ready for a production-like full restore drill, but database, MinIO, secret-manager, worker process, DNS/TLS, and hosting recovery cannot be truthfully certified from the local source tree. Keep the final restore-proof item open until operators execute and record the exercise.

## Closure workflows: Support routing, Asset approvals and returns, Vendor-bill approval, restore evidence

### Required setup

- Apply `20260718005100_closure_workflows.sql` after all earlier migrations.
- Ensure active Support categories include `Incident`, `Billing`, `Change request`, and `General enquiry` where seeded routing behavior is expected.
- Ensure the shared Approval engine has eligible Operations, manager, Finance Manager, or Owner approvers for the tested organization.
- Use a non-production isolated environment for restore-drill evidence. Never place credentials, tokens, private keys, connection strings, or decrypted backup contents in the evidence JSON.

### Automated verification

```bash
npm run db:check
npm run format:check
npm run lint
npm run typecheck
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Focused workflow contracts:

```bash
npm test -- --pool=threads --maxWorkers=1 \
  tests/unit/closure-workflows.test.ts \
  tests/unit/closure-workflows-contract.test.ts
```

### Support automatic triage

1. Sign in as a Support Manager and open `/support`.
2. Create an active rule with a unique keyword, category, priority, and low position number.
3. Submit a ticket without manually selecting a category whose subject or description contains that keyword.
4. Verify the persisted category, priority, rule name, explanation, triage timestamp, and SLA deadlines reflect the rule-assigned priority.
5. Submit an unmatched ticket and verify the active General enquiry category and its default priority are used with `fallback` evidence.
6. Submit a manually categorized ticket and verify the automatic rules do not overwrite the selected category or priority.
7. As an ordinary requester or Support Agent without rule-management permission, verify rule creation is absent and the server action is denied.
8. Verify another organization's rules never affect the ticket.

### Asset request and approval flow

1. As an Employee, create a New Asset, Replacement, or Temporary request with category, title, justification, needed date, and optional expected return.
2. Verify the request receives an organization-scoped sequential key such as `AR-000001` and remains visible only within the effective permission scope.
3. Submit the request and verify a shared Approval request is created with an exact immutable snapshot and self-approval disabled.
4. When the requester has a manager, verify the manager stage precedes Operations authorization.
5. Approve the request, then as Operations select an available Asset from the same category and fulfill it.
6. Verify the Asset becomes assigned to the requester, the request becomes Fulfilled, the assignment is linked, and the requester receives a notification.
7. Negative cases: attempt cross-tenant access, fulfill before approval, fulfill with a mismatched category, reuse an assigned Asset, or cancel another Employee's request. All must fail without leaking record existence.

### Asset return flow

1. Assign an Asset to an Employee.
2. Create an HR offboarding plan and verify a return request is created for every active assignment with the last working date as the due date.
3. Change the Employee's department or manager and verify a duplicate active return request is not created for the same assignment.
4. As the Employee, acknowledge the return request. Verify acknowledgement does not grant cancellation, completion, or Asset administration authority.
5. As Operations, record the Asset return and verify the assignment and active return request become completed together.
6. Cancel an offboarding plan and verify linked pending return requests are cancelled while completed evidence remains unchanged.
7. Verify another organization cannot read or mutate the request.

### Vendor-bill approval and payment

1. Record a Vendor bill whose currency and total exactly match its Purchase order.
2. Verify the bill is Matched, not Approved.
3. Submit it through the shared Approval engine and verify status becomes Pending approval with a bound approval request.
4. Approve as an eligible Finance Manager or fallback Owner. Verify the bill becomes Approved and `approved_at` is recorded by the approval result trigger.
5. Record partial payment and final payment only after approval. A final payment requires a payment reference.
6. Negative cases: submit a match-exception bill, attempt direct Approved status, pay before approval, self-approve where prohibited, change the bill snapshot, or use another organization's bill. All must fail.

### configured database checks

```bash
npm run db:status
npm run db:migrate
npm run db:test
```

The migration push should include `20260718005100_closure_workflows.sql`. If the database command terminates unexpectedly, treat the result as inconclusive and rerun from the deployment environment; do not infer remote success from local validation.

## Deployment and recovery verification

### Focused automated contracts

```bash
npm test -- --pool=threads --maxWorkers=1 \
  tests/unit/operational-readiness.test.ts \
  tests/unit/operational-readiness-contract.test.ts
```

Expected result:

- AgencyOS migration status output is parsed without depending on table decoration.
- Missing remote and remote-only migrations are detected.
- Deployment summaries remain private, hash-only, and free of response bodies or credentials.
- Authentication redirects and MCP responses retain private, no-store handling.

### Linked deployment verification

```bash
npm run security:deployment:verify -- \
  --app-url "$AGENCYOS_DEPLOYMENT_APP_URL" \
  --output ./deployment-verification-summary.json
```

Verify:

1. Local migration validation passes.
2. Every local migration exists remotely and no remote-only migration exists.
3. `npm run db:status` reports no pending migration.
4. Linked or direct-database pgTAP passes.
5. `/login` includes the required production security headers.
6. Unauthenticated Search, report export, and MCP requests do not return authenticated success.
7. The generated summary contains no database URL, token, response body, or raw pgTAP output.

### Backup recovery check

Use the backup and recovery section in `docs/OPERATIONS.md`:

1. Restore PostgreSQL and MinIO into an isolated non-production environment.
2. Load fresh recovery configuration without reconnecting production integrations.
3. Keep imported automation definitions disabled until validation is complete.
4. Run `npm run verify`, `npm run db:test`, storage checks, and deployment verification.
5. Verify tenant isolation, RLS, private-file checksums, critical permissions, and application health before enabling outbound integrations.

No repository recovery template or generated evidence file is required.

## Advanced Reports verification

### Required configuration

- Apply migration `20260718005200_advanced_reports.sql`.
- Configure MinIO private storage and shared HTML-to-PDF rendering.
- Generate one `INTERNAL_WORKER_SECRET` for the AgencyOS worker endpoint. Keep unrelated provider and webhook credentials separate.
- Run `npm run worker`; it schedules the seven fixed jobs with staggered intervals.
- Enable email or browser-push delivery only when the member has chosen that shared notification channel. Scheduled reports always remain available in-app.

### Automated checks

```bash
npm run db:check
npm run check
npm test -- --pool=threads --maxWorkers=1
npm run build
npm run doctor
npm run doctor -- security
```

Run the focused files during development:

```bash
npm test -- --run \
  tests/unit/advanced-reports.test.ts \
  tests/unit/advanced-reports-contract.test.ts \
  tests/unit/reports.test.ts \
  tests/unit/reports-dashboard-contract.test.ts
```

Run configured database coverage after deployment:

```bash
npm run db:status
npm run db:migrate
npm run db:test
```

Confirm pgTAP includes `advanced_reports.test.sql`.

### Saved-view and builder workflow

1. Sign in as a manager with Reports access and open `/reports`.
2. Select a report section and apply date, owner, Team, Department, Project, client, status, and comparison filters.
3. Open **Saved views and delivery**.
4. Select only a subset of the section's approved report blocks and save the view.
5. Confirm the saved-view link reopens the exact normalized filters and only the selected blocks.
6. Update the view and confirm its audit event records names, section, and block keys without copying report contents.
7. Attempt to save the same active name twice and confirm the second request fails with a bounded duplicate message.
8. Archive the view and confirm it disappears from active navigation, its schedule pauses, and historical snapshots remain available.

### Snapshot workflow

1. Select a saved view and generate CSV and PDF snapshots.
2. Confirm both snapshots appear in history and download through `/api/reports/snapshots/[snapshotId]`.
3. Confirm the files contain only the selected blocks and current authorized source data.
4. Verify private-file classification, MinIO object location, SHA-256, size, generated scanner evidence, `file.generated`, `file.downloaded`, `reports.snapshot.generated`, and `reports.snapshot.downloaded` events.
5. Corrupt a test object or metadata size in an isolated environment and confirm the download fails closed.
6. Confirm snapshot responses use private no-store, MIME-sniffing protection, sandbox CSP, and attachment disposition.

### Scheduled-delivery workflow

1. Create daily, weekly, and monthly schedules and confirm invalid weekday/month-day combinations fail validation.
2. Confirm the computed next run follows the saved timezone and local time.
3. Call the worker with the wrong secret and confirm denial.
4. Call it with `INTERNAL_WORKER_SECRET` and `{"job":"reports"}`; confirm a bounded due batch is claimed.
5. Confirm the worker rechecks that the owner is active and still has Reports workspace, schedule, snapshot, and source-module permission.
6. Confirm one schedule occurrence produces at most one snapshot and one immutable run record even after a stale-lock retry.
7. Confirm successful delivery advances the cadence and sends a shared notification with a private snapshot link.
8. Revoke the source permission, deactivate the owner, or archive the saved view and confirm the schedule pauses without generating data.
9. Force transient renderer or storage failures and confirm bounded retry delays, failure evidence, and automatic pause after five failures.
10. Resume a paused schedule only by saving a valid configuration again.

### Role and security matrix

- Auditor: may retain personal saved views if Reports workspace access exists, but cannot schedule, generate, or download snapshots by default.
- Employee: receives no advanced report delivery permission by default.
- Eligible management roles: create only personal saved views and personal schedules; no organization-wide recipient selection exists.
- Cross-organization saved-view, schedule, snapshot, and run IDs return not found or permission denied.
- A manager cannot download another manager's snapshot even when both can view the same source module.
- Tampered widget keys from another section are discarded; an empty valid selection falls back to the section defaults.
- Arbitrary SQL, field names, expressions, HTML, file contents, secrets, recipient email addresses, organization IDs, and membership IDs are never accepted from the report builder or worker request.
- Scheduled generation uses the owner's current permissions, not the permissions present when the view was created.

### Manual accessibility and responsive checks

- Operate the saved-view `<details>` control, links, checkboxes, forms, date/time inputs, and action buttons by keyboard only.
- Confirm focus indicators remain visible at 200% zoom.
- Confirm the saved-view strip scrolls horizontally without clipping and schedule fields collapse to one column on narrow screens.
- Confirm errors and success messages use live-region semantics and color is not the only state indicator.
- Confirm users without a capability do not see disabled ghost controls for that capability.

## X2 — Release verification and request-safety regression checks

### X2-RH-01 — Focused automated checks

```bash
npm ci
npm test -- \
  tests/unit/bounded-request.test.ts \
  tests/unit/date-time-local.test.ts \
  tests/unit/approvals-ui-contract.test.ts \
  tests/unit/internal-worker-proxy-contract.test.ts \
  tests/unit/internal-worker-coordination.test.ts \
  tests/unit/content-security-policy.test.ts
npm run verify
```

Pass when missing or understated `Content-Length` cannot bypass byte limits, multibyte UTF-8 payloads are counted correctly, exact independently authenticated worker routes are recognized, each approval completion ID is handled once, local datetime values preserve positive/negative offsets and daylight-saving transitions, production script CSP contains a nonce and no script `unsafe-inline`, and the complete verification pipeline succeeds.

### X2-RH-02 — Request-boundary manual checks

1. Send valid CRM webhook and MCP JSON requests without `Content-Length`; confirm normal processing.
2. Send an understated `Content-Length` with a streamed body above the route limit; confirm `413` and no domain write.
3. Send malformed or negative `Content-Length`; confirm a bounded `4xx` response.
4. Send the internal automation execution without `Content-Length`; confirm `411`, because its exact-body signing protocol deliberately requires the declaration in addition to streamed enforcement.
5. Repeat with a valid declaration but an actual body above 64 KiB; confirm `413`.

### X2-RH-03 — Approval and local-time browser checks

1. Create two approval policies consecutively without reloading between submissions.
2. Submit two approval requests consecutively, then create two delegations consecutively.
3. Confirm every success closes the dialog, refreshes the list once, and resets policy-step draft state.
4. In a non-UTC browser timezone, open existing Support and Asset records with due/return timestamps and confirm `datetime-local` values show the expected local wall-clock time.
5. Repeat around a daylight-saving transition where applicable.

### X2-RH-04 — Header and build checks

1. Run the production build and start the application.
2. Request a rendered page twice and confirm each response has a different CSP nonce.
3. Confirm `script-src` includes the matching nonce and `strict-dynamic`, and does not include script `unsafe-inline`.
4. Introduce a temporary TypeScript error and confirm both `npm run build` and `npm run verify` fail; revert it afterward.
5. Confirm pull-request CI uses `.node-version`, `npm ci`, and `npm run verify` only.

## X3 — Exhaustive button and feature-route audit

This is the release gate for the request to test every button and every browser feature. It combines a source-level control inventory with a live browser crawl because neither layer is sufficient alone:

- Source inventory proves interactive controls in `src/**/*.tsx` are discoverable and applies static accessibility/action checks. It covers buttons, links, tabs, disclosures, textboxes, checkboxes, and selects.
- Playwright projects cover public routes and every authorized route supplied for disposable authenticated accounts at desktop, tablet, and mobile widths.
- The live audit opens disclosures and tabs, records an ARIA snapshot, runs Axe, exercises keyboard focus and controls, checks 200% zoom and horizontal overflow, and fails on page errors, failed requests, or unexpected server errors.
- Existing feature sections in this file remain the authority for successful business workflows, permission matrices, negative cases, uploads, approvals, exports, external adapters, and destructive lifecycle operations. A generic click crawler does not replace domain assertions.

### X3-01 — Source inventory for interactive controls

Run:

```bash
npm run test:ui:source
```

Optional machine-readable inventory:

```bash
node scripts/testing/ui-control-inventory.mjs \
  --check \
  --output test-results/ui-controls.json
```

The audit covers native/shared buttons, links, tabs, `<summary>` disclosures, textboxes, checkboxes, and selects. It fails on static accessibility/action violations and produces stable file/line metadata for coverage mapping and regression review. The JSON does not prove a click or form submission succeeded; Playwright and feature assertions provide that evidence.

Pass criteria:

1. Every TSX control is inventoried.
2. Zero accessible-name violations.
3. Zero inert enabled controls.
4. Zero implicit raw-button types.
5. The inventory count cannot fall below the regression threshold without an intentional test update.

### X3-02 — Route-matrix completeness

`tests/browser/route-matrix.json` lists every public and authenticated page. `tests/unit/browser-feature-matrix.test.ts` scans `src/app/**/page.tsx` and fails when a concrete route is missing from the browser matrix or when its linked `TEST.md` section does not exist.

Run:

```bash
npm test -- tests/unit/browser-feature-matrix.test.ts
```

Pass when every concrete page and `/ai` appears exactly once in the matrix and every entry points to a documented feature section.

### X3-03 — Live Playwright control and route audit

Use a disposable, isolated environment restored from known fixtures. The crawler deliberately refuses to run until the operator confirms isolation. Never run the destructive mode against production, shared staging, or irreplaceable data.

Minimum owner-only run:

```bash
AGENCYOS_E2E_BASE_URL=http://127.0.0.1:3000 \
AGENCYOS_E2E_OWNER_EMAIL=owner@example.test \
AGENCYOS_E2E_OWNER_PASSWORD='<password>' \
AGENCYOS_E2E_OWNER_MFA_SECRET='<base32-secret>' \
AGENCYOS_E2E_CONFIRM_ISOLATED=1 \
npm run test:e2e
```

Complete role and destructive-control run:

```bash
AGENCYOS_E2E_BASE_URL=https://isolated-e2e.example.test \
AGENCYOS_E2E_ACCOUNTS_JSON='[
  {"name":"owner","email":"owner@example.test","password":"<password>","mfaSecret":"<base32>","routes":["*"]},
  {"name":"auditor","email":"auditor@example.test","password":"<password>","mfaSecret":"<base32>","routes":["/dashboard","/reports","/settings/audit","/settings/security"]},
  {"name":"finance-manager","email":"finance@example.test","password":"<password>","mfaSecret":"<base32>","routes":["/dashboard","/finance","/approvals","/reports"]},
  {"name":"hr-manager","email":"hr@example.test","password":"<password>","mfaSecret":"<base32>","routes":["/dashboard","/hr","/approvals","/reports"]},
  {"name":"project-manager","email":"projects@example.test","password":"<password>","routes":["/dashboard","/projects","/calendar","/reports"]},
  {"name":"employee","email":"employee@example.test","password":"<password>","routes":["/dashboard","/projects","/calendar","/notifications","/settings/security"]},
  {"name":"restricted","email":"restricted@example.test","password":"<password>","routes":["/dashboard","/settings/security"]}
]' \
AGENCYOS_E2E_CONFIRM_ISOLATED=1 \
AGENCYOS_E2E_CLICK_DESTRUCTIVE=1 \
npm run test:e2e
```

Playwright writes JSON and HTML results plus failure traces and screenshots under `test-results/playwright`. Failure video is recorded only when `PLAYWRIGHT_VIDEO=1` after the Playwright ffmpeg package has been installed with `npx playwright install ffmpeg`. Retain only secret-free artifacts associated with the disposable run key.

Pass criteria:

1. Every route allowed to each supplied account loads without an unexpected sign-in loop.
2. Every discovered interactive control has an accessible name or associated label.
3. Every non-destructive visible control discovered after opening tabs and disclosures is represented in the exercised-control evidence.
4. Destructive success paths run only in the explicitly confirmed disposable fixture environment.
5. No interaction produces a JavaScript page error, failed request, unexpected HTTP `5xx`, serious Axe violation, keyboard trap, or horizontal page overflow.
6. Native validation, dialog opening, navigation, status/alert updates, successful form paths, downloads, and relevant network activity are asserted by route-specific specs.
7. ARIA snapshots, JSON/HTML results, traces, screenshots, and optional failure video are retained with the test run key, never passwords, MFA secrets, cookies, provider keys, response bodies, or private record contents.

### X3-04 — Every-feature completion protocol

For each route in `tests/browser/route-matrix.json`:

1. Run the live button crawl for every role that can see distinct controls on that route.
2. Execute the matching `Fxx` feature section in this document, including happy path, validation, authorization denial, cross-organization denial, duplicate/idempotency behavior, audit evidence, notification behavior, file boundaries, responsive layout, keyboard operation, and MCP/tool boundaries where relevant.
3. Use a unique run key on all created records.
4. Capture only secret-free report hashes, test IDs, timestamps, and pass/fail results.
5. Reset the disposable database, MinIO objects, Redis keys, automation test definitions, and browser sessions after destructive runs.
6. Do not mark the release complete if any route, role-specific control, destructive control, external integration, or required feature scenario was skipped.

### X3-05 — Remaining external evidence

The source, unit, build, route-matrix, and browser-control harnesses can be completed locally. Deployment verification and a real isolated backup recovery check still require the target PostgreSQL, MinIO, configuration, worker process, Redis, DNS/TLS, and hosting environment. Follow `docs/OPERATIONS.md`; no repository JSON template or generated restore-evidence file is required.
