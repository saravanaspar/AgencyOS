# AgencyOS Operations

The authoritative production runbooks are [Coolify deployment](COOLIFY.md) and
[encrypted backup/recovery](BACKUP_RECOVERY.md). They define stable volumes, pre-migration backups,
daily health/status, Object Lock limitations, and isolated recovery.

## Runtime topology

AgencyOS runs as a web process plus a persistent Node.js worker against PostgreSQL and
S3-compatible private storage. Production may use bundled/self-hosted dependencies or managed
services. The supported contracts are provider-neutral: PostgreSQL, native Redis, S3-compatible
object storage, and an optional private-file scanner selected by runtime policy.

A common managed combination is Neon PostgreSQL, Upstash native TLS Redis, and either Backblaze B2
or Cloudflare R2. The Next.js web process may run on Vercel, but the current worker is long-running
Node.js and must run on a persistent Node/container host. Cloudflare Workers are not a drop-in target
for `scripts/workers/run.mjs` without redesigning jobs around Queues/Workflows/Cron. No Supabase
service or CLI is required.

## Local setup

```bash
cp .env.example .env.local
npm ci
```

Install rootless Podman and native `podman-compose`. Keep Podman's rootless socket and storage
owned by the deployment user; do not run AgencyOS containers as root merely to avoid configuring
subordinate UID/GID ranges.

The Podman manifests give each persistent volume an engine-stable name configured by
`AGENCYOS_POSTGRES_VOLUME`, `AGENCYOS_REDIS_VOLUME`, `AGENCYOS_OBJECT_STORAGE_VOLUME`, and
`AGENCYOS_CLAMAV_VOLUME`. Changing one of these values intentionally selects a different data
directory. Keep these values stable after the first successful startup.

Configure `APP_URL`, `DATABASE_URL`, `DATABASE_ADMIN_URL`, `REDIS_URL`, `INTERNAL_WORKER_SECRET`, `AUTH_ENCRYPTION_KEY`, `CRM_CONNECTOR_ENCRYPTION_KEY`, and the selected object-storage connection. Optional organization integrations are configured after sign-in under **Settings → Integrations**. `DATABASE_POOL_MAX` defaults to 10. Production startup validates required secrets, TLS requirements, the independent audit-pipeline alert webhook, and dependency policy before accepting traffic.

`AUTH_ENCRYPTION_KEY` and `CRM_CONNECTOR_ENCRYPTION_KEY` must each decode to exactly 32 bytes:

```bash
openssl rand -base64 32
```

Do not rotate either key casually: verified TOTP factors, CRM credentials, and application-managed provider settings depend on them.

## PostgreSQL

Use a normal application connection for `DATABASE_URL`. For hosted providers this may be the provider's pooled endpoint. Use a direct/non-pooled administrative connection for `DATABASE_ADMIN_URL`.

```bash
npm run db:status
npm run db:migrate
npm run db:doctor
npm run db:test
```

- `db:status`: compares local forward migrations with `agency_migrations.schema_migrations`.
- `db:migrate`: serializes and applies pending migrations with checksum drift detection.
- `db:doctor`: verifies identity tables, required extensions, migration state, and absence of replay-only auth/storage shims.
- `db:test`: executes database pgTAP tests through the direct connection.
- `db:copy`: copies an AgencyOS-owned database into a new empty PostgreSQL target.

Database reset and schema pull are intentionally blocked. Production changes are forward-only.

For a local Podman PostgreSQL 17 instance with the pgTAP extension required by `db:test`, set
`AGENCYOS_POSTGRES_PASSWORD` and matching `DATABASE_URL`/`DATABASE_ADMIN_URL` values in
`.env.local`, then run:

```bash
npm run db:start
npm run db:logs
```

For the one-time former-provider migration or later Neon/local/provider moves, follow [`POSTGRESQL_CUTOVER.md`](POSTGRESQL_CUTOVER.md).

## S3-compatible object storage

Runtime file bytes live only in one private bucket, separated into application-owned prefixes.

```bash
npm run storage:start
npm run storage:setup
npm run storage:check
```

`storage:setup` idempotently creates the configured bucket and is intended only for the bundled
self-hosted service. With hosted storage, create the bucket in the provider console and run only
`storage:check`. Backblaze B2 and Cloudflare R2 both use the same `OBJECT_STORAGE_*` contract;
Cloudflare R2 normally uses the account S3 endpoint with `OBJECT_STORAGE_REGION=auto`. The
application maps `private-file-quarantine`, `private-files`, `project-attachments`, and
`document-templates` to non-overlapping prefixes. Browser clients never receive object-storage
credentials or unrestricted object URLs.

The runtime uses AgencyOS's small AWS Signature V4 S3 client rather than a provider SDK. Keep the
runtime key bucket-scoped with only the read/write/delete/list permissions required by the app. Do
not reuse backup writer or recovery credentials.

## Private-file scanning

ClamAV is self-hostable and optional at the deployment-policy level. Production defaults
`PRIVATE_FILE_SCANNER_REQUIRED=1`; keep that default whenever untrusted uploads are enabled. If an
operator intentionally deploys without file scanning, set `PRIVATE_FILE_SCANNER_REQUIRED=0` and
treat that as a reduced-security configuration.

Start ClamAV:

```bash
npm run scanner:start
npm run scanner:logs
npm run scanner:check
```

Local configuration:

```env
PRIVATE_FILE_SCANNER_URL=clamav://127.0.0.1:3310
PRIVATE_FILE_SCANNER_BEARER_TOKEN=
```

The worker streams quarantined bytes through ClamAV `INSTREAM`; it does not mount the upload directory into the scanner. Keep the unauthenticated TCP port on loopback only.

## Authentication operations

AgencyOS owns login/session state in PostgreSQL.

- Passwords are bcrypt hashes in `identity_credentials`.
- Browser credentials are opaque `agencyos_session` cookies; only token hashes are stored.
- Email verification and password-reset tokens are single-use and hashed at rest.
- TOTP factor secrets are encrypted with `AUTH_ENCRYPTION_KEY`.
- Organization security policies control privileged MFA, session lifetime, idle timeout, recent reauthentication, and rate-limit thresholds.

For verification/reset email configure Resend:

```env
RESEND_API_KEY=...
NOTIFICATION_EMAIL_FROM=AgencyOS <notifications@mail.example.com>
```

In non-production only, `AUTH_DEV_SHOW_TOKENS=1` may expose a verification/reset token in the action response when email is not configured. Never enable it in production.

## Redis

Use `redis://127.0.0.1:6379/0` locally. Upstash's native Redis TLS endpoint is supported through the
same `REDIS_URL` variable. Production requires authenticated TLS `rediss://` whenever
`REDIS_REQUIRED=1` (the default). Authenticated rate limits fail closed in production if Redis is
unavailable. Worker coordination falls back to PostgreSQL advisory locks where designed.

```bash
npm run redis:start
npm run redis:check
```

## Worker

The web and worker share `INTERNAL_WORKER_SECRET`.

```bash
npm run worker -- --once
npm run worker
```

The worker calls `POST /api/internal/workers/run` using `Authorization: Bearer <INTERNAL_WORKER_SECRET>`. In containers, set `INTERNAL_APP_URL=http://app:3000` so worker traffic stays on the private network while `APP_URL` remains the public origin. `WORKER_MAX_CONCURRENCY` defaults to 3 and is capped at 8; due jobs run independently instead of blocking the entire scheduler. The internal endpoint accepts only the fixed registered job enum. Database claims/idempotency and coordination guards prevent duplicate side effects.

Every five minutes, the `audit-pipeline` job commits a null-tenant, system-authored canary directly to the append-only `audit_events` table. If that request fails, the worker process sends a generic critical event directly to a separate HTTPS webhook; it does not enqueue a PostgreSQL notification or email. Repeated failure events are limited to one every 30 minutes, and the first successful canary after an incident emits one recovery event.

Production requires both values below. They are an optional pair in local development. Keep this bearer secret distinct from `INTERNAL_WORKER_SECRET`, and route the webhook to infrastructure that does not depend on the AgencyOS application or PostgreSQL notification pipeline.

```env
AUDIT_PIPELINE_ALERT_WEBHOOK_URL=https://alerts.example.com/hooks/agencyos-audit
AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET=replace-with-at-least-32-random-characters
```

The alert sender uses a five-second timeout, refuses redirects, never reads provider response bodies, and logs neither the destination, bearer secret, nor payload. Alert delivery failures are deliberately logged only as generic delivery outcomes. Test the destination and escalation ownership during deployment without copying its credentials into evidence.

`npm run worker -- --once` exits nonzero when the audit canary request fails or does not confirm exactly one committed canary. Other recurring jobs retain their best-effort one-shot behavior, so deployment automation must treat this exit code as the audit-pipeline smoke gate.

## Health, metrics, and logs

- `GET /api/health/live` is the process liveness probe.
- `GET /api/health/ready` is the unauthenticated load-balancer readiness probe and verifies configuration plus every dependency marked required by the runtime policy.
- `GET /api/health/status` is a bearer-protected operator diagnostic endpoint with per-dependency status and latency.
- `GET /api/metrics` is a bearer-protected Prometheus text endpoint using `INTERNAL_WORKER_SECRET`.

Application, AI/MCP, and worker paths emit structured JSON logs and propagate `X-Request-ID`. Forward these logs and scrape `/api/metrics` from a trusted monitoring network; neither operator endpoint should be exposed without the bearer boundary.

## Notifications

In-app notifications require no external provider. Browser counters use bounded provider-neutral foreground refresh rather than hosted database Realtime.

For email delivery use Resend. For payloadless Web Push generate VAPID keys:

```bash
npm run notifications:vapid
```

Keep delivery encryption keys and private VAPID keys server-only.

## Founder cash, collections, and external report delivery

The finance worker includes the `finance-collections` job. Keep the worker running continuously so due stages, delivery retry evidence, owner follow-ups, and founder escalation stay current. Collection client email reuses the existing Resend configuration; if email is unavailable the case remains retryable rather than being marked delivered.

The 30/60/90 forecast is computed on demand from authorized canonical records plus explicit recurring assumptions. Forecast settings are not a bank-feed configuration and must not be interpreted as reconciled/available bank cash.

Slack, Telegram, and generic webhook report destinations are configured per recipient in Reports. Destination secrets are encrypted with a separate server-only key:

```env
REPORT_DELIVERY_ENCRYPTION_KEY=
```

Use a high-entropy production secret and rotate it through the deployment secret manager. Slack uses an incoming webhook and receives an authenticated AgencyOS snapshot link. Telegram and generic webhooks receive the recipient-specific PDF/CSV bytes. Generic webhook destinations are HTTPS-only and reject local/private/reserved destinations; do not bypass that validation with internal hostnames. Missing recipient destinations are suppressed independently, while transient delivery failures use the existing report retry/backoff path.

## AI providers

Configure provider keys and allowed model names after sign-in under **Settings → Integrations**.
Provider keys, endpoints, and model allowlists are application-managed and are not read from the
runtime environment.

Model tools remain permission-filtered and reauthorized per call. AI is additionally fail-closed at the organization boundary: external provider egress is disabled until an operator explicitly enables an organization policy. Configure it with `npm run ai:policy -- --organization <slug> --providers gemini --modules crm,projects --enable-egress`; add `--allow-mutations` only when ordinary non-read tool execution is intended. Sensitive/destructive tools still require their existing bound approval. Provider execution evidence stores metadata only, never prompts, tool payloads, credentials, or model output.

## Verification

```bash
npm run verify
npm run db:status
npm run db:doctor
npm run db:test
npm run worker -- --once
```

For release acceptance:

```bash
npm run security:framework
npm run security:supply-chain
npm run security:tenant-scope
npm run quality:complexity
npm run verify:release
```

The tenant-scope and complexity checks are regression guards: existing legacy exceptions are baselined, but new/changed unscoped tenant SQL and growth of grandfathered oversized files fail CI. Reduce those baselines over time; do not expand them without explicit review.

The browser environment must be disposable and explicitly confirmed before destructive E2E operations.

## Deployment verification

From a restricted operator host:

```bash
npm run security:deployment:verify -- \
  --app-url https://agency.example.com \
  --output deployment-verification-summary.json
```

The verifier checks source migration validity, database migration parity, provider doctor checks, pgTAP, health endpoints, and security headers. Generated evidence is private and belongs outside source control.

## Container deployment

`Containerfile` builds one OCI image for web and worker with Podman. `compose.production.yaml`
supplies restart supervision, readiness checks, worker execution, and bounded ingress. Follow
[`../deploy/README.md`](../deploy/README.md) for the deployment sequence.

For self-hosted production, Coolify can supervise both web and worker and provide the outer proxy.
The bundled Nginx layer is part of that self-hosted topology; it is not needed when Vercel owns web
ingress. If the Next.js web process runs on Vercel, run `npm run worker` on a separate persistent
Node.js/container host and connect both processes to the same PostgreSQL, Redis, and object-storage
services.

The production Compose defaults cap each app/worker container at 2 GiB memory, 2 CPUs, and 256 PIDs. Tune `AGENCYOS_MEMORY_LIMIT`, `AGENCYOS_CPU_LIMIT`, and `AGENCYOS_PIDS_LIMIT` from load-test evidence rather than removing limits.

## Backup and recovery

Back up PostgreSQL, object storage, and deployment configuration independently. Keep secrets in a
separate secret manager/backup path. Runtime files and backups may use the same storage provider,
but use a different immutable backup bucket, different credentials, and preferably a separate
provider account or failure domain. The packaged immutable backup workflow is currently B2-specific
because it verifies Backblaze Object Lock before publishing the encrypted Restic mirror.

Recommended PostgreSQL backup:

```bash
pg_dump --format=custom --no-owner --file agencyos.dump "$DATABASE_ADMIN_URL"
```

For hosted providers, combine provider snapshots with portable `pg_dump` evidence. Mirror every
runtime object-storage prefix to encrypted, access-controlled off-host storage and record checksums.

Restore into an isolated environment with outbound email/integrations disabled. Restore PostgreSQL
and object storage, restore configuration/secrets, then run:

```bash
npm run db:migrate
npm run db:doctor
npm run storage:check
npm run scanner:check
npm run verify
npm run db:test
npm run worker -- --once
```

After restoring the full backup set into that isolated environment, run the bounded restore verifier before reconnecting integrations:

```bash
AGENCYOS_RESTORE_DRILL=1 \
RESTORE_DRILL_BACKUP_SET_ID=backup-2026-08-24 \
RESTORE_DRILL_TARGET_ID=isolated-drill-01 \
npm run security:restore-drill:verify -- \
  --app-url https://restore-drill.example.invalid \
  --output restore-drill-verification-summary.json
```

The verifier reuses deployment migration/provider/pgTAP/HTTP security checks and adds object-storage,
scanner, and one-cycle worker checks. It refuses `NODE_ENV=production` and writes a private hashed
evidence manifest. The manifest verifies the **restored target**; it is not proof that infrastructure
providers restored each backup component. Preserve PostgreSQL, object-storage, configuration,
DNS/TLS, and secret-manager restore evidence separately and attach its references/hashes when
recording the immutable Security restore-drill record.

Only reconnect outbound integrations after application, authorization, file, worker, and reporting smoke tests pass.

Recovery does not require any repository template or generated evidence file.

Keep at least one verified backup copy off the application host.
