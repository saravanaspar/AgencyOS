# AgencyOS Security

## Authentication and privileged access

AgencyOS owns email/password authentication, opaque sessions, email verification/reset, and TOTP MFA. Privileged accounts should use MFA. Recent reauthentication is required for critical access-management and security actions. Sessions can be reviewed and revoked from the security workspace. Suspending or deactivating access must invalidate active sessions.

Passwords are stored only as bcrypt hashes. Session and verification tokens are stored only as SHA-256 hashes. TOTP secrets are encrypted with AES-256-GCM under the stable server-only `AUTH_ENCRYPTION_KEY`.

## Secrets

- Store secrets only in runtime environment variables or an approved secret manager.
- `AUTH_ENCRYPTION_KEY` must decode to exactly 32 bytes and must remain stable while encrypted MFA factors exist.
- Use independent secrets for workers, callbacks, connector credentials, notifications, and outbound signing boundaries.
- Keep `AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET` distinct from `INTERNAL_WORKER_SECRET`; production requires a paired credential-free HTTPS `AUDIT_PIPELINE_ALERT_WEBHOOK_URL` and a bearer secret of at least 32 characters.
- Rotate credentials after exposure, staff departure, suspected compromise, or provider incident.
- Never log passwords, password hashes, database URLs, MinIO keys, encryption keys, private document contents, or raw AI prompts.
- `.env.local`, generated evidence, local bootstrap scripts, and legacy provider metadata must not be committed or archived.

## Request and response protections

Unsafe authenticated requests require a valid same-origin `Origin`. Production responses use private/no-store caching where identity or authorization is involved. CSP, frame protection, MIME protection, referrer policy, permissions policy, secure cookies, and HSTS on HTTPS are verified during deployment checks. The bundled Nginx edge overwrites `X-Real-IP`, `X-Forwarded-For`, and forwarded scheme values instead of trusting client-supplied forwarding headers. If another load balancer/CDN sits in front of Nginx, configure Nginx `real_ip` with an explicit trusted-proxy CIDR list before relying on client-IP security signals.

Rate limits apply to password login, MFA attempts, password reset, search, exports, AI chat, MCP, and internal workers. Production authenticated limits fail closed if Redis is unavailable unless the operation has a database-backed safety fallback.

## Files and exports

Private files are quarantined in MinIO, scanned, checksum-verified, and served only through reauthorizing server routes. Multipart routes require bounded `Content-Length`, and reference ingress limits protect against oversized bodies. Server-side PDF rendering disables JavaScript, aborts network requests, and does not permit `file:` resources. Exports require separate permission, private no-store responses, and spreadsheet-formula neutralization.

## MCP and AI

MCP tools are filtered by effective permission and reauthorized on every invocation. Inputs and outputs are bounded. Sensitive mutations require a bound approval. Models cannot receive provider keys, private file bytes, unrestricted database access, or tools outside the active membership's permissions. Organization AI policy adds a second boundary: AI is disabled by default, external provider data egress must be explicitly enabled, providers/modules are allowlisted, and ordinary mutation tools are disabled unless the organization enables them. AI provider evidence is metadata-only.

## Database/provider security

Use `DATABASE_ADMIN_URL` only for migrations, pgTAP, dump/restore, and provider moves. It must be a direct/non-pooled connection and must never reach the browser. Normal web/worker traffic uses `DATABASE_URL` with bounded connection/statement timeouts. Runtime SQL must continue to carry explicit organization/record scope; RLS is defense in depth, not a substitute for scoped queries. `npm run security:tenant-scope` blocks new or changed tagged SQL that touches organization-owned tables without an explicit `organization_id` reference. `npm run db:doctor` rejects leftover migration compatibility auth/storage objects on the final target.

## Audit-pipeline failure detection

The worker commits a platform-scoped system canary to the real append-only `audit_events` sink every five minutes. A failed canary is reported directly from the worker process to the separately configured audit webhook, bypassing PostgreSQL notification and email queues. The fixed payload contains only service/component, failure or recovery state, severity, version, and timestamp—never exception detail, tenant data, request bodies, credentials, or destination data. Requests are byte-bounded, time-bounded, and redirect-denying; repeated failures are throttled and a recovered incident produces one recovery event.

## Incident response

1. Record severity, affected organizations, time window, systems, and owner.
2. Contain by revoking sessions/credentials and disabling affected integrations or workers.
3. Preserve and review audit, security, worker, integration, and provider evidence without copying secrets into tickets.
4. Recover by patching the cause, rotating credentials, verifying migrations/authorization, and restoring affected services.
5. Communicate factual impact, actions, and next steps to the appropriate audience.
6. Record root cause and corrective work to closure.

## Release checks

```bash
npm run security:framework
npm run security:supply-chain
npm run security:tenant-scope
npm run verify
npm run db:status
npm run db:doctor
npm run db:test
npm run test:e2e
```

The security workflow runs daily and fails on high/critical production dependency advisories. GitHub Actions and production/base container inputs are immutable pins, and release builds publish an SBOM plus provenance before exposing the immutable image digest.

The protected Release Gate runs `npm run verify:release` against an approved isolated PostgreSQL database and disposable browser-test accounts.

## Security acceptance matrix

| Boundary         | Allowed case                                      | Required denial                                                |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Authentication   | Valid password/session and privileged AAL2 access | Bad credential, expired/revoked session, missing required MFA  |
| Authorization    | Permitted role and record scope                   | Explicit deny, foreign organization, role-name tampering       |
| Sessions         | User/admin reviews or revokes permitted sessions  | Unauthorized access to another member's sessions               |
| Files            | Clean permitted upload/download                   | Quarantined, mismatched, executable, or foreign file           |
| Finance and HR   | Scoped authorized records                         | Sensitive records outside effective permission                 |
| API and CSRF     | Same-origin authenticated mutation                | Missing/foreign Origin                                         |
| Workers/webhooks | Correct secret/signature/idempotency              | Invalid, replayed, cross-purpose, or over-limit request        |
| Exports          | Separate export permission and safe output        | View-only or foreign-scope export                              |
| MCP and AI       | Reauthorized bounded tool call                    | Unapproved mutation or altered approval arguments              |
| Backups          | Encrypted backup restored in isolation            | Unverified copy or premature reconnection to live integrations |

Evidence should be access-controlled and append-only where possible. Store hashes or references instead of raw secret-bearing output.
