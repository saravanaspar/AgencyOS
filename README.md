# AgencyOS

AgencyOS is an open-source, security-focused operations platform for agencies and internal teams. It brings CRM, projects, finance, HR, documents, legal, support, assets, vendors, procurement, calendar, approvals, notifications, reporting, automation, audit, and permission-aware AI into one Next.js application.

AgencyOS is designed to be **self-hosted first** without locking you into one infrastructure vendor. The web application, worker, PostgreSQL database, Redis-compatible service, and S3-compatible object storage can all run on infrastructure you control. Managed services are also supported when they are a better operational fit.

> AgencyOS is not designed as a public multi-tenant SaaS. Organization boundaries remain in the data model for authorization and isolation, while subscriptions, public tenant provisioning, marketplace features, and billing plans are intentionally out of scope.

## Deployment options

You can mix self-hosted and managed components. The application contract is PostgreSQL + Redis-compatible coordination + S3-compatible object storage; the provider is your choice.

| Component | Self-hosted | Managed options | Notes |
| --- | --- | --- | --- |
| Web app | Coolify / OCI container | Vercel | Vercel is a good fit for the Next.js web process. |
| Background worker | Coolify / OCI container | Any persistent Node.js host | The existing worker is a long-running Node.js process. Cloudflare Workers are **not** a drop-in replacement. |
| PostgreSQL | PostgreSQL 17+ | Neon | Use a normal runtime URL and a direct/admin URL for migrations and recovery. |
| Redis | Redis | Upstash Redis | Production remote Redis should use authenticated TLS (`rediss://`). |
| Object storage | Any S3-compatible service | Backblaze B2, Cloudflare R2 | Runtime files use one private bucket with AgencyOS-owned prefixes. |
| Malware scanning | ClamAV | Compatible HTTPS scanner | Optional at deployment-policy level; recommended whenever untrusted files can be uploaded. |
| Password/secrets vault | Vaultwarden | External secret manager | Optional. Vaultwarden can be self-hosted alongside AgencyOS. |
| Reverse proxy | Nginx / Coolify proxy | Vercel edge | Nginx is only needed when your self-hosted topology requires it. |
| Backups | Restic + immutable S3 storage | Backblaze B2 Object Lock | Keep backup credentials and the backup bucket separate from runtime files. |

### Recommended self-hosted stack

A straightforward self-hosted installation is:

- **Coolify** for deployment and service supervision.
- **PostgreSQL** for application data.
- **Redis** for rate limiting, coordination, and caching.
- **S3-compatible object storage** for private files.
- **ClamAV** when file uploads are enabled.
- **Vaultwarden** only if you want the built-in vault integration.
- **Nginx/Coolify ingress** for TLS termination and reverse proxying.
- A separate immutable object-storage bucket for encrypted backups.

The repository includes Coolify/Compose manifests for bundled dependencies and a second topology for externally managed data services. See [`docs/COOLIFY.md`](docs/COOLIFY.md).

### Recommended managed-data stack

A practical managed setup is:

- **Vercel** for the Next.js web application, or Coolify if you want web and worker together.
- **Neon** for PostgreSQL.
- **Upstash Redis** using its native TLS Redis endpoint.
- **Backblaze B2** or **Cloudflare R2** for S3-compatible runtime file storage.
- A **separate persistent Node.js worker host** for `npm run worker` when the web app is on Vercel.
- Optional self-hosted **ClamAV** and **Vaultwarden** services if those features are enabled.

Backblaze B2 is often attractive when raw storage cost is the main concern, while Cloudflare R2 is attractive for workloads that benefit from Cloudflare's ecosystem and egress model. Pricing changes, so compare the current provider pricing for your storage volume, request rate, and traffic before choosing.

### Cloudflare Workers

AgencyOS uses a long-running Node.js worker for scheduled and background jobs. That process should run under Coolify or another persistent Node.js/container host. **Do not deploy the current worker entry point directly to Cloudflare Workers.** Supporting Cloudflare Workers properly would require adapting job execution to Cloudflare Queues, Workflows, Cron Triggers, or an equivalent architecture.

## Features

- First-party email/password authentication, opaque HTTP-only sessions, email verification and password reset, TOTP MFA, recent reauthentication, session review/revocation, roles, scoped permissions, explicit overrides, departments, teams, reporting lines, and append-only audit history.
- CRM records, pipelines, forecasting, activities, imports, connectors, lead conversion, billing relationships, and contract-request linkage.
- Projects, tasks, templates, My Tasks, saved filters, reminders, bulk operations, commercial models, profitability, private attachments, closure controls, and reports.
- Finance estimates, invoices, payments, credit notes, expenses, receipts, refunds, immutable PDFs, delivery history, and overdue processing.
- HR employee records, attendance, leave, salary slips, private documents, onboarding, and offboarding.
- Documents, legal records, support, assets, vendors, procurement, unified calendar, approvals, global search, and automation.
- Notifications with in-app delivery, optional email, and payloadless Web Push.
- Permission-aware Gemini and DeepSeek workspace using the central MCP registry and approval-bound sensitive actions.
- Redis-backed rate limiting, replay protection, worker coordination, and short-lived permission-scoped caching.
- S3-compatible private-file quarantine, integrity checks, optional malware scanning, and reauthorized downloads.

## Architecture

AgencyOS owns its authentication and application data. It does not require Supabase Auth, Storage, Realtime, SDKs, or CLI tooling.

The runtime consists of:

```text
Browser
   |
   v
Next.js web process  ---- PostgreSQL
   |       |                |
   |       +---- Redis -----+
   |
   +---- S3-compatible private object storage
   |
   +---- optional scanner / external integrations

Persistent Node.js worker
   |
   +---- internal authenticated worker endpoint
   +---- PostgreSQL / Redis / object storage
```

Runtime file storage is provider-neutral and uses AWS Signature V4 against an S3-compatible endpoint. Supported deployment targets include self-hosted S3 implementations, Backblaze B2, and Cloudflare R2. Browser clients never receive storage credentials or unrestricted object URLs.

## Requirements

- Node.js **22.23.2 or newer**, within Node 22 LTS.
- npm with lockfile support.
- PostgreSQL with `pgcrypto`; AgencyOS migrations also install pgTAP for database verification.
- S3-compatible object storage if file features are enabled.
- Redis-compatible storage when `REDIS_REQUIRED=1` (the production default).
- A malware scanner when `PRIVATE_FILE_SCANNER_REQUIRED=1` (the production default).

For local development, Podman/`podman-compose` can start the bundled dependencies. Docker Compose can be used for the production/Coolify manifests where documented.

## Quick start

```bash
cp .env.example .env.local
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

Run the worker in a second terminal:

```bash
npm run worker
```

Open `http://localhost:3000`.

`npm run storage:setup` is intended for the bundled self-hosted object store. For Backblaze B2, Cloudflare R2, or another managed provider, create the private runtime bucket in the provider console, create a restricted application key, set the common `OBJECT_STORAGE_*` variables, then run `npm run storage:check`.

## Environment

Start with:

```bash
cp .env.example .env.local
```

Minimum runtime configuration:

```env
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://...
DATABASE_ADMIN_URL=postgresql://...
INTERNAL_WORKER_SECRET=...
AUTH_ENCRYPTION_KEY=...
CRM_CONNECTOR_ENCRYPTION_KEY=...
REDIS_URL=redis://127.0.0.1:6379/0
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_BUCKET=agencyos-runtime
PRIVATE_FILE_SCANNER_URL=clamav://127.0.0.1:3310
```

Managed-service examples use the same variables:

```env
# Neon: pooled runtime URL plus direct/admin URL
DATABASE_URL=postgresql://...@.../agencyos?sslmode=require
DATABASE_ADMIN_URL=postgresql://...@.../agencyos?sslmode=require

# Upstash native Redis endpoint
REDIS_URL=rediss://default:...@...:6379

# Backblaze B2 S3
OBJECT_STORAGE_ENDPOINT=https://s3.REGION.backblazeb2.com
OBJECT_STORAGE_REGION=REGION

# Cloudflare R2 S3
# OBJECT_STORAGE_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
# OBJECT_STORAGE_REGION=auto
```

Generate stable server secrets with a cryptographically secure tool:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

`AUTH_ENCRYPTION_KEY` and `CRM_CONNECTOR_ENCRYPTION_KEY` must each decode to exactly 32 bytes. Keep database credentials, object-storage keys, integration tokens, signing secrets, and encryption keys server-side.

After the first sign-in, configure optional AI providers, browser-push delivery, and Vaultwarden under **Settings → Integrations**. CRM credentials are configured per connection.

## PostgreSQL

AgencyOS uses forward-only migrations and ordinary PostgreSQL connections:

```bash
npm run db:status
npm run db:migrate
npm run db:doctor
npm run db:test
```

`DATABASE_URL` is the normal application connection and may use a provider pooler. `DATABASE_ADMIN_URL` should be a direct/non-pooled administrative connection for migrations, pgTAP, dump/restore, and provider moves.

Database reset and schema pull commands are intentionally blocked. Add a forward migration instead of rewriting deployed history.

To move a complete AgencyOS database between PostgreSQL providers, use `npm run db:copy` and follow [`docs/POSTGRESQL_CUTOVER.md`](docs/POSTGRESQL_CUTOVER.md).

## Object storage

AgencyOS uses one mutable private runtime bucket with four non-overlapping prefixes:

- `private-file-quarantine`
- `private-files`
- `project-attachments`
- `document-templates`

The application speaks the S3 API directly through its provider-neutral storage boundary. This keeps the same application configuration across local storage, Backblaze B2, Cloudflare R2, and compatible self-hosted services.

For production, restrict runtime credentials to the runtime bucket and only the operations the application needs. Do not reuse backup writer or recovery credentials as runtime credentials.

## ClamAV and private-file scanning

ClamAV is **optional infrastructure**, but it is recommended whenever users can upload untrusted files. Production defaults to `PRIVATE_FILE_SCANNER_REQUIRED=1`, which makes readiness fail closed if the scanner is missing. An operator can explicitly choose a degraded deployment with `PRIVATE_FILE_SCANNER_REQUIRED=0` when file scanning is intentionally not required.

Self-host ClamAV with:

```bash
npm run scanner:start
npm run scanner:check
```

Do not expose the unauthenticated ClamAV TCP port publicly.

## Vaultwarden

Vaultwarden is optional. If you use AgencyOS vault links/integration, Vaultwarden can run in the same self-hosted environment with its own PostgreSQL database and persistent data volume. If you do not use the vault integration, you do not need to deploy Vaultwarden.

## Backups

Runtime files and backups may use the **same storage provider**, but they should not use the same mutable bucket or credentials.

Recommended layout:

```text
Provider account / storage platform
├── agencyos-runtime       mutable; app credentials only
└── agencyos-backup        immutable/Object-Lock enabled; backup credentials only
```

For stronger isolation, place the backup bucket in a separate provider account or a different provider entirely. AgencyOS's packaged backup workflow is currently designed around **Backblaze B2 Object Lock** and Restic. It validates default Compliance retention before publishing encrypted backup repository objects.

Back up PostgreSQL, runtime object storage, Vaultwarden data when used, and deployment configuration/secrets as separate recovery components. Test restores in an isolated environment on a schedule. See [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md).

## Vercel deployment

The Next.js web process can be deployed to Vercel using the normal application environment variables. When doing so:

- Use Neon or another reachable PostgreSQL provider.
- Use Upstash or another reachable Redis-compatible service.
- Use Backblaze B2, Cloudflare R2, or another reachable S3-compatible object store.
- Run `npm run worker` on a **separate persistent Node.js/container host**.
- Run ClamAV/Vaultwarden separately if enabled; they are not Vercel serverless functions.
- Keep `APP_URL` on the public Vercel/custom-domain origin and configure the worker to call the authenticated internal worker endpoint over an appropriate private or protected path.

For an all-in-one deployment with the web process and worker together, Coolify is the simpler supported topology.

## Coolify deployment

Two production-oriented manifests are included:

- `compose.coolify.yaml`: bundled PostgreSQL, Redis, object storage, scanner, Vaultwarden, app, worker, gateway, and operations services.
- `compose.coolify.cloud.yaml`: hosted PostgreSQL/Redis/object-storage data services while keeping AgencyOS processes and the remaining selected services under Coolify.

Use [`docs/COOLIFY.md`](docs/COOLIFY.md) for the release gate, persistent volume rules, backup requirements, and rollback process.

## Verification

Run the normal repository gate:

```bash
npm run verify
```

For integration/release verification with configured dependencies:

```bash
npm run db:doctor
npm run db:test
npm run storage:check
npm run redis:check
npm run scanner:check
npm run test:e2e
npm run worker -- --once
```

For a deployed environment:

```bash
npm run security:deployment:verify -- \
  --app-url https://agency.example.com \
  --output deployment-verification-summary.json
```

## Security

AgencyOS uses server-side authorization, row-level security, tenant validation, bounded request/response handling, encrypted credentials, append-only audit evidence, protected operator diagnostics, rate limiting, MFA for privileged roles, and strict production headers.

Public liveness/readiness endpoints intentionally expose only minimal status. Detailed dependency health and metrics remain behind the operator bearer boundary.

Before production deployment, read [`docs/SECURITY.md`](docs/SECURITY.md) and run the full release verification described in [`TEST.md`](TEST.md).

If you believe you found a security issue, do not publish credentials, private data, or an exploit against a live deployment in a public issue. Share only the minimum reproducible details with the project maintainer through the repository's configured private security-reporting channel.

## Documentation

- [`PLAN.md`](PLAN.md) — product and implementation specification.
- [`TASK.md`](TASK.md) — ordered delivery checklist and completion state.
- [`TEST.md`](TEST.md) — automated and manual verification procedures.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture and accepted technical decisions.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — operations, dependencies, workers, storage, health, and recovery.
- [`docs/COOLIFY.md`](docs/COOLIFY.md) — production Coolify deployment.
- [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md) — encrypted immutable backup and isolated recovery.
- [`docs/POSTGRESQL_CUTOVER.md`](docs/POSTGRESQL_CUTOVER.md) — PostgreSQL provider migration.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security architecture and operational controls.

## Contributing

Contributions are welcome. Keep changes focused, preserve the security and tenant-isolation boundaries, add or update tests for behavior changes, and run `npm run verify` before opening a pull request. Database changes must use new forward-only migrations; do not rewrite migration history that may already be deployed.

For security-sensitive findings, use the private reporting guidance above instead of publishing exploit details or secrets in a public issue.

## Source hygiene

Do not commit `.env*`, build/test output, local account bootstrap scripts, AI-assistant working directories, deployment evidence, private keys, database dumps, object-storage exports, or old provider metadata.

Create a source archive with:

```bash
npm run archive:source
```

## License

AgencyOS is available under the [MIT License](LICENSE).
