# Implementation: Coolify deployment and immutable backups

> This records the initial implementation checkpoint. Final-review corrections and authoritative
> verification results are in 05-quality.md. In particular, direct no-lock B2 writes were replaced
> by a normally locked local restic repository and an immutable B2 mirror; remote GC is disabled.

## Outcome

Implemented the approved single-VPS production infrastructure as additive/narrow changes around the
existing dirty release snapshot. No business API, business database migration, user data, provider
resource, credential, commit, push, deployment, or production system was changed.

The repository now contains a complete Coolify Compose topology, a separately published operations
image, deterministic bootstrap/pre-backup/migration gates, explicit immutable release handoff,
daily encrypted deduplicated B2 backups, separately credentialed maintenance, fail-closed backup
health/status, and recovery commands that only target isolated empty destinations.

## Files created

- `compose.coolify.yaml`
- `Containerfile.operations`
- `deploy/redis/start-redis.sh`
- `deploy/minio/agencyos-app-policy.json`
- `scripts/operations/bootstrap-production.mjs`
- `scripts/operations/release-gate.mjs`
- `scripts/backup/config.mjs`
- `scripts/backup/config.d.mts`
- `scripts/backup/process.mjs`
- `scripts/backup/process.d.mts`
- `scripts/backup/run-backup.mjs`
- `scripts/backup/scheduler.mjs`
- `scripts/backup/scheduler.d.mts`
- `scripts/backup/run-maintenance.mjs`
- `scripts/backup/health.mjs`
- `scripts/backup/health.d.mts`
- `scripts/backup/restore-prepare.mjs`
- `scripts/backup/restore-components.mjs`
- `scripts/release/deploy-coolify.mjs`
- `scripts/release/deploy-coolify.d.mts`
- `scripts/release/production-release.mjs`
- `docs/COOLIFY.md`
- `docs/BACKUP_RECOVERY.md`
- `tests/unit/coolify-deployment-contract.test.ts`
- `tests/unit/backup-operations-contract.test.ts`

`.dockerignore` was restored/replaced because the supplied snapshot intentionally showed the tracked
file as deleted, while a Docker-safe build context is mandatory for Coolify and the release build.

## Files modified narrowly

- `Containerfile`: OCI source/revision labels; minimal application runtime remains unchanged.
- `.github/workflows/release.yml`: literal manual confirmation, two immutable GHCR images, SBOM and
  provenance for both, migration-set manifest, exact digest handoff/read-back, Coolify polling,
  public live/ready/security-header verification, and evidence upload.
- `.env.example`: placeholder-only Coolify, volume, Vaultwarden, B2/restic, schedule, retention,
  heartbeat, release, and isolated-recovery inventory.
- `.gitignore`, `.containerignore`: backup staging/cache/status, recovery, credentials, image digest,
  manifest, and Coolify evidence exclusions.
- `package.json`: Coolify validation, explicit production release, backup/status/maintenance, and
  two-phase restore commands. No application version or dependency was changed for this feature.
- `scripts/security/verify-supply-chain.mjs`: validates the operations Containerfile, complete
  Coolify Compose pins/controls, operations image publication, and deployment handoff.
- `src/lib/validation/env.ts`: exact-host authenticated private-network exception for Redis/MinIO
  only when explicitly opted in; remote plaintext transport remains rejected.
- `src/modules/private-files/server/scan-config.ts`: exact `clamav:3310` private Compose exception
  under the same production opt-in.
- `tests/unit/env-validation.test.ts`: private-network pass/fail and remote TLS regression coverage.
- `README.md`, `deploy/README.md`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
  and `TEST.md`: links, trust boundary, and remaining external approval gates.
- `.node-dev/03-architecture.md`: formatting only.

## Key implementation decisions

- Stateful services have no host `ports`, no Docker socket, stable explicitly named volumes, bounded
  memory/CPU/PIDs, health checks, and a private `internal: true` network. Only gateway and
  Vaultwarden are intended for Coolify proxy routes.
- Redis writes its password into a mode-0600 tmpfs configuration so it is not present in Compose
  command arguments. MinIO starts with root credentials, while bootstrap installs a bucket-scoped,
  non-root application identity and verifies all four buckets remain private with versioning on.
- Vaultwarden uses its own PostgreSQL database/role. Existing credentials are authenticated and
  verified rather than silently rotated. AgencyOS receives only the public vault URL.
- The operations image copies restic 0.18.1 and the MinIO client from digest-pinned upstream images,
  uses the exact Node 22.23.2 and PostgreSQL 17.10 bases, and carries the released migration set.
- Pre-deploy backup is mandatory before the existing advisory-locked/checksum-verified migration
  runner. Migration status and doctor checks must pass before application startup.
- Backups use `pg_dump` rather than live PostgreSQL files, mirror the current MinIO object set,
  capture PostgreSQL-backed Vaultwarden data/files, write hashes/inventories, run restic with
  `--skip-if-unchanged --no-lock`, and serialize all repository access with `flock`.
- Daily B2 credentials have no delete permission. Maintenance receives a distinct delete-capable
  credential, enforces minima of 35 daily/8 weekly/12 monthly/1 yearly, and leaves prune disabled
  until the Compliance Object Lock preflight passes.
- Restore preparation uses a read-only key and performs no service writes. Component restore refuses
  production service names/URLs, non-empty databases/buckets/directories, missing explicit recovery
  confirmation, and all `NODE_ENV=production` execution. There is no production-overwrite flag.
- Normal pushes do not deploy. A clean-tree annotated version tag or literal manual `DEPLOY` action
  publishes both digests, updates/read-backs both Coolify values, polls the deployment, and verifies
  the public host before success.

## Verification completed

- `node --check` passed for every new backup, operations, and release `.mjs` script.
- Focused ESLint passed with zero errors/warnings after cleanup.
- TypeScript verification passed: `npm run typecheck`.
- Focused Vitest passed: 3 files, 22 tests.
- Supply-chain verification passed: `node scripts/security/verify-supply-chain.mjs`.
- `compose.coolify.yaml` and `.github/workflows/release.yml` parsed successfully with the installed
  YAML parser.
- Formatting was applied to all feature files; the repository-wide check had only two reported files
  and both were formatted before handoff.

## Deliberate limitations and external gates

- Docker/Podman is unavailable in this executor, so `docker compose config`, the operations image
  build, vendor health commands, first/second Compose boot, volume-identity check, and injected
  migration-failure integration test were not run here.
- No provider credentials were available or used. The staging Coolify API response-shape test,
  real digest rollout, B2 Object Lock compatibility preflight, backup upload/dedup statistics,
  retention/prune expiry behavior, external heartbeat, and complete isolated restore remain required
  first-deploy approval gates in the runbooks and `TEST.md`.
- MinIO `mc admin user add` requires the initial application secret as a process argument. The
  one-shot bootstrap never logs it and runs only on the private host network, but host root can
  transiently observe it (host root already controls Coolify environment values). This is a narrow
  deviation from the preferred no-secret-argument rule and should be replaced if the pinned MinIO
  release gains a file/stdin admin-credential interface.
- The MinIO capture mirrors the current logical object set and records all remote version metadata;
  it does not separately materialize deleted/historical object-version payloads. Restic snapshots
  preserve previous captured states. If historical MinIO versions become an authoritative recovery
  requirement, add and provider-test a version-aware exporter before claiming that scope.
- Coolify's handling of recreated completed one-shot Compose services and the pinned Vaultwarden/
  ClamAV health commands must be proven on the exact installed versions before production approval.
- Single-VPS operation can have a short release interruption and is not high availability. Backups
  provide recovery, not automatic failover.
