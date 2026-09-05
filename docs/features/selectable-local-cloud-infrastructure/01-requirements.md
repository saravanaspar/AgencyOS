# Requirements: Selectable local or cloud infrastructure

## Feature Description

Make the production deployment selectable between the existing fully bundled Coolify services and hosted providers. Local mode must keep PostgreSQL, Redis, and MinIO on the VPS. Cloud mode must support Neon-compatible PostgreSQL, Upstash-compatible TLS Redis, and Backblaze B2 S3-compatible runtime object storage while retaining the existing ClamAV scan boundary, release gate, migrations, backups, and isolated restore process.

## API Contract

No HTTP API, UI, authentication, or database schema changes. This is an additive deployment/configuration contract implemented through separate Compose entry points and environment variables.

## Acceptance Criteria

- [x] Existing local deployment remains supported without moving or renaming persistent volumes.
- [x] A cloud deployment does not start or depend on local PostgreSQL, Redis, or MinIO services.
- [x] Cloud PostgreSQL uses a pooled runtime URL and a direct administrative URL for migrations and dumps.
- [x] Cloud Redis requires an authenticated `rediss://` TCP URL.
- [x] Runtime object storage supports a distinct S3-compatible HTTPS endpoint and provider-created bucket names without MinIO admin APIs.
- [x] Current four logical object roles remain isolated and existing local MinIO bucket names remain backward compatible.
- [x] Cloud runtime storage is backed up to a different Object-Lock-enabled B2 backup bucket/prefix.
- [x] PostgreSQL, Vaultwarden, runtime objects, and Vaultwarden files remain covered; Redis remains reconstructible and excluded.
- [x] Default retention is 7 daily, 4 weekly, 12 monthly, and 1 yearly snapshot selection.
- [x] Backup publication remains encrypted, deduplicated, append-only, dependency-first, and snapshots-last.
- [x] Restore supports both local and cloud runtime object-storage configurations without overwriting production.
- [x] Configuration validation fails closed for insecure remote endpoints, identical runtime/backup destinations, missing credentials, and provider mode mismatches.
- [x] Documentation clearly describes both modes and required one-time provider setup.

## Data and Persistence

No data-model or SQL migration changes. Local named volumes and their names remain unchanged. Cloud data persists in hosted PostgreSQL, hosted Redis, and runtime B2 buckets. The backup service retains its local staging/repository volumes and mirrors encrypted Restic repository objects to the separate backup bucket.

## Integrations

- Neon or another PostgreSQL-compatible hosted provider.
- Upstash or another native Redis-over-TLS provider.
- Backblaze B2 S3-compatible API for runtime object storage.
- A distinct Backblaze B2 bucket for immutable backup storage.
- Existing Coolify deployment webhook/image workflow.

## Non-Functional Requirements

- Backward compatible and additive; no destructive migrations or volume renames.
- Least-privilege credentials and no secrets embedded in images or source.
- TLS required for all remote database, Redis, object-storage, and scanner connections.
- Separate credentials and buckets for mutable runtime storage and immutable backup storage.
- Clear health checks, bounded transfers, failure-before-success semantics, and isolated restores.

## Out of Scope

- Provider account creation or insertion of real credentials.
- Automatic remote Restic pruning/garbage collection.
- Backing up Redis cache/coordination state.
- Removing ClamAV or replacing it with a hosted scanner.
- Automatic backup of the Coolify control plane or its `APP_KEY`.
