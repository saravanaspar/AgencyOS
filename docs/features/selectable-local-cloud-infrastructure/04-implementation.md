# Implementation: selectable local or cloud infrastructure

## Outcome

Implemented the approved additive dual-mode production architecture. The existing
`compose.coolify.yaml` remains the bundled local stack with all existing service and named-volume
identities. The new `compose.coolify.cloud.yaml` starts no local PostgreSQL, Redis, or MinIO and
uses hosted PostgreSQL, native TLS Redis, and mapped B2-compatible runtime object storage.

No HTTP route, UI contract, SQL schema, migration, business module, or stored logical bucket name
was changed.

## Main implementation

- Added `src/integrations/object-storage/config.mjs` and declarations as the single server-side
  parser/resolver for local MinIO and cloud B2 mappings. It preserves the four logical bucket
  constants while resolving them to physical buckets/prefixes, rejects unsafe/overlapping paths,
  enforces mode/provider agreement, and compares normalized runtime/recovery/backup destinations.
- Kept `src/integrations/minio/object-storage.ts` as the compatibility facade. Existing exported
  constants, functions, errors, size limits, and database-facing logical values remain intact;
  CRUD calls now resolve their physical target immediately before the SDK call.
- Replaced account-wide `listBuckets()` readiness with bounded unique-bucket existence probes.
- Added `scripts/storage/check-object-storage.mjs` for restricted provider-neutral readiness and a
  write/stat/read/delete permission probe.
- Added `scripts/operations/validate-cloud-production.mjs`. It rejects local mode, validates pooled
  and direct TLS database URLs and database separation, checks native authenticated `rediss://`,
  exercises every object-storage logical location, verifies immutable/runtime destination and key
  separation, and performs a ClamAV protocol PING.
- Made the existing production bootstrap explicitly local-only.

## Backup and recovery

- `backupConfiguration()` now selects local MinIO root capture or a distinct cloud source-read key.
  Cloud dumps require direct TLS AgencyOS and Vaultwarden admin URLs.
- Object capture maps each physical bucket/prefix back into the stable
  `minio/<logical-bucket>/...` on-disk layout. This retains schema-v1/current-backup compatibility
  and avoids changing stored database references.
- New backups write schema version 2 with an additive redacted `objectStorage` descriptor while
  retaining the legacy `minio` count/status fields. Restore preparation accepts versions 1 and 2.
- Component restore accepts either legacy isolated MinIO variables or explicit provider-neutral
  MinIO/B2 recovery mappings. It compares endpoint/bucket/prefix tuples, requires empty targets,
  creates canonical buckets only for isolated MinIO, and never provisions cloud resources.
- Redis remains intentionally excluded because it contains reconstructible cache/rate-limit/
  coordination state.

## Retention

Changed the local Restic selection defaults and minimums to:

- 7 daily
- 4 weekly
- 12 monthly
- 1 yearly

Removed `--keep-within 35d`; monthly forget now uses only group-by-host and those four tier
selectors. The immutable B2 mirror remains append-only and unpruned. Therefore this is the local
snapshot catalog policy, not a promise that remote B2 storage is deleted after the tier window.
`BACKUP_PRUNE_ENABLED=1` still fails explicitly.

## Deployment and configuration

- Local manifest: added explicit `AGENCYOS_INFRA_MODE=local` and
  `OBJECT_STORAGE_PROVIDER=minio`; kept all 13 services and all 10 persistent volume names.
- Cloud manifest: added the approved 10 services and seven existing non-data-plane volumes; no
  local database, Redis, MinIO, their volumes, host ports, or Docker socket.
- Kept preflight/predeploy-backup/migration ordering fail-closed before app startup.
- Separated runtime mutable key, backup source-read key, immutable writer key, maintenance key,
  and restore key contracts.
- Added local/cloud Compose validation scripts and retained `coolify:config` as the local alias.
- Updated `.env.example` and operational runbooks with cloud provider setup, mapped recovery, and
  exact retention semantics.

## Files added

- `compose.coolify.cloud.yaml`
- `src/integrations/object-storage/config.mjs`
- `src/integrations/object-storage/config.d.mts`
- `scripts/storage/check-object-storage.mjs`
- `scripts/operations/validate-cloud-production.mjs`

## Important files modified

- `compose.coolify.yaml`
- `.env.example`
- `package.json`
- `src/integrations/minio/object-storage.ts`
- `src/lib/validation/env.ts`
- `src/lib/server/dependency-health.ts`
- `scripts/operations/bootstrap-production.mjs`
- `scripts/backup/config.mjs` and `config.d.mts`
- `scripts/backup/run-backup.mjs`
- `scripts/backup/run-maintenance.mjs`
- `scripts/backup/restore-prepare.mjs`
- `scripts/backup/restore-components.mjs`
- Coolify, backup, architecture, operations, PostgreSQL cutover, and deployment documentation
- Focused environment, storage, Compose, backup, and immutable-repository tests

## Verification completed

- Node syntax checks passed for all new/modified JavaScript modules.
- TypeScript project typecheck passed.
- All three Compose files parse as YAML: local has 13 services/10 volumes; cloud has 10 services/7
  volumes; the legacy production manifest has three services with local-mode defaults.
- Focused Vitest result: 7 files passed, 48 tests passed.
- Prettier was applied to modified source, Compose, tests, and Markdown files.

## Review remediation

- Removed the MinIO-only `mc ready` call from B2 capture while retaining it in local mode.
- Added provider-aware PostgreSQL identity matching for Neon pooled/direct aliases and rejected
  cross-project or cross-database runtime/admin pairs.
- Required secure `sslmode` for every remote recovery PostgreSQL target.
- Moved all database, object-storage, and Vaultwarden destination checks ahead of database restore.
- Bounded every object-storage preflight request and made failed-probe cleanup non-masking.
- Kept the legacy three-service production Compose path working with explicit local defaults.
- Split the documented local and cloud release-gate sequences.

## Verification still required before production approval

No provider credentials or container runtime were available. A disposable live gate must still
prove exact Neon/Upstash/B2 behavior, B2 key restrictions, MinIO SDK/`mc` compatibility, first and
repeat Coolify deployment, preflight failure blocking, backup publication/readback, and a complete
isolated restore. A populated local installation must use the documented write-freeze/data-copy
cutover; changing the Compose manifest alone does not migrate data.
