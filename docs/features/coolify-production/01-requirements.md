# Requirements: Production deployment and immutable backups

## Feature Description

Make the existing AgencyOS application deployable as a professional, self-hosted Coolify stack. The first deployment must create and start all application dependencies. Later deployments must replace application code while retaining PostgreSQL, Redis, MinIO, Vaultwarden data, and Coolify-managed environment values.

## Deployment Contract

- Provide one production Compose definition that Coolify can deploy from the repository.
- Normal branch pushes must not deploy production accidentally.
- An explicit production release action must validate the repository, publish an immutable application image, and trigger the existing Coolify application through its deploy webhook.
- Every application release must run pending database migrations before application traffic is accepted.
- Failed migrations or failed readiness checks must fail the deployment rather than silently starting a partially upgraded application.
- Provide live, ready, and operational status endpoints compatible with container and Coolify health checks.

## Acceptance Criteria

- [ ] A fresh VPS with Docker and Coolify can create the entire stack from the repository plus one-time secret values.
- [ ] PostgreSQL, Redis, MinIO, Vaultwarden, and backup state use stable named volumes that survive application updates.
- [ ] Secrets are absent from the repository and required production values fail closed when missing.
- [ ] The application, background worker, database migration job, and dependent services use health checks and deterministic startup ordering.
- [ ] Production releases occur only through an explicit command or manual workflow action.
- [ ] Releases use immutable image identifiers and invoke the configured Coolify deployment webhook only after validation succeeds.
- [ ] Database migrations are serialized, repeatable, and run automatically during deployment.
- [ ] Daily encrypted backups include a consistent PostgreSQL dump, MinIO data, and Vaultwarden data.
- [ ] Backups are incremental and deduplicated, skip unchanged source data when possible, and apply daily/weekly/monthly retention.
- [ ] Backblaze B2 S3-compatible storage is supported as the off-site target, with documented Object Lock configuration.
- [ ] Backup failures are visible through health/status output and non-zero exit codes.
- [ ] Restore and verification commands are documented and safe by default.
- [ ] Existing application behavior and the user's uncommitted project work remain intact.

## Data and Persistence

- Existing PostgreSQL schema and ordered SQL migrations remain authoritative.
- Stable persistent volumes are required for PostgreSQL, Redis, MinIO, Vaultwarden, and backup cache/state.
- Application containers remain disposable and must not hold authoritative mutable data.
- Restores must target explicit recovery locations or an explicitly confirmed database, never silently overwrite production.

## Integrations

- Coolify: repository-based Docker Compose deployment and deployment webhook.
- Container registry: GitHub Container Registry by default, with configurable image coordinates.
- Backblaze B2: private S3-compatible bucket used by restic for encrypted off-site backups.
- Optional SMTP and application integrations remain configured through existing environment variables.

## Non-Functional Requirements

- Initial operating target: approximately three users with low-latency interactive use.
- Scale later by moving stateful services independently and increasing application/worker replicas.
- Least-privilege containers, private internal service ports, bounded resource use, health checks, and graceful shutdown.
- Backups must be encrypted before leaving the VPS, integrity-checkable, and protected by provider-side immutable retention.
- Documentation must be usable by a non-specialist for first deployment, routine release, backup verification, and recovery.

## Out of Scope

- Creating or paying for the VPS, domain, GitHub, Coolify, or Backblaze accounts.
- Embedding production credentials in the repository or generated ZIP.
- Changing business features, public API contracts, or the existing database schema except where operational metadata is strictly necessary.
- Guaranteeing zero downtime on a single-VPS, single-database topology.
- Automatically modifying provider-side Object Lock or account security without the account owner's credentials and confirmation.
