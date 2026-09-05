# AgencyOS Architecture Decisions

Production uses `compose.coolify.yaml` for bundled services or `compose.coolify.cloud.yaml` for
hosted PostgreSQL, Redis, and S3-compatible runtime object storage: disposable web/worker and
operations images surround private PostgreSQL, authenticated Redis, object storage, ClamAV, and
PostgreSQL-backed Vaultwarden. Stateful data
stays in stable named volumes; encrypted off-host B2 snapshots are the disaster-recovery boundary.

## System shape

AgencyOS is a modular Next.js monolith backed by ordinary PostgreSQL. Authentication is owned by AgencyOS and stored in the same PostgreSQL system of record; the database may run on Neon, local/self-hosted PostgreSQL, or another compatible provider. Server-side modules own authorization, validation, business transactions, audit events, and integrations.

Core infrastructure:

- **PostgreSQL:** AgencyOS identity, opaque sessions, TOTP metadata, tenant data, RLS, transactions, migrations, and pgTAP.
- **Object storage:** one private S3-compatible bucket with application-owned logical prefixes.
- **Redis:** rate limiting, worker coordination, short-lived cache entries, and replay protection. PostgreSQL advisory locks provide coordination fallback for bounded workers.
- **AgencyOS worker:** internal scheduling and bounded automation execution using the same authorization/database boundaries as the web application.
- **Vaultwarden:** independent secret storage; AgencyOS stores item references only.
- **Chromium:** shared server-side HTML-to-PDF rendering.
- **MCP:** same-origin, permission-filtered tools reauthorized on every call.

The browser receives no database credentials, object-storage credentials, encryption keys,
model-provider secrets, or unrestricted MCP access.

## First-party authentication

AgencyOS authenticates directly against `public.identity_accounts` and `public.identity_credentials`. Passwords are bcrypt hashes verified through PostgreSQL `pgcrypto`. Browser sessions are opaque random tokens; only SHA-256 token hashes are stored in `public.identity_sessions`. Cookies are HTTP-only, Secure in production, SameSite=Lax, and bounded by both identity-session expiry and the organization security-session policy.

Email verification and password-reset tokens are random, hashed at rest, single-use, and expiry-bounded. TOTP secrets are encrypted with AES-256-GCM using the stable server-only `AUTH_ENCRYPTION_KEY`. Privileged MFA, recent reauthentication, security-event history, session revocation, suspicious-login controls, and rate limits remain layered on top of the first-party identity session.

## Authorization and audit

Organization membership and effective permissions are checked at navigation, server-action, API, worker, export, file, report, and MCP boundaries. Explicit denies win over inherited allows. Sensitive mutations require their normal permission and, where configured, a bound approval. Audit and domain-event records are append-only.

Historical RLS policies that used a hosted-auth helper are migrated to `private.current_identity_id()`. Runtime application queries still enforce organization and record scope explicitly; RLS remains defense in depth for database roles used in tests or future constrained clients. A CI tenant-scope regression guard inventories organization-owned tables and rejects new/changed tagged SQL that omits an explicit organization reference. Existing legacy exceptions are a reduction backlog, not proof that an unscoped query is safe.

## Notifications

Notification delivery is provider-neutral. In-app state is stored in PostgreSQL. Email uses Resend when configured and payloadless Web Push uses VAPID when configured. The browser performs lightweight bounded counter refreshes on focus/online events and a conservative foreground interval; there is no hosted database Realtime dependency.

## Shared approval engine

All modules use one organization-scoped approval engine with versioned definitions, immutable request snapshots, materialized approver steps, append-only actions, sequential or parallel stages, delegation, reminders, escalation, expiry, and scoped visibility.

## Shared private-file lifecycle

Private files enter an object-storage quarantine prefix as opaque bytes. Server validation checks
extension, MIME, signature, size, and SHA-256. A bounded worker sends the object to a trusted
scanner. Only clean, checksum-matching files are copied to release prefixes. Every download
reauthorizes the current membership and returns forced-download headers.

## Internal worker boundary

One authenticated endpoint accepts a fixed job enum and uses `INTERNAL_WORKER_SECRET`. The worker process schedules calls to that endpoint over `INTERNAL_APP_URL` and executes due jobs with bounded concurrency, preventing one slow job from stalling unrelated schedules. Automation dispatch executes only registered internal handlers; it cannot accept arbitrary URLs, code, SQL, or function names. Database claims, Redis leases, PostgreSQL fallback locks, retries, idempotency, permission checks, append-only attempts, and dead-letter records remain inside AgencyOS.

## Permission-aware AI and MCP

Gemini and DeepSeek are server-side providers. The model sees only tools allowed for the active membership. Every tool call is reauthorized, input/output is bounded, sensitive mutations require exact approval binding, and provider credentials never enter model context. Organization AI governance is fail-closed: provider egress starts disabled, provider/module allowlists constrain what may leave the tenant boundary, low-risk mutation availability is explicit, and append-only provider evidence records metadata without storing prompts or model output.

## Database portability

AgencyOS is PostgreSQL-provider portable, not database-engine agnostic. Schema state lives under `database/migrations/` and is tracked in `agency_migrations.schema_migrations`. `DATABASE_URL` is for runtime traffic; `DATABASE_ADMIN_URL` is for forward migrations, pgTAP, dump/restore, and provider moves.

Historical migrations are replayed unchanged. New migrations may not manage their own `BEGIN`/`COMMIT`; the runner owns the transaction so schema changes and migration-history writes commit atomically. Two immutable historical self-managed migrations have explicit schema-state recovery probes that repair a missing ledger entry only when every expected object is already present, and fail closed on partial application. On a brand-new PostgreSQL database the migration runner creates temporary compatibility objects needed by older migration files, applies the modern identity migrations, then removes those shims. They are migration-time objects, not runtime dependencies.

## Backup and recovery

Back up PostgreSQL, object storage, and deployment configuration independently. Store secrets
separately and keep at least one encrypted off-host copy. Restore into an isolated environment with
outbound email/integrations disabled, run migrations, `db:doctor`, pgTAP, source verification,
worker smoke tests, and application smoke tests before reconnecting external services.

## Maintainability and observability guardrails

AgencyOS remains a modular monolith. Large legacy module/action/workspace files are tracked in `quality/complexity-baseline.json`; they may shrink but may not grow, and new source files must remain under the default complexity budget. This creates a staged refactor path without combining broad code movement with security fixes.

The web edge generates request IDs, server/worker paths emit structured JSON events, and a private Prometheus endpoint exposes process-local operational counters/latencies. Dependency status is split between liveness, readiness, and a bearer-protected diagnostic endpoint. Production deployments should forward logs and scrape metrics into durable external telemetry storage.
