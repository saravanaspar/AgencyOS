# AgencyOS

Production self-hosting uses the complete Coolify stack and immutable release workflow in
[`docs/COOLIFY.md`](docs/COOLIFY.md). Encrypted deduplicated B2 backups, Object Lock constraints,
and safe recovery are in [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md).

AgencyOS is a security-first Next.js operations platform for one agency or company. It combines CRM, projects, finance, HR, documents, legal, support, assets, vendors, calendar, approvals, notifications, search, automation, audit, founder reporting, and permission-aware AI.

AgencyOS owns its authentication and application data. Runtime infrastructure is ordinary PostgreSQL, S3-compatible object storage, and optional Redis/ClamAV integrations. Object storage may be hosted Backblaze B2 or bundled MinIO; PostgreSQL may be Neon, local/self-hosted PostgreSQL, or another compatible provider. No Supabase service, SDK, CLI, Auth, Realtime, or Storage dependency is required.

It is not a public SaaS product. Organization boundaries remain in the data model for isolation and authorization, while billing, subscriptions, public tenant provisioning, and marketplaces are out of scope.

## Documentation

- [`PLAN.md`](PLAN.md): product and implementation specification.
- [`TASK.md`](TASK.md): ordered delivery checklist and completion state.
- [`TEST.md`](TEST.md): automated and manual verification procedures.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system shape and accepted technical decisions.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): setup, workers, storage, database, deployment, backup, and recovery.
- [`docs/POSTGRESQL_CUTOVER.md`](docs/POSTGRESQL_CUTOVER.md): one-time migration from the former Supabase database to Neon/local PostgreSQL and later provider moves.
- [`docs/SECURITY.md`](docs/SECURITY.md): authentication, secrets, sessions, request protections, incident response, and release checks.
- [`docs/SECURITY_CONTROL_RECONCILIATION.md`](docs/SECURITY_CONTROL_RECONCILIATION.md): evidence-based security-control status.
- [`docs/FOUNDER_NEXT_PHASE.md`](docs/FOUNDER_NEXT_PHASE.md): intentionally deferred founder features.

## Implemented areas

- AgencyOS-owned email/password authentication, opaque HTTP-only sessions, email verification/reset, TOTP MFA, recent reauthentication, session review/revocation, roles, scoped permissions, explicit overrides, departments, teams, reporting lines, and append-only audit history.
- Permission-filtered navigation and a same-origin MCP endpoint with per-call reauthorization.
- CRM records, pipelines, forecasting, activity, imports, connectors, conversion history, billing-profile linkage, and contract-request linkage.
- Projects, tasks, My Tasks, templates, saved filters, reminders, bulk operations, commercial models, profitability, closure controls, private attachments, reports, and permission-safe MCP tools.
- Finance estimates, invoices, payments, credit notes, expenses, reports, immutable PDFs, document delivery, receipts, refunds, and overdue processing.
- HR employee records, attendance, leave, salary slips, private documents, onboarding, and offboarding.
- Documents, legal records, support, assets, vendors, procurement, calendar, approvals, reports, global search, and automation.
- Founder Attention Queue, Daily Brief, Weekly Review, scheduled report delivery, audience ACLs, undo grace period, recipient-specific authorization, and partial-failure reporting.
- Shared notifications with in-app delivery, optional email, payloadless Web Push, preferences, and provider-neutral foreground refresh.
- Shared private-file service using provider-neutral object-storage quarantine, malware scanning, SHA-256 validation, and reauthorized downloads.
- Gemini and DeepSeek workspace using the permission-aware MCP registry and approval-bound sensitive mutations.
- Redis-backed rate limiting, worker coordination with PostgreSQL advisory-lock fallback, replay protection, and short-lived permission-scoped caching.

## Requirements

- Node.js 22.23.2 or newer within the Node 22 LTS line.
- npm with lockfile support.
- PostgreSQL with `pgcrypto`; AgencyOS migrations also install pgTAP for database verification.
- An S3-compatible object-storage service, such as Backblaze B2 or self-hosted MinIO.
- ClamAV for releasing uploaded private files from quarantine.
- Redis and external integrations required by the modules you enable.

## Environment

```bash
cp .env.example .env.local
```

At minimum configure:

```env
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://...
DATABASE_ADMIN_URL=postgresql://...
INTERNAL_WORKER_SECRET=...
AUTH_ENCRYPTION_KEY=...
CRM_CONNECTOR_ENCRYPTION_KEY=...
REDIS_URL=rediss://default:...@redis.example.com:6380/0
OBJECT_STORAGE_ENDPOINT=https://s3.REGION.backblazeb2.com
OBJECT_STORAGE_REGION=...
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_BUCKET=...
```

`DATABASE_URL` is the normal runtime connection and may be pooled. `DATABASE_ADMIN_URL` must be a direct/non-pooled administrative connection for migrations, pgTAP, dump/restore, and provider moves.

Object storage needs one mutable private runtime bucket. AgencyOS supplies four non-overlapping
private prefixes in application code. The variable names are identical for local and hosted
storage; only the endpoint, region, credentials, and bucket value change.

Generate stable server secrets with a cryptographically secure tool:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Encryption keys must decode to exactly 32 bytes. Keep database credentials, object-storage keys, provider tokens, signing secrets, and encryption keys server-side.

After the first sign-in, configure optional AI providers, browser-push delivery, and Vaultwarden
under **Settings → Integrations**. Resend remains deployment-managed through `RESEND_API_KEY` and
`NOTIFICATION_EMAIL_FROM`. Configure CRM credentials on each CRM connection. Browser-test accounts
belong in `.env.e2e.local` (copy `.env.e2e.example`) rather than the application runtime environment.

## Install and run

```bash
npm ci
npm run dependencies:start
npm run db:migrate
npm run db:doctor
npm run db:test
npm run storage:check
npm run scanner:check
npm run redis:check
npm run dev
```

Run `npm run storage:setup` only when provisioning the bundled self-hosted object store. For a
hosted service, create the bucket at the provider and grant the runtime key read/write/delete access before running
`npm run storage:check`.

In a second terminal:

```bash
npm run worker
```

Open `http://localhost:3000`.

## Database

AgencyOS uses its own forward-only migration ledger and ordinary PostgreSQL connections:

```bash
npm run db:status
npm run db:migrate
npm run db:doctor
npm run db:test
```

Database reset and schema pulls are intentionally blocked. Add a forward-only migration instead of rewriting deployed history.

To move a complete AgencyOS database between PostgreSQL providers, use `npm run db:copy`; see [`docs/POSTGRESQL_CUTOVER.md`](docs/POSTGRESQL_CUTOVER.md).

## Verification

```bash
npm run verify
npm run db:doctor
npm run db:test
npm run test:e2e
npm run worker -- --once
```

`npm run verify` runs formatting, ESLint, TypeScript, source UI-control audit, unit tests, migration validation, and a production build. `npm run verify:release` additionally checks database status/doctor, pgTAP, PDF runtime tests, and the disposable authenticated browser environment.

For a deployed environment:

```bash
npm run security:deployment:verify -- \
  --app-url https://agency.example.com \
  --output deployment-verification-summary.json
```

## Main routes

`/dashboard`, `/crm`, `/projects`, `/finance`, `/hr`, `/documents`, `/legal`, `/support`, `/assets`, `/vendors`, `/calendar`, `/approvals`, `/notifications`, `/reports`, `/automation`, `/ai`, `/settings`.

## Source hygiene

Do not commit or package `.env*`, build/test output, local account bootstrap scripts, AI-assistant working directories, deployment evidence, private keys, or old provider metadata. The `supabase/` directory is obsolete and should not exist after `npm run cutover:remove-legacy-provider`.

Create a tracked-file source archive with:

```bash
npm run archive:source
```
