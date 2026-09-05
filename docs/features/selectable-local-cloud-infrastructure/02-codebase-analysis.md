# Codebase analysis: selectable local or cloud infrastructure

## Executive summary

AgencyOS already has most of the low-level provider portability needed for hosted PostgreSQL and
Redis, but the production orchestration and object-storage/backup contracts are still hard-wired to
the bundled stack.

- PostgreSQL runtime access is provider-neutral. `DATABASE_URL` may be pooled and
  `DATABASE_ADMIN_URL` is already required to be direct for migrations and administrative tools.
- Redis runtime access accepts `redis://` and `rediss://`; production already restricts plaintext
  Redis to the exact authenticated `redis:6379` private-network topology.
- The object client uses the MinIO JavaScript SDK, whose S3 operations can target B2's
  S3-compatible HTTPS endpoint, but logical bucket names, configuration names, readiness probes,
  bootstrap, backup, and restore are all MinIO-specific today.
- `compose.coolify.yaml` is a complete local stack and must remain unchanged in its service and
  volume identity contract. It unconditionally starts and depends on `postgres`, `redis`, and
  `minio`, so cloud mode needs a separate entry point rather than Compose profiles or optional
  dependencies.
- The backup repository already uses a separate Object-Lock-enabled B2 bucket, local Restic
  repository, encryption, deduplication, serialized locks, dependencies-first publication, and
  snapshots-last publication. Runtime object capture still assumes local MinIO root credentials and
  fixed bucket names.
- Retention defaults do not match the new request: code and Compose currently default to 35 daily,
  8 weekly, 12 monthly, and 3 yearly, with minimums of 35/8/12/1. These must become 7/4/12/1.

The safest additive design is to preserve `compose.coolify.yaml` as the local entry point and add a
standalone cloud entry point (for example `compose.coolify.cloud.yaml`). Both should reuse the same
application, worker, scanner, Vaultwarden, migration, backup, gateway, and maintenance definitions
at the source-code level, while cloud mode must contain no local PostgreSQL, Redis, or MinIO service
or `depends_on` edge.

## Current deployment topology

### Local Coolify production

`compose.coolify.yaml` currently defines 13 services:

1. `postgres`, `redis`, and `minio` as local stateful dependencies.
2. `clamav` with persistent signatures and private plus egress networking.
3. `bootstrap`, which creates/verifies the Vaultwarden database and provisions the MinIO identity,
   policy, buckets, privacy, and versioning.
4. `vaultwarden`, `predeploy-backup`, `migrate`, `app`, `worker`, `gateway`, `backup`, and
   `backup-maintenance`.

All local data volume names are stable and externally named through
`${AGENCYOS_VOLUME_PREFIX:-agencyos-production}`. The required compatibility boundary is to keep
the existing `postgres-v1`, `redis-v1`, `minio-v1`, `clamav-signatures-v1`, `vaultwarden-v1`,
`backup-state-v1`, `restic-cache-v1`, `restic-repository-v1`, `backup-stage-v1`, and
`release-status-v1` names intact. No implementation should rename, recreate, or conditionally
redeclare these volumes in the local manifest.

The manifest has no host-published service ports, keeps the application dependencies on an
`internal: true` network, pins external runtime images by digest, and uses immutable app and
operations image references. Those contracts are asserted in
`tests/unit/coolify-deployment-contract.test.ts` and should be extended, not replaced.

### Developer/local dependency manifests

- `compose.database.yaml`, `compose.redis.yaml`, and `compose.minio.yaml` remain useful independent
  local development resources.
- `compose.production.yaml` only starts app/worker/gateway and relies on a private env file. It is a
  release-candidate/Podman path, not the complete Coolify stack and should not become the cloud
  Coolify contract.
- `package.json` has independent `db:*`, `redis:*`, and `storage:*` commands plus a combined
  `dependencies:*` workflow. These should remain backward compatible.

## Existing provider-neutral seams to reuse

### PostgreSQL

- `src/integrations/postgres/database.ts` already documents and implements a provider-neutral
  `postgres` client. It uses `DATABASE_URL` with a bounded pool and disables prepared statements,
  which is compatible with transaction poolers.
- `scripts/database/portable-database.mjs` already separates pooled runtime from direct migration
  traffic. `getAdminDatabaseUrl()` requires `DATABASE_ADMIN_URL` for a remote host, and
  `assertDirectMigrationUrl()` rejects common pooler shapes (`-pooler`, `.pooler`, port 6543, or
  `pgbouncer=true`).
- `connectionEnvironment()` defaults remote command-line connections to `PGSSLMODE=require`.
- `docs/POSTGRESQL_CUTOVER.md` already documents copying to and from Neon using direct URLs.
- Existing forward-only migrations, advisory migration lock, checksum ledger, status, and doctor
  commands do not need a schema or public API change.

Cloud Compose should pass the pooled Neon URL only to app/worker/Vaultwarden as appropriate and the
direct URL only to migrations and backup/administrative jobs. The application image should not
receive `DATABASE_ADMIN_URL`.

### Redis

- `src/integrations/redis/client.ts` uses the standard Node Redis URL interface, so an Upstash native
  Redis-over-TLS URL can be consumed without a new client.
- It already has bounded connect behavior, no offline queue, limited command queue, a key prefix,
  and a database-safe fallback. Production rate-limiting policy separately fails closed where
  required.
- `src/lib/validation/env.ts` permits `rediss://` remotely and permits plaintext only for the exact
  private Compose URL after explicit `AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK=1` opt-in.

The cloud contract still needs stricter authentication validation: current production validation
accepts a remote `rediss://` URL without proving that username/token credentials are present. Cloud
mode should require a credential-bearing native TCP `rediss://` URL and must not accept Upstash's
HTTP REST URL.

### Runtime object storage

`src/integrations/minio/object-storage.ts` is the single runtime storage boundary. Application
modules import four stable logical names from it:

- `private-file-quarantine`
- `private-files`
- `project-attachments`
- `document-templates`

Database constraints and rows also persist these logical names. Therefore, those constants are a
public data contract and must not be changed to globally unique B2 bucket names. Instead, the
storage boundary should translate each logical bucket to a configured physical S3 bucket (and, if
chosen, a role prefix) immediately before every client operation. `putMinioObject`,
`readMinioObject`, `removeMinioObject`, `minioObjectExists`, and readiness checks must all use that
same resolver.

The existing `parseMinioEndpoint()` and client cache can be generalized or wrapped. A large new
storage implementation is unnecessary: the installed `minio` SDK already supplies the used S3
operations (`putObject`, `getObject`, `removeObject`, `statObject`, bucket existence/listing), and
the operations image already includes pinned `mc`.

Important compatibility constraints:

- Keep the exported logical constants and error codes so all current module code and database rows
  remain valid.
- Local mode must resolve every logical bucket to its current canonical physical bucket, with no
  key prefix change.
- Cloud mode should use explicit provider-created physical bucket mapping. A single B2 runtime
  bucket with four stable role prefixes is operationally attractive because a B2 application key
  can be bucket-restricted; four separately named buckets may require broader account-level
  credentials. Either representation can be supported by the resolver, but one unambiguous cloud
  contract should be documented and tested.
- `checkMinio()` currently calls `listBuckets()`, which needs broader permissions than a
  bucket-scoped B2 runtime key. It should probe only configured physical bucket(s) with a bounded
  operation.
- `scripts/storage/setup-minio.mjs` and `check-minio.mjs` hard-code the logical names. The local
  setup behavior can stay, while cloud mode needs a validation-only S3 check that does not attempt
  MinIO admin APIs or create provider credentials.

### Scanner boundary

ClamAV is already independent from object storage. Files are first written to the quarantine
logical bucket, scanned, then moved through server-side object operations. Both deployment modes can
retain local `clamav://clamav:3310` on the private network without exposing a public port. Cloud
mode still needs `clamav` in both private and egress networks so signature updates continue.

## Bootstrap findings

`scripts/operations/bootstrap-production.mjs` combines two unrelated administrative concerns:

1. It connects through `DATABASE_CONTROL_URL`, creates/verifies a Vaultwarden role and database,
   and refuses silent password rotation.
2. It uses MinIO root credentials and `mc admin` to provision four buckets, versioning, application
   identity, and policy.

Neither behavior is appropriate as-is for cloud mode:

- Hosted PostgreSQL should use provider-created AgencyOS and Vaultwarden databases/credentials;
  the deployment should validate them rather than assume `CREATE DATABASE` or role-management
  authority.
- B2 application keys and buckets must be created through the provider control plane once. An
  application container should not receive master credentials or attempt `mc admin user/policy`.

The local bootstrap must remain intact. Cloud mode should use a separate validation-only bootstrap
script or an explicit mode branch with strict mode validation. Separate scripts reduce the chance
of a provider-mode mistake granting cloud jobs local root assumptions.

## Backup and restore findings

### Existing strong contracts to preserve

- `scripts/backup/repository.mjs` verifies default B2 Compliance Object Lock of at least 30 days.
- Restic writes to a persistent local repository with normal locks, while `withFlock` serializes
  backup and maintenance jobs.
- Upload is append-only: it publishes `config`, `keys`, `data`, and `index` before `snapshots`, does
  not use overwrite/remove, excludes Restic locks, and verifies the published snapshot read-only.
- `run-backup.mjs` uses uncompressed custom `pg_dump` for AgencyOS and Vaultwarden, hashes both,
  captures Vaultwarden files, records a manifest, sends the external heartbeat, and only then
  advances `last-success.json`.
- Redis and ClamAV data are correctly excluded as reconstructible.
- `restore-prepare.mjs` performs a read-only verified Restic restore, validates dump hashes, and
  checks dump readability.
- `restore-components.mjs` refuses production, requires recovery confirmation, rejects occupied
  databases/storage, and never uses destructive database restore flags.

### Cloud-mode gaps

- `backupConfiguration()` requires `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, and
  `MINIO_ROOT_PASSWORD`; cloud backup must use least-privilege runtime S3 read/list credentials,
  not MinIO root credentials.
- `captureMinio()` hard-codes the four canonical physical bucket names and always uses one MinIO
  alias. It must iterate logical-to-physical locations through the same configuration contract as
  runtime storage. The snapshot directory should continue recording logical names so database
  references remain portable across providers.
- Backup validation must compare every runtime object-storage destination with the backup
  repository destination. At minimum, the immutable backup bucket must differ from the mutable
  runtime bucket. Comparing only variable names or prefixes is insufficient; normalize endpoint,
  bucket, and prefix/location.
- The cloud backup service needs both the runtime B2 read/list key and the distinct backup-bucket
  writer key. Credentials must have separate variable names and must never be logged.
- `restore-components.mjs` assumes an isolated MinIO endpoint and canonical buckets. It currently
  rejects the same endpoint hostname, which would incorrectly reject a valid recovery B2 bucket in
  the same B2 region. Isolation should compare normalized physical destinations rather than only
  endpoints.
- Restore should map snapshot logical directories to configured recovery physical bucket/prefixes,
  check that each target location is empty, and retain the same logical database values. It must
  support local MinIO recovery and cloud S3 recovery without allowing a production target.
- Existing manifests use schema version 1 and a `minio` field/directory. New code should read the
  old shape. An additive `objectStorage` field or schema version may be written, but restore must
  remain backward compatible with already-created snapshots.

### Retention mismatch

`scripts/backup/run-maintenance.mjs` currently defines:

- daily: default/minimum 35
- weekly: default/minimum 8
- monthly: default/minimum 12
- yearly: default 3, minimum 1

`compose.coolify.yaml` and `.env.example` repeat 35/8/12/3. All three sources and tests/docs must be
updated to 7/4/12/1. The existing `--keep-within 35d` should be reconsidered because it forces at
least 35 days even when the requested daily selection is seven. If exact tiered selection is the
contract, remove or align that extra time window.

This retention affects the persistent local repository selection only. The encrypted B2 mirror is
append-only and remote packs/snapshots remain indefinitely because automatic remote pruning is
intentionally out of scope. Documentation must state this clearly so “7/4/12/1” is not incorrectly
presented as a remote B2 deletion policy. Compliance Object Lock and a non-delete writer remain
unchanged.

## Configuration and validation findings

`src/lib/validation/env.ts` currently exposes `getMinioEnv()` and labels all object-storage errors
as MinIO. This is the natural place to add a provider-neutral runtime object-storage configuration
while preserving `getMinioEnv()` as a compatibility alias if tests or modules still import it.

Recommended fail-closed rules:

- Explicit infrastructure/provider mode (`local` versus `cloud`) in each production manifest.
- Local mode: exact private service hosts, authenticated Redis, current MinIO endpoint, and explicit
  private-network trust flag.
- Cloud mode: remote PostgreSQL URLs use TLS; runtime may be pooled, admin/dump URL must be direct;
  Redis is credential-bearing `rediss://`; object storage is credential-free `https://` endpoint
  plus non-empty credentials and explicit physical location mappings.
- Reject credentials embedded in object endpoint URLs, paths where unsupported, and any HTTP cloud
  endpoint.
- Reject a local provider declaration with cloud-only variables, and a cloud provider declaration
  with MinIO root/admin variables as its runtime contract.
- Normalize and reject identical runtime and backup endpoint/bucket/prefix locations.
- Do not expose runtime object-store or backup credentials to browser variables or logs.

The app startup validator currently validates only `DATABASE_URL`; operations scripts must validate
the direct administrative URL independently. Hosted TLS validation should account for URL query
parameters such as `sslmode=require` and should not strip provider parameters such as Neon channel
binding.

## Compose strategy and backward compatibility

Use two complete entry points:

- `compose.coolify.yaml`: existing local bundle, same service names and stable volume names.
- `compose.coolify.cloud.yaml`: no `postgres`, `redis`, or `minio` service; hosted URLs/credentials
  are required; retains `clamav`, `vaultwarden`, predeploy backup, migrate, app, worker, gateway,
  scheduled backup, and maintenance.

Separate entry points are safer than profiles because Coolify/Compose dependency validation can
still require disabled services, interpolation can demand irrelevant secrets, and a mistaken
profile may silently bring up the wrong data plane. It also makes it easy for tests to assert that
the cloud manifest contains no local data services, local data volumes, or dependencies on them.

Do not delete or replace the existing local Compose file. A user can select the desired manifest
during the one-time Coolify resource setup. Switching an already-populated deployment from local to
cloud remains a deliberate data-cutover operation using the existing `db:copy` flow plus an object
copy/verification step; it should not be represented as a zero-copy toggle.

## Duplicate-code and reuse assessment

There is no existing `OBJECT_STORAGE_*`, `S3_*`, runtime-B2, provider-mode, or cloud-Compose
abstraction elsewhere in the tree. New work should centralize these concerns rather than add more
copies of the four bucket literals.

High-value reuse/consolidation targets:

- Export one logical bucket descriptor/resolver used by runtime storage, health checks, backup,
  restore, setup validation, and tests.
- Reuse the existing MinIO SDK and pinned `mc`; do not add the AWS SDK solely for the current CRUD
  surface.
- Reuse `parsePostgresConnection`, `postgresEnvironment`, `requiredEnvironment`, `safeName`,
  `checkedCommand`, redaction, atomic status, and restore isolation helpers.
- Reuse the local bootstrap unchanged behind the local manifest; add only cloud validation behavior.
- Extend `tests/unit/env-validation.test.ts`, `minio-storage.test.ts`,
  `backup-operations-contract.test.ts`, `immutable-repository.test.ts`, and
  `coolify-deployment-contract.test.ts` instead of creating overlapping contract suites.

## Breaking-change analysis

No HTTP route, UI, TypeScript public action signature, or SQL migration is needed. The primary
breaking risks are configuration and stored-data compatibility:

- Changing logical bucket constants would break SQL constraints and existing stored rows.
- Renaming local volumes could point production at empty data.
- Replacing `MINIO_*` variables outright would break existing local environments. Add generic/cloud
  variables or maintain legacy aliases with strict precedence and conflict rejection.
- Changing Restic repository prefix/password or initializing an empty local repository without
  probing B2 could create an incompatible repository; current protection must remain.
- Restore must continue reading schema-v1 manifests and `minio` snapshot directories.
- The release workflow only changes application and operations digest variables, so both Compose
  resources can continue using the same professional release handoff without provider secrets in
  GitHub.

## Tests that should be added or updated

1. Parse both production manifests as YAML and assert service/dependency topology, no host ports,
   no Docker socket, and stable local volumes.
2. Assert cloud Compose has no local PostgreSQL/Redis/MinIO service, volume, root credential, or
   `depends_on` reference.
3. Validate local mode remains accepted with exact private hosts and cloud mode accepts Neon pooled
   runtime plus direct admin, authenticated Upstash `rediss://`, and HTTPS B2 runtime storage.
4. Reject HTTP cloud dependencies, unauthenticated Redis, pooled admin URL, provider-mode conflicts,
   missing logical storage mappings, and identical runtime/backup destinations.
5. Verify all four logical bucket constants resolve to canonical local buckets and configured cloud
   physical locations without changing keys or database-facing names.
6. Verify restricted object-storage readiness does not call account-wide `listBuckets()`.
7. Verify cloud backup captures all logical roles with runtime read credentials, publishes the
   encrypted repository to the separate bucket dependencies-first/snapshots-last, and excludes
   Redis.
8. Verify a capture or upload failure cannot advance success evidence.
9. Verify restore to both isolated local MinIO and isolated cloud S3 locations; reject production
   or occupied locations, including same B2 endpoint plus same physical bucket/prefix.
10. Assert retention defaults and Restic arguments are exactly 7 daily, 4 weekly, 12 monthly, and
    1 yearly, while remote prune remains absent/disabled.
11. Keep all existing migration, release-gate, immutable publication, and Chromium-backed release
    checks in the final verification suite.

## Relevant file map

- Production orchestration: `compose.coolify.yaml`, `compose.production.yaml`,
  `.github/workflows/release.yml`, `scripts/release/deploy-coolify.mjs`
- Environment: `.env.example`, `src/lib/validation/env.ts`
- PostgreSQL: `src/integrations/postgres/database.ts`, `scripts/database/portable-database.mjs`,
  `scripts/database/migrate.mjs`, `docs/POSTGRESQL_CUTOVER.md`
- Redis: `src/integrations/redis/client.ts`, `scripts/check-redis.mjs`, `compose.redis.yaml`
- Object storage: `src/integrations/minio/object-storage.ts`, `scripts/storage/setup-minio.mjs`,
  `scripts/storage/check-minio.mjs`, `deploy/minio/agencyos-app-policy.json`, `compose.minio.yaml`
- Bootstrap: `scripts/operations/bootstrap-production.mjs`
- Backup: `scripts/backup/config.mjs`, `repository.mjs`, `run-backup.mjs`, `run-maintenance.mjs`,
  `scheduler.mjs`, `health.mjs`
- Restore: `scripts/backup/restore-prepare.mjs`, `restore-components.mjs`
- Runtime health: `src/lib/server/dependency-health.ts`, `src/app/api/health/ready/route.ts`
- Documentation: `docs/COOLIFY.md`, `docs/BACKUP_RECOVERY.md`, `docs/ARCHITECTURE.md`,
  `docs/OPERATIONS.md`, `deploy/README.md`, `.env.example`
- Existing tests: `tests/unit/coolify-deployment-contract.test.ts`,
  `env-validation.test.ts`, `minio-storage.test.ts`, `backup-operations-contract.test.ts`, and
  `immutable-repository.test.ts`

## Implementation guardrails

- Preserve the user's existing dirty worktree and make only additive, scoped edits.
- Do not alter business modules or database migrations for this infrastructure feature.
- Do not create provider accounts, insert credentials, or deploy externally.
- Keep the cloud path fail-closed: one-time provider-created databases, buckets, and credentials
  must be validated before migration, backup, or app startup.
- Treat switching a populated local installation to cloud as a cutover with verified database and
  object copies, not as an environment toggle.
- Continue to require a real provider integration test and isolated restore drill before production
  approval.
