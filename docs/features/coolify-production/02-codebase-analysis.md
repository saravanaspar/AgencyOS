# Codebase analysis: Coolify deployment and immutable backups

## Scope and preservation boundary

This analysis covers the complete repository at `/workspace/scratch/daf035f5b8cf/AgencyOS-work`
against `.node-dev/01-requirements.md`. It is read-only with respect to application and deployment
files. The only files created or updated by this exploration step are under `.node-dev/`.

The working tree is intentionally dirty and is the user's release-candidate snapshot, not a clean
checkout. At the start of this analysis it contained **122 modified, 2 deleted, and 47 untracked
paths** relative to commit `fb9c06f8c103201db761243147ba88e898a9b94d` on `master` (124 tracked
files changed, 3,115 insertions and 2,211 deletions). These pre-existing edits include application
features, migrations, tests, container changes, and documentation. They all belong to the user and
must be preserved. Infrastructure work must be additive or narrowly merged; it must not reset,
checkout, clean, or overwrite unrelated changes.

The uploaded `../upload/AgencyOS.zip` was materialized into `../review/AgencyOS` and then copied to
this worktree. A recursive comparison showed the project content matched the review snapshot,
apart from generated dependencies/build/test artifacts and the new `.node-dev` workflow state.
Therefore this is the correct full-project source of truth for implementation.

Important packaging constraint: `scripts/archive-source.mjs` runs `git archive HEAD`, so it omits
every uncommitted and untracked change. It cannot create the requested final ZIP unless the changes
are first committed. If no commit is made, packaging must enumerate the current working-tree files
with the same sensitive/generated-file exclusions instead.

## Project shape and runtime stack

- Application: security-oriented modular monolith built with Next.js `16.2.11`, React `19.2.7`,
  TypeScript `5.9`, and Node `22.23.2` (the exact runtime is pinned by `.node-version`,
  `package.json#engines`, and `Containerfile`).
- Build: `next.config.ts` uses `output: "standalone"`; the current multi-stage `Containerfile`
  creates a non-root `nextjs` runtime containing the standalone server, public/static assets, and
  `scripts/workers/`.
- Web: `node server.js`, internal port 3000.
- Background worker: `node scripts/workers/run.mjs`; it calls one authenticated internal endpoint
  and schedules 11 bounded jobs with 1-8 configured concurrency (default 3).
- Gateway: digest-pinned Nginx, internal port 8080, 28 MiB buffered upload limit, trusted forwarding
  header boundary, and app liveness probe.
- Database: PostgreSQL 17 with required `pgcrypto` and pgTAP extensions. There are 67 ordered,
  forward-only SQL migrations and 50 pgTAP files.
- Files: MinIO with four private AgencyOS buckets: `private-file-quarantine`, `private-files`,
  `project-attachments`, and `document-templates`.
- Coordination/cache/rate limits: Redis 7.4 with AOF enabled in local Compose.
- Malware scanning: ClamAV 1.5; upload bytes remain in MinIO and are streamed to clamd over the
  private TCP protocol.
- PDF rendering: `@sparticuz/chromium` + `puppeteer-core`; Next output tracing explicitly includes
  Chromium assets for finance and MCP paths. The runtime installs the already-validated
  NSS/NSPR/Expat libraries.
- Vaultwarden: currently an external, independent web vault. AgencyOS stores UUID item references
  only and derives a URL from `VAULTWARDEN_URL`; no Vaultwarden service or data volume currently
  exists in this repository.
- Deployment target already documented: OCI image publication to GHCR and container execution, but
  current operational material is Podman-centric rather than a complete Coolify stack.

## Existing implementation that should be reused

### Database migrations and database validation

- `scripts/database/migrate.mjs`
  - Calls `bootstrapPortableCompatibility()` and `ensureAgencyMigrationHistory()`.
  - Acquires the session advisory lock
    `pg_advisory_lock(hashtextextended('agencyos:migrations', 0))`, so concurrent migration
    containers serialize.
  - Applies unapplied files in lexical/version order.
  - Rejects checksum drift for already-applied migrations.
  - Owns a transaction around new migrations so DDL and ledger insertion commit atomically.
  - Contains explicit recovery probes for two immutable historical self-transaction migrations and
    fails closed when they are partially applied.
  - Releases the advisory lock and closes its one-connection client in `finally`.
- `scripts/database/portable-database.mjs`
  - `getAdminDatabaseUrl()` requires `DATABASE_ADMIN_URL` for remote databases.
  - `assertDirectMigrationUrl()` rejects likely PgBouncer/pooler endpoints.
  - `createAdminClient()` bounds the migration connection to one connection.
  - `readMigrationFiles()` computes SHA-256 checksums.
  - `ensureAgencyMigrationHistory()` owns the provider-neutral ledger.
- `scripts/database/status.mjs` reports applied/local/pending/drift counts and exits nonzero on
  drift.
- `scripts/database/doctor.mjs` verifies identity tables, migration history, pgcrypto/pgTAP, removal
  of compatibility objects, and incomplete first-party credential cutover.
- `scripts/database/validate-migrations.mjs` statically validates migration syntax/invariants and
  blocks new self-managed transactions.
- `scripts/database/test-portable.mjs` executes every pgTAP file through the direct admin URL.
- Existing package commands `db:check`, `db:status`, `db:migrate`, `db:doctor`, and `db:test` should
  remain the authoritative gates. Do not introduce a second migration ledger or ORM migration path.

### Application health and operational checks

- `src/app/api/health/live/route.ts`: cheap, no-store process liveness response.
- `src/app/api/health/ready/route.ts`: returns 200/503 after validating production configuration
  and concurrently checking PostgreSQL, Redis, MinIO, and the scanner according to the runtime
  dependency policy.
- `src/app/api/health/status/route.ts`: bearer-protected dependency diagnostic using
  `INTERNAL_WORKER_SECRET`; returns no-store per-service status and latency.
- `src/lib/server/dependency-health.ts`: bounded three-second dependency checks that reuse the real
  database, Redis, MinIO, and scanner clients.
- `src/instrumentation.ts`: calls `validateProductionEnvironment()` during production Node startup
  and prevents an invalid process from accepting traffic.
- `scripts/operations/verify-deployment.mjs`: reusable post-deploy verification. It checks local
  migration validity, migration parity, database doctor, pgTAP, HTTPS/security headers, and
  unauthenticated authorization boundaries, then writes a mode-0600 hash-only evidence summary.
- `scripts/operations/verify-restore-drill.mjs`: reusable verification of an already-restored,
  explicitly isolated environment. It refuses `NODE_ENV=production`, requires named backup and
  target IDs, reuses deployment verification, then checks MinIO, ClamAV, and a worker cycle.
- `scripts/operations/operational-command.mjs`: safe no-shell subprocess wrapper with command and
  argument validation, timeouts, bounded diagnostics, output hashing, and private JSON writing.
  Backup/restore verification code should reuse these primitives where practical.

### Object storage, Redis, scanner, and Vaultwarden patterns

- `scripts/storage/setup-minio.mjs` idempotently creates all four private buckets and rejects an
  anonymous/public bucket policy. This is a good one-shot initialization container command.
- `scripts/storage/check-minio.mjs`, `scripts/check-redis.mjs`, and
  `scripts/scanner/check-clamav.mjs` are existing service smoke checks.
- `src/integrations/minio/object-storage.ts` owns canonical bucket names and endpoint parsing.
- `src/integrations/redis/client.ts` owns one bounded, prefixed Redis client and database-safe
  fallbacks where explicitly designed.
- `src/integrations/clamav/client.ts` owns bounded clamd streaming; no filesystem mount between app
  and ClamAV is needed.
- `src/modules/automation/server/integration-config.ts` validates the external Vaultwarden URL and
  `buildVaultwardenItemUrl()` builds `/#/vault?itemId=...` links without vault credentials.
- `database/migrations/20260714001900_n8n_callbacks_vaultwarden_links.sql` and
  `tests/unit/vaultwarden-links.test.ts` enforce that only non-secret UUID references are stored.
  A bundled Vaultwarden service must remain independently authenticated; the app must receive only
  its public HTTPS URL.

### Container, Compose, release, and supply-chain patterns

- `Containerfile` already provides a digest-pinned Node 22 multi-stage build and a read-only capable,
  non-root runtime.
- `Containerfile.postgres` extends digest-pinned PostgreSQL 17.10 with the matching pgTAP package.
- `.containerignore` excludes `.git`, GitHub metadata, builds, `.env*`, dependencies, tests output,
  logs, ZIPs, and deployment evidence for Podman builds.
- `compose.database.yaml`, `compose.redis.yaml`, `compose.minio.yaml`, and
  `compose.scanner.yaml` are useful local patterns for stable named volumes, health checks, and
  digest-pinned images.
- `compose.production.yaml` is a reusable stateless-tier baseline for the app, worker, and gateway:
  non-root application image, read-only filesystems, tmpfs, no-new-privileges, resource/PID limits,
  restart policy, graceful stop, health-aware ordering, and digest-required `AGENCYOS_IMAGE`.
- `deploy/nginx/agencyos.conf` is the trusted ingress configuration and should be mounted into the
  Coolify gateway, with Coolify routing only to gateway port 8080.
- `.github/workflows/release.yml` already:
  - runs only on explicit `workflow_dispatch` or pushed `v*` tags;
  - uses a protected `release` environment and serialized concurrency;
  - runs release verification;
  - builds once with Podman;
  - pushes `ghcr.io/<repository>:sha-<commit>`;
  - captures the registry digest and constructs an immutable `name@sha256:...` reference;
  - produces SPDX SBOM and GitHub provenance attestations using commit-pinned actions.
- `scripts/security/verify-supply-chain.mjs` validates pinned GitHub actions/base images, the exact
  Node floor, digest-required production image, resource controls, SBOM, and provenance controls.
- `.github/workflows/react-doctor.yml` is the ordinary PR verification workflow and does not deploy.
  It also demonstrates disposable PostgreSQL/Redis startup, migration, pgTAP, seeding, and browser
  testing.

### Documentation and tests to extend rather than replace

- `docs/OPERATIONS.md` already describes runtime topology, migration/health commands, deployment
  verification, and safe isolated recovery order.
- `deploy/README.md` already explains immutable images and pre-deploy migration gates, though it is
  Podman/manual rather than Coolify-specific.
- `docs/ARCHITECTURE.md` and `docs/SECURITY.md` define the authoritative trust boundaries.
- Existing infrastructure contracts are concentrated in:
  - `tests/unit/hardening-20260822-contract.test.ts`
  - `tests/unit/release-remediation-contract.test.ts`
  - `tests/unit/operational-readiness.test.ts`
  - `tests/unit/operational-readiness-contract.test.ts`
  - `tests/unit/env-validation.test.ts`
  - `tests/unit/minio-runtime-contract.test.ts`
  - `tests/unit/private-file-worker-contract.test.ts`
  - `tests/unit/security-control-closure-contract.test.ts`
  - `tests/unit/database-portability-contract.test.ts`

## Gaps against the requested deployment contract

### 1. There is no complete Coolify Compose stack

`compose.production.yaml` contains only `app`, `worker`, and `gateway`. PostgreSQL, Redis, MinIO,
ClamAV, and Vaultwarden are separate or absent. There is no migration job, MinIO bootstrap job,
backup job, backup status, shared private network definition, complete dependency ordering, or
stable Vaultwarden/backup volume. A fresh Coolify resource therefore cannot create the requested
whole system from one repository Compose definition.

The current production Compose also uses `env_file: ${AGENCYOS_ENV_FILE:-.env.production}`. No such
file is present (correctly, because secrets must not be shipped), and Coolify-managed environment
values should be injected directly. A Coolify definition should not require a repository or host
`.env.production` file.

The gateway maps `127.0.0.1:8080:8080`. That is appropriate for direct host-managed Podman but not
the normal Coolify proxy path. Coolify should route to an exposed gateway container port on its
network; stateful service ports must remain unexposed publicly.

### 2. Current production TLS validation conflicts with an internal all-in-one stack

`validateProductionEnvironment()` requires `rediss://` whenever Redis is required and `https://`
whenever MinIO is required. The current local service definitions expose plaintext Redis and HTTP
MinIO. Using private Compose URLs such as `redis://redis:6379/0` and `http://minio:9000` will make
production startup and `/api/health/ready` fail even though those ports are isolated on a private
Docker network.

This must be deliberately reconciled. Viable choices are:

1. configure Redis TLS and MinIO TLS inside the Compose stack, including durable certificate/key
   provisioning and hostname verification; or
2. narrowly update validation so explicitly recognized internal Compose service connections are
   permitted only under an opt-in private-network policy, while still requiring authentication,
   keeping ports unexposed, and preserving TLS requirements for remote endpoints.

Do not set `REDIS_REQUIRED=0` or `MINIO_REQUIRED=0` merely to bypass readiness. The current Redis
Compose also has no password, so authentication must be added whichever TLS policy is chosen.

### 3. The application runtime image cannot currently serve as a migration/init image

The final `Containerfile` stage copies only the standalone server, public/static assets, and
`scripts/workers/`. It does **not** contain `database/migrations`, database scripts, storage scripts,
`package.json`, the full required Node modules for those scripts, `psql`, `pg_dump`, or `pg_restore`.
Therefore `command: node scripts/database/migrate.mjs` cannot run from the existing published
runtime image.

Add a dedicated image stage/target for operations or an independently built operations image that
contains the exact released migrations and scripts. Keep app and worker on the minimal runtime.
The migration container should run status/migrate/doctor, use the existing advisory lock, exit
nonzero on failure, and gate app/worker startup through `service_completed_successfully`. MinIO
setup likewise needs its script and dependencies in an init-capable image.

Compose startup dependency conditions protect a first `docker compose up`, but Coolify's precise
reconciliation behavior for one-shot completed services must be tested. A release must not rely on
the migration container remaining permanently completed if Coolify does not recreate it after an
image change.

### 4. The release workflow publishes but does not deploy

The workflow ends after generating `release-manifest.json`. It does not:

- call a Coolify deploy webhook or API;
- convey the newly produced immutable digest to the existing Coolify resource;
- wait for Coolify completion;
- query `/api/health/ready` or run deployed verification after rollout;
- upload the release manifest/SBOM as a workflow artifact; or
- expose a simple documented explicit release command beyond manually pushing a tag/running the
  workflow.

A webhook call alone is insufficient if Coolify's `AGENCYOS_IMAGE` environment value still points
at the prior digest. The deployment architecture must define how the exact digest is atomically
selected (for example, a supported Coolify API/environment update followed by deployment, or a
commit/tag-specific mechanism that does not use a mutable production image tag). Do not silently
replace the immutable digest contract with `latest` or a mutable `production` tag.

The current release workflow verifies an already-current isolated database and runs pgTAP/E2E; it
does not apply migrations to the production target. Production migration belongs inside the
deployment stack/gate, not in GitHub Actions against an exposed production database.

### 5. Stateful services are not production-ready as currently defined

- PostgreSQL: stable volume exists locally, but the Coolify stack is absent. The custom pgTAP image
  currently needs a build; if Docker/Coolify builds it, a safe `.dockerignore` is needed because the
  existing `.dockerignore` is deleted and Docker does not use `.containerignore` by default.
- Redis: stable AOF volume exists locally but there is no password, ACL, or TLS; health check does
  not authenticate.
- MinIO: stable volume and liveness check exist locally, but the application uses root credentials,
  no bootstrap service is wired into production, and no internal/external TLS plan exists.
- ClamAV: signature volume exists, but the local Compose has no health check or resource bounds.
  Startup can take substantial time while signatures initialize; app readiness should be the final
  gate and Compose ordering should not race it.
- Vaultwarden: no service, version/digest pin, `/data` volume, health check, public URL routing, or
  signup/admin policy. AgencyOS itself must continue storing references only.
- Data volumes in the current dependency manifests have explicit engine-level names, but a new
  single Coolify stack must choose stable volume names once and document never renaming/deleting
  them or using `down -v`.

### 6. No executable automated backup system exists

Current documentation is a manual recommendation only (`pg_dump` plus an encrypted MinIO mirror).
There are no restic/rclone dependencies, backup scripts, timers, B2 environment variables,
repository initialization, retention job, check job, status/heartbeat output, failure exit contract,
or restore commands.

The implementation needs to produce a consistent local staging set before invoking restic:

- PostgreSQL: `pg_dump --format=custom --no-owner` over the direct local connection, never a live
  data-directory copy.
- MinIO: copy/mirror every private bucket or snapshot its data through a supported consistent
  method; preserve object names/metadata and verify inventory/checksums.
- Vaultwarden: do not blindly copy a live SQLite database. Use SQLite's online backup mechanism (or
  configure a dedicated PostgreSQL database and dump it separately), then include attachments,
  sends, keys/configuration, and other durable `/data` content.
- Configuration: back up a credential-free manifest/inventory. Stable secrets and the restic
  password need an independent recovery channel and must not be stored plaintext inside the same
  repository they unlock.

Restic provides content-addressed encrypted deduplication and complete snapshots, and
`--skip-if-unchanged` can suppress unchanged snapshots. A local persistent cache/state volume can
avoid re-downloading indexes. Daily/weekly/monthly selection should use `restic forget`, and a
periodic `restic check` plus real restore drill must be documented.

### 7. Backblaze B2 Object Lock needs an explicit compatibility design

Do not naively enable bucket-wide Compliance retention and assume ordinary restic prune/lock
operations will work. Restic creates and removes repository lock objects and retention/prune deletes
old snapshots/packs. Provider-side retention can reject those deletions and turn an otherwise
successful backup into a nonzero job or leave stale locks.

The backup design should document and test the chosen combination of:

- serialized single-writer backups (for example host/container `flock`);
- restic lock behavior;
- a least-privilege backup credential without destructive permissions;
- a separately protected maintenance credential for retention/pruning;
- Object Lock duration versus the snapshot retention window; and
- expected handling of still-locked objects during pruning.

Object Lock must be enabled on the B2 bucket before protected objects are uploaded and cannot be
silently configured by the repository without the owner's B2 credentials/confirmation. The
runbook must state that provider configuration is a one-time operator action and include a safe
verification step. Existing snapshots should never be rewritten merely because a new snapshot is
created; integrity must be proven through `restic check` and isolated test restores.

### 8. Backup visibility/health is absent

Application status currently covers PostgreSQL, Redis, MinIO, and scanner only. There is no backup
status file, last-success timestamp, snapshot ID, check timestamp, or bounded endpoint/command.
At minimum, the backup container must exit nonzero on a failed dump/upload/forget/check, emit
structured logs without secrets, persist a small status record in a stable backup-state volume, and
provide a documented command or container health check that becomes unhealthy when the last
successful daily backup is stale. An external alert/monitor is still needed because a failed
container on the same dead VPS cannot alert by itself.

### 9. Environment and first-run contract is incomplete

`.env.example` has local values only and no Coolify/B2/restic/Vaultwarden/backup variables. The
complete production variable inventory must distinguish:

- Coolify runtime variables (stable database, Redis, MinIO, application, Vaultwarden, and backup
  secrets);
- GitHub release secrets (`COOLIFY_DEPLOY_WEBHOOK`/token or supported API equivalents);
- GHCR authentication for a private package;
- Backblaze endpoint/bucket/key ID/application key and restic password;
- generated-once application encryption/worker secrets; and
- external URLs that cannot be invented (`APP_URL`, audit alert URL, Vaultwarden URL/domain).

Production startup also requires a valid external HTTPS audit-pipeline alert webhook pair. The
first-deploy runbook must surface this rather than letting an operator discover it through a failed
readiness probe.

### 10. Resource sizing and single-VPS behavior need to be explicit

Existing app and worker defaults each allow 2 GiB and 2 CPUs; gateway allows 256 MiB. The current
dependency manifests have no production memory bounds. A complete stack also adds PostgreSQL,
Redis, MinIO, ClamAV, Vaultwarden, an operations/migration container, and a potentially bursty
backup job. This matches the earlier minimum recommendation of 4 vCPU/8 GiB/80 GiB NVMe only for
light usage when images build off-host; 16 GiB is safer during ClamAV reloads, PDF generation,
backups, and deploy overlap. Coolify itself also consumes host resources.

Avoid starting backup, ClamAV refresh, a migration, and old/new app containers simultaneously where
possible. Do not place authoritative backups only on the same VPS. Named Docker volumes survive
ordinary image replacement but are not backups.

## Compatibility and security constraints

1. Preserve Node `22.23.2`; prior PDF failures occurred under unsupported Node 24. The exact
   released image must pass the Chromium smoke path.
2. Preserve the non-root, read-only app/worker filesystem and `/tmp` tmpfs large enough for
   Chromium. Do not run the web container as root to simplify volume access.
3. Never publish PostgreSQL 5432, Redis 6379, MinIO 9000/9001, ClamAV 3310, or the backup service to
   the public host. Only Coolify's proxy-facing gateway and the intended Vaultwarden web endpoint
   should be routable.
4. Preserve the Nginx trusted-header behavior. Do not use attacker-controlled
   `$proxy_add_x_forwarded_for` without an explicit trusted proxy chain.
5. Never commit `.env*`, B2 credentials, GHCR tokens, Coolify tokens/webhooks, restic passwords,
   database URLs, Vaultwarden admin tokens, encryption keys, or actual backup contents.
6. Secrets interpolated into Compose commands can appear in container inspection/process metadata.
   Prefer service configuration files/secrets or carefully documented Coolify secret variables;
   never echo credentials in scripts or health checks.
7. Database migrations require an administrative direct URL, but the normal app and worker should
   retain their bounded runtime URL/pool. Do not grant migration privileges to the browser or
   expose the admin URL via `NEXT_PUBLIC_*`.
8. `NEXT_PUBLIC_APP_URL` is referenced by the auth proxy but has a request-origin fallback;
   `APP_URL` is the canonical server runtime URL. Keep both consistent with the public HTTPS origin
   to avoid OAuth/origin failures.
9. Vaultwarden should have independent accounts/sessions. AgencyOS must never receive the vault
   master password, decrypted items, admin token, or backup decryption secret.
10. Restores must default to a new explicit recovery destination. Production overwrite must require
    an exact, separately confirmed target; continue reusing the current restore verifier's
    `AGENCYOS_RESTORE_DRILL=1` and non-production checks.
11. A single-host deployment cannot guarantee zero downtime or survive VPS loss. The requested
    architecture can provide deterministic rollback of app images and off-site data recovery, not
    automatic high availability.
12. Rollback of app code after a forward migration remains subject to expand/contract schema
    compatibility. An immutable prior image is not by itself a safe database rollback.

## Likely implementation impact map

### New files (preferred additive surface)

- `compose.coolify.yaml`: one complete production stack with app, worker, migration/init jobs,
  gateway, PostgreSQL, Redis, MinIO, MinIO bootstrap, ClamAV, Vaultwarden, and backup service;
  private networks, stable named volumes, health/resource/security controls, and Coolify routing
  metadata or documented UI routing.
- `Containerfile.operations` or additional `operations`/`migration` targets in `Containerfile`:
  released database/storage/backup tooling without bloating the web runtime.
- `Containerfile.backup` if backup utilities are isolated from migration utilities.
- `scripts/backup/run-backup.sh` (or a Node orchestration script plus no-shell utility calls):
  serialized PostgreSQL/Vaultwarden staging, MinIO capture, restic snapshot, retention, checks,
  status, cleanup, and fail-closed exit codes.
- `scripts/backup/health.*`: bounded last-success/status validation.
- `scripts/backup/restore-*`: safe explicit extraction and component restore commands that default to
  recovery locations and never silently overwrite production.
- `.github/workflows/deploy-production.yml` or a careful extension of `release.yml`: digest handoff,
  Coolify trigger/API call, rollout wait, and post-deploy verification.
- `docs/COOLIFY.md` and/or `docs/BACKUP_RECOVERY.md`: non-specialist one-time setup, routine release,
  B2/Object Lock, verification, and restore drill.
- Focused deployment/backup contract and unit tests, ideally
  `tests/unit/coolify-deployment-contract.test.ts` and
  `tests/unit/backup-operations-contract.test.ts`.

### Existing files likely to change narrowly

- `.env.example`: add complete placeholder-only production/Coolify/Vaultwarden/B2/restic/backup
  inventory and stable volume names.
- `.gitignore`, `.containerignore`, and restored `.dockerignore`: exclude backup staging/status,
  restore output, release manifests, credentials, and build context secrets.
- `Containerfile`: expose an operations target or copy only additional release tooling needed by
  init jobs; preserve the minimal runtime target and Chromium libraries.
- `.github/workflows/release.yml`: preserve explicit triggers, existing verification, immutable
  build, SBOM, and attestations; add supported digest handoff and fail-closed deployment verification.
- `package.json`: add explicit operator commands for Compose validation, release dispatch/tagging,
  backup now/status/check, and safe restore preparation while preserving all existing commands.
- `scripts/security/verify-supply-chain.mjs`: include every new production/base image and deployment
  action in immutable-pin validation.
- `src/lib/validation/env.ts` plus `tests/unit/env-validation.test.ts` only if the private-network
  Redis/MinIO policy is deliberately changed; keep remote production TLS fail-closed.
- `docs/OPERATIONS.md`, `deploy/README.md`, `README.md`, `TEST.md`, and possibly
  `docs/ARCHITECTURE.md`/`docs/SECURITY.md`: align the authoritative operational and security
  documentation.
- Existing hardening/release/readiness tests listed above: extend expectations without weakening
  local Podman contracts.
- `scripts/archive-source.mjs`: either make it explicitly support a reviewed current-tree archive
  safely or avoid it for this delivery. Its current tracked-HEAD-only behavior must not silently
  produce an incomplete ZIP.

### Files that should not need business-feature changes

No database schema migration or public application API change is required for this infrastructure
feature. The existing health routes, database runner, worker registry, business modules, UI, and
Vaultwarden-link data model should be reused as-is unless a narrowly tested backup-status endpoint
is intentionally added. Application feature files already modified by the user must not be
reformatted or rewritten as collateral infrastructure work.

## Recommended implementation sequence

1. Decide and document the private internal Redis/MinIO transport/authentication policy.
2. Create a dedicated operations/backup image with exact released migrations and pinned utilities.
3. Add the complete Coolify Compose stack using stable volumes, private networking, authenticated
   services, health checks, migration/init completion gates, and gateway-only app ingress.
4. Add deterministic B2/restic backup, status, retention, integrity, and safe restore scripts; test
   Object Lock behavior rather than assuming it.
5. Extend the explicit release workflow to transmit the exact digest, trigger Coolify, and verify
   the deployed release.
6. Add focused contract/unit tests and Compose config validation, then run the existing full gates.
7. Update operator documentation and package the current working tree with secret-safe exclusions.

## Bottom line

The application already has strong reusable building blocks for production operation: serialized
checksum-verified migrations, dependency-aware readiness, protected diagnostics, immutable image
publication, digest/action pins, supply-chain attestations, and isolated restore verification. The
missing work is primarily deployment orchestration and backup execution. The highest-risk design
points are the internal Redis/MinIO TLS contradiction, immutable-digest handoff to Coolify, migration
tooling absent from the runtime image, consistent live Vaultwarden backup, and the interaction
between restic repository locks/pruning and B2 Compliance-mode Object Lock.
