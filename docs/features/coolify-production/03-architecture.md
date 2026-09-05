# Architecture: production Coolify deployment and immutable backups

> Historical design. The final review supersedes the direct B2 no-lock writer and remote prune
> proposal. See docs/BACKUP_RECOVERY.md and 05-quality.md for the corrected local-restic plus
> immutable B2 mirror design, resource sizing and remaining external validation gates.

## Decision summary

Implement one repository-managed `compose.coolify.yaml` containing the complete application and
its dependencies. Coolify owns the Compose resource, public TLS, stable environment values, and
GHCR pull credential. Only an explicit GitHub release workflow may select new production images.
The workflow publishes separate app and operations images by immutable digest, updates both
Coolify environment values, verifies the read-back, starts one deployment, polls it, and then
checks the public live/ready endpoints.

All authoritative data stays in explicitly named Docker volumes. A release init job is recreated
for every operations-image digest and gates replacement of the web and worker. It bootstraps
MinIO/Vaultwarden prerequisites and runs the existing serialized, checksum-verified migrations.
A separate pre-migration backup job must succeed before a non-empty production database is
migrated. A long-running scheduler performs daily backups to a private B2 restic repository.

Use authenticated plaintext Redis and MinIO only on a Compose network declared `internal: true`.
This is an explicit single-host exception to the normal production TLS rule: Docker never
publishes these ports, Redis requires a long password, MinIO gives the app a non-root key, and the
validator accepts only the exact `redis:6379` and `minio:9000` service names when
`AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK=1`. Remote Redis/MinIO endpoints still require TLS. On one
host, internal TLS would add a private-CA/certificate rotation system without defending against
host root, which can already inspect container secrets and memory.

Bundle Vaultwarden with its own PostgreSQL database and login in the same PostgreSQL cluster.
PostgreSQL provides a safe online dump; its `/data` volume remains necessary for attachments,
sends, keys, and configuration. SQLite is not used, avoiding unsafe live file copies. AgencyOS
receives only `VAULTWARDEN_URL`, never a vault password, admin token, or database credential.

This is a durable single-node design, not high availability. A normal release may have a short
connection interruption when the one web container is replaced. VPS loss is recovered from B2;
it is not failed over automatically.

## Exact file plan

### Add

- `compose.coolify.yaml` — complete Coolify topology, health/order contracts, private networks,
  stable named volumes, security/resource limits, and no host-published stateful ports.
- `Containerfile.operations` — Node 22 operations image containing the released migration,
  database/storage/backup scripts, production Node dependencies, PostgreSQL 17 client, restic,
  and MinIO client. Every base/tool version and downloaded artifact checksum must be pinned.
- `.dockerignore` — Docker equivalent of `.containerignore`; exclude `.git`, `.env*`, credentials,
  backup/restore output, dependencies, test output, ZIPs, and workflow evidence.
- `scripts/operations/bootstrap-production.mjs` — idempotently create/check the Vaultwarden
  database/login and MinIO app/backup identities and private buckets. It must not print secrets.
- `scripts/operations/release-gate.mjs` — run static migration validation, existing migration,
  status, and doctor commands in order; write a small release status file atomically; fail nonzero.
- `scripts/backup/config.mjs` and `scripts/backup/process.mjs` — strict environment parsing,
  redaction, no-shell child processes, timeouts, and atomic private status files.
- `scripts/backup/run-backup.mjs` — serialize writers, make database-aware dumps, stage MinIO and
  Vaultwarden files, create/verify a restic snapshot, clean staging, update status, and alert.
- `scripts/backup/scheduler.mjs` — PID 1 daily UTC scheduler with graceful shutdown, jitter, and
  missed-run recovery; no Docker socket or host cron dependency.
- `scripts/backup/run-maintenance.mjs` — separately credentialed retention/check/prune job.
- `scripts/backup/health.mjs` — validate last success age and last integrity-check state without
  contacting B2 on every container health probe.
- `scripts/backup/restore-prepare.mjs` and `scripts/backup/restore-components.mjs` — restore to an
  empty named recovery directory and explicit recovery services only; production overwrite is not
  a default code path.
- `scripts/release/production-release.mjs` — local clean-tree/tag helper for the documented
  explicit release command; it never deploys an uncommitted working tree.
- `docs/COOLIFY.md` — one-time Coolify/GHCR/domain/environment setup, first boot, routine release,
  status, rollback, upgrades, and resource guidance.
- `docs/BACKUP_RECOVERY.md` — B2/Object Lock setup and preflight, retention, alerts, restore, and
  recovery-drill runbook.
- `tests/unit/coolify-deployment-contract.test.ts` and
  `tests/unit/backup-operations-contract.test.ts` — focused static and behavior contracts.

### Modify narrowly

- `Containerfile` — retain the current minimal non-root runtime; add revision/source OCI labels
  through build arguments if needed. Do not put backup clients in the web image.
- `.github/workflows/release.yml` — retain explicit triggers, Node 22 verification, SBOM and
  attestations; build/publish app and operations digests, hand both to Coolify, poll, verify, and
  upload the manifest/SBOM as artifacts.
- `.env.example` — add placeholder-only Coolify, stable-volume, private-network, Vaultwarden,
  B2/restic, scheduling, retention, status, and alert variables. Document URL-safe secret values.
- `.gitignore` and `.containerignore` — exclude local backup stage/status, recovery output,
  credentials, release response files, and final ZIPs.
- `src/lib/validation/env.ts` and `tests/unit/env-validation.test.ts` — add the exact-host
  single-node private transport exception; preserve fail-closed remote TLS validation.
- `package.json` — add Compose validation, explicit release, backup now/status/check, and safe
  recovery commands. Do not change the application version as part of ordinary deployments.
- `scripts/security/verify-supply-chain.mjs` — validate every new base/action pin and both
  production image variables as `name@sha256:...`.
- `scripts/archive-source.mjs` — add a reviewed current-tree mode or leave it unused for delivery;
  it must never silently omit uncommitted work.
- `README.md`, `deploy/README.md`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
  and `TEST.md` — point to the new authoritative runbooks and record the remaining production
  verification gates.

No business module, public API, or database migration is required.

## Coolify Compose topology

Use Compose-spec health-aware `depends_on`; require a current Coolify/Docker Compose release that
supports `condition: service_completed_successfully`. Do not set `container_name` and do not mount
the Docker socket.

| Service              | Image/command                                     | Networks                         | Persistence              | Start gate                                                       |
| -------------------- | ------------------------------------------------- | -------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `postgres`           | digest-pinned `Containerfile.postgres` build      | private                          | `postgres-data`          | own health                                                       |
| `redis`              | digest-pinned Redis 7.4, AOF, password            | private                          | `redis-data`             | own authenticated health                                         |
| `minio`              | digest-pinned MinIO                               | private                          | `minio-data`             | own ready health                                                 |
| `clamav`             | digest-pinned ClamAV                              | private                          | `clamav-signatures`      | clamd ping health                                                |
| `bootstrap`          | `${AGENCYOS_OPERATIONS_IMAGE}`                    | private                          | none                     | PostgreSQL + MinIO healthy                                       |
| `vaultwarden`        | digest-pinned official image, PostgreSQL URL      | private + egress + Coolify proxy | `vaultwarden-data`       | bootstrap completed                                              |
| `predeploy-backup`   | operations image, `run-backup --reason=predeploy` | private + egress                 | backup state/cache/stage | bootstrap + Vaultwarden healthy                                  |
| `migrate`            | operations image, `release-gate`                  | private                          | release status           | predeploy backup completed                                       |
| `app`                | `${AGENCYOS_IMAGE}`, `node server.js`             | private + egress                 | none                     | migrate + bootstrap completed; all required dependencies healthy |
| `worker`             | same app digest, existing worker                  | private + egress                 | none                     | app healthy                                                      |
| `gateway`            | existing digest-pinned Nginx                      | private + Coolify proxy          | none                     | app healthy                                                      |
| `backup`             | operations image, daily scheduler                 | private + egress                 | backup state/cache/stage | bootstrap + Vaultwarden healthy                                  |
| `backup-maintenance` | operations image, maintenance scheduler           | private + egress                 | backup state/cache       | repository initialized                                           |

The `private` bridge is explicitly `internal: true`. Only `app`, `worker`, Vaultwarden, and backup
jobs receive a separate outbound-only bridge. Stateful dependencies are not attached to that
bridge. Coolify attaches `gateway:8080` and `vaultwarden:80` to its instance-specific proxy
network when their two HTTPS domains are assigned in the dashboard; do not hardcode Coolify's
proxy-network name. No Compose `ports` entry is permitted for PostgreSQL 5432, Redis 6379, MinIO
9000/9001, ClamAV 3310, or backup services. MinIO's admin console is not public by default.

The stable volume names are `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-postgres-v1`,
`-redis-v1`, `-minio-v1`, `-clamav-signatures-v1`, `-vaultwarden-v1`, `-backup-state-v1`,
`-restic-cache-v1`, and `-backup-stage-v1`. Set the prefix once. Changing it, deleting the Coolify
resource with storage, or using `docker compose down -v` creates data loss/new empty state and must
be called out prominently.

Coolify stores required secret values; Compose uses `${NAME:?message}` so first boot fails before
containers start when a required value is absent. Generate URL-safe hex/base64url secrets so URLs
do not break Compose/URI parsing. Only the services that need a credential receive it. App and
worker do not receive PostgreSQL control, MinIO root, B2, restic, Vaultwarden database, or
Vaultwarden admin credentials. Until a separately tested database-role migration is designed,
AgencyOS retains its current server-only database owner connection; placing an untested restricted
role behind the existing RLS-era migrations would break runtime semantics. This residual privilege
is contained to the app/worker and private network and must remain a tracked hardening item.

Redis starts via a small checked-in entrypoint that writes a mode-0600 config in tmpfs from
`REDIS_PASSWORD`; the secret must not appear as a literal Compose command argument. Health uses
`REDISCLI_AUTH`. MinIO root credentials are limited to MinIO/bootstrap/backup; bootstrap creates a
separate app key and bucket-scoped policy. ClamAV has no authentication protocol, so it is usable
only at exact hostname `clamav` on the internal network.

Production validation accepts plaintext internal services only when all of these hold:

- `AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK=1`;
- Redis is exactly `redis://default:<32+ character password>@redis:6379/0`;
- MinIO is exactly `http://minio:9000`, with distinct non-root app credentials;
- the scanner is exactly `clamav://clamav:3310`; and
- production still sets all three dependency-required flags to true.

Anything else continues to require `rediss://`, HTTPS MinIO, and the existing scanner validation.

## First boot and repeat deployments

On first boot PostgreSQL initializes the AgencyOS database and stable volume. `bootstrap` then
idempotently creates the separate Vaultwarden database/login, verifies rather than silently
rotates an existing login, creates all four private MinIO buckets, enables versioning where
supported, installs a bucket-scoped app policy, and rejects anonymous policies. Vaultwarden starts,
performs its own PostgreSQL migrations, and becomes healthy. The predeploy job initializes/restores
the restic repository contract and captures the empty/initial state. `migrate` then reuses
`migrate.mjs`'s advisory lock and checksum ledger, followed by `db:status` and `db:doctor`. App,
worker, and gateway start only after successful completion.

Every operations image contains the release commit OCI label, so its digest changes for every
release and Coolify recreates the completed bootstrap/prebackup/migration jobs. Bootstrap remains
idempotent. The predeploy snapshot is mandatory by default. A migration failure leaves the job
nonzero and prevents new app/worker replacement; it is never converted to a warning. Ordinary
Compose reconciliation keeps named volumes and Coolify environment values unchanged.

Do not run pgTAP against production during the deployment. Static validation, migration status,
and doctor are the production gate; full pgTAP/PDF/E2E gates run against the isolated release
target before image publication. Migrations must use expand/contract compatibility so the old app
can keep serving while the gate runs and a prior app image can operate after additive migrations.

## Immutable release and Coolify handoff

Normal branch pushes run checks only. Production occurs from a protected `release` environment by
either a pushed signed/annotated `v*` tag or a manual workflow dispatch requiring the literal
confirmation `DEPLOY`. The local `npm run release:production -- vX.Y.Z` helper refuses a dirty tree,
verifies the tag points at `HEAD`, and pushes only that tag. It never changes all package versions.

The release job:

1. Runs the existing Node 22 security, full test, migration, Chromium PDF, and isolated E2E gates.
2. Builds app `runtime` and operations images once, embeds `GITHUB_SHA`, pushes commit tags, records
   both registry digests, and validates each as `ghcr.io/...@sha256:<64 hex>`.
3. Produces SBOM/provenance attestations for both and a manifest containing commit, source tag,
   two immutable references, migration-set hash, and verification result.
4. Calls Coolify's authenticated API using `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`, and
   `COOLIFY_APPLICATION_UUID`. It PATCHes
   `/api/v1/applications/{uuid}/envs` for `AGENCYOS_IMAGE` and `AGENCYOS_OPERATIONS_IMAGE` with
   `{key,value,is_preview:false,is_literal:true}`, then reads back both values. No deployment is
   requested until both exact digests match. Sequential environment updates are not atomic, but
   they cannot change running containers; a partial update stops the workflow and a retry rewrites
   both. Operators must not click redeploy during this short handoff.
5. POSTs `/api/v1/deploy` with `{uuid}`, captures `deployment_uuid`, and polls
   `/api/v1/deployments/{deployment_uuid}` to a bounded success/failure terminal state. The
   implementation must fixture-test the response shapes against the installed Coolify API version
   before first production use; endpoint URLs are current API assumptions, not a reason to fall
   back to mutable tags.
6. Retries public HTTPS `/api/health/live` and `/api/health/ready`, verifies expected security
   headers through the gateway, and confirms deployment metadata refers to both selected digests.
   A failed migration, Coolify status, digest check, or ready probe fails the release.
7. Uploads the manifest, digest files, SBOM, and redacted deployment evidence as GitHub artifacts.

Coolify needs a read-only GHCR credential for a private package. GitHub needs only the scoped
Coolify API token; production database/B2 credentials remain in Coolify and are never exposed to
GitHub Actions.

Rollback is an explicit workflow that selects a prior manifest's two digests and repeats the same
handoff/gates. It never reverses SQL automatically. Code rollback is allowed only when migrations
are expand/contract compatible. Otherwise restore into an isolated recovery stack, validate, and
perform a deliberate cutover. Do not assume Coolify's UI rollback changes digest-valued environment
variables correctly.

## Backup design

The backup source set is:

- `pg_dump --format=custom --compress=0 --no-owner --no-acl` of AgencyOS through the direct admin
  connection;
- a separate custom dump of the PostgreSQL-backed Vaultwarden database;
- all AgencyOS MinIO buckets copied through the S3 API to a fresh run-specific staging directory,
  plus a sorted object inventory (bucket/key/version or ETag/size);
- Vaultwarden `/data` (attachments, sends, keys, configuration), mounted read-only in the backup
  service; and
- a credential-free manifest containing release digest, migration status hash, tool versions,
  inventories, and dump hashes.

Never copy PostgreSQL's live data directory or a live SQLite file. S3 object writes are atomic, but
the DB dump and multi-object copy are not one cross-system transaction. The manifest records both
snapshot boundaries. Exact cross-store point-in-time consistency would require application
maintenance mode and is not claimed. Restores are checked for referential completeness before
cutover. Restic handles compression/encryption/deduplication, so do not gzip dumps first.

`run-backup` takes an exclusive `flock` on the persistent state volume, creates an empty private
run directory, performs all captures, runs `restic backup --skip-if-unchanged` with host/tags, asks
restic for the resulting snapshot, performs a bounded metadata read, atomically updates status,
and removes staging in `finally`. Failed capture/upload/verification leaves the previous success
record intact, records a redacted failure separately, alerts, and exits nonzero. Restic avoids
re-uploading unchanged chunks; a PostgreSQL dump header or changed rows may still create small new
chunks/snapshot metadata, so “zero storage when nothing changed” is not promised.

The scheduler runs once daily at a configurable UTC hour with jitter and immediately performs a
missed backup when no successful snapshot exists or the last one is stale. It traps TERM and never
starts a second writer. Health becomes unhealthy after 30 hours without success. Status JSON is
mode 0600 and contains timestamps, snapshot ID, source inventory counts/hashes, release ID,
duration, last repository check, and redacted failure class. A success-only external dead-man
heartbeat is required because a dead VPS cannot send its own failure alert; an optional signed
failure webhook gives immediate diagnostics while the host is alive.

The restic URL is `s3:${B2_ENDPOINT}/${B2_BUCKET}/${B2_PREFIX}`. The repository password is a
random, independently escrowed secret and is never stored inside its repository or the source ZIP.
The daily writer B2 application key is restricted to the one bucket/prefix and list/read/write;
it has no delete permission. The maintenance service alone receives a separate bucket-restricted
delete-capable key and the restic password. Neither credential reaches app/worker. Coolify's own
database/configuration and especially its `APP_KEY` are backed up using Coolify's native instance
backup to a separate prefix; `APP_KEY` and the restic password also need an offline password-manager
copy.

### B2 Object Lock compatibility

Object Lock must be enabled before the first protected upload. Backblaze's default Compliance
retention cannot be shortened, disabled, bypassed, or deleted before expiry. Naively locking a
normal restic repository also locks restic's short-lived lock objects and causes every backup to
fail while removing its lock. Therefore:

- use a single serialized repository writer and pass restic's explicit no-lock mode for all
  automated repository commands; repository access outside these scripts is prohibited;
- require a clean repository with no stale restic locks before enabling Compliance retention;
- set B2 default Compliance retention to 30 days;
- retain at least 35 daily, 8 weekly, and 12 monthly snapshots, so `forget` never intentionally
  removes a snapshot before provider retention expires;
- do not run naive daily `forget --prune`; run `forget` monthly and a separately serialized,
  bounded prune only after eligible data is older than the lock window;
- treat “object still retained” deletes as a maintenance failure, never as successful pruning;
  leave data intact, alert, and retry after expiry; and
- run a disposable B2 bucket preflight proving init, two backups, no-lock reads, attempted protected
  deletion, retention expiry behavior, forget/prune, check, and isolated restore with the exact
  pinned restic/B2 versions before production is approved.

This preserves 30-day ransomware resistance while allowing eventual garbage collection. Object
Lock can temporarily increase storage because expired snapshots and unreferenced packs cannot be
removed early. Deduplication prevents unchanged source chunks from being duplicated, but no honest
architecture can guarantee that storage never grows. If the provider/version preflight fails,
deployment stops with backups unhealthy; it must not silently disable immutability or substitute a
mutable `latest` repository.

Run a metadata/subset `restic check` weekly and a full read-data subset monthly; run a complete
isolated restore quarterly. Maintenance and backup status are separate so a successful new
snapshot cannot conceal a failed integrity/prune job.

## Restore workflow

Every restore command requires `AGENCYOS_RESTORE_DRILL=1`, `NODE_ENV!=production`, a snapshot ID,
a human-readable recovery ID, and an empty destination under a dedicated recovery volume. It
refuses the production database hostname/database name and production MinIO alias. `restore-prepare`
uses read-only B2 credentials to extract the selected snapshot, verifies hashes/inventories and
dump readability, and makes no service writes.

Component restore then creates new recovery PostgreSQL databases, uses `pg_restore --exit-on-error`
into those empty databases, mirrors MinIO objects into new recovery buckets without `--remove`,
and restores Vaultwarden files while the recovery Vaultwarden container is stopped. Run the
existing `verify-restore-drill.mjs`, database doctor/pgTAP, MinIO checks, ClamAV scan, Vaultwarden
login/attachment checks, worker cycle, and representative PDF generation. Only after an operator
records those results may DNS/domain traffic be deliberately cut over. Production overwrite is a
separate documented disaster procedure, never a flag casually accepted by the script.

Recovery order after VPS loss is: recover Coolify `APP_KEY` and control-plane backup; create an
isolated stack; restore PostgreSQL, MinIO, and Vaultwarden; select the release manifest's immutable
images; validate; then switch domains. Secret rotation after recovery is explicit and must not make
old encrypted AgencyOS fields or restic snapshots unreadable.

## Resources for the 4 vCPU / 8 GiB floor

Build both release images in GitHub, never on this VPS. Use approximately these hard ceilings:

| Service                  |  Memory |  CPU | Notes                                                       |
| ------------------------ | ------: | ---: | ----------------------------------------------------------- |
| app                      | 1.5 GiB | 1.25 | one Chromium/PDF job at a time at this tier; 512 MiB `/tmp` |
| worker                   | 512 MiB | 0.50 | default concurrency 2 on 8 GiB                              |
| PostgreSQL               |   1 GiB |  1.0 | conservative shared buffers/connections                     |
| Redis                    | 256 MiB | 0.25 | set maxmemory below limit; AOF                              |
| MinIO                    | 512 MiB | 0.50 | single node                                                 |
| ClamAV                   |   2 GiB |  1.0 | signature reload is the largest steady spike                |
| Vaultwarden              | 256 MiB | 0.25 | three users                                                 |
| Nginx                    | 128 MiB | 0.20 | ingress only                                                |
| each one-shot/backup job | 768 MiB | 0.75 | serialize backup, maintenance, and deploy jobs              |

Add 4 GiB swap as an emergency cushion, not normal capacity. Keep at least 20% NVMe free plus free
space equal to the largest staged object set and two uncompressed DB dumps. Pause/suppress the
daily schedule during a release because predeploy already creates a snapshot; never run backup,
prune, ClamAV update, and migration concurrently. The smooth tier remains 8 vCPU/16 GiB/120 GiB.

## Security, compatibility, and residual risks

- App/worker remain non-root, read-only, `no-new-privileges`, bounded PIDs, graceful stop, and
  tmpfs-only scratch. Apply equivalent controls where vendor images support them; PostgreSQL,
  MinIO, ClamAV, and Vaultwarden need writable named volumes.
- Preserve Node `22.23.2`; release PDF tests must execute in the built runtime image, not Node 24.
- Only Coolify terminates public TLS. Preserve Nginx as the trusted forwarded-header boundary.
- Secrets never enter source, build args, image layers, logs, status JSON, GitHub artifacts, or
  shell-expanded command lines. Error messages pass the existing redactor.
- Vaultwarden signups are disabled after the first account (or enabled only for a bounded setup
  window), admin access is disabled unless an Argon2 admin token is intentionally set, and its
  domain is separate from AgencyOS.
- A compromised host root can read internal traffic, volumes, and Coolify secrets. Off-site
  Compliance retention and separately scoped keys reduce, but do not eliminate, this risk.
- Named volumes are persistence, not backups. Redis is reconstructible coordination/cache state;
  it is persisted for continuity but is not a required disaster-restore artifact unless future
  business semantics make it authoritative.
- ClamAV signatures are cacheable and excluded from B2 source backups.
- B2 availability can block a pre-migration release by design. An operator may not bypass this by
  setting a false success flag; emergency override requires a documented incident decision and a
  verified recent snapshot.
- Restore point objective is about 24 hours plus the last successful predeploy snapshot. Recovery
  time depends on download size and the mandatory verification drill.

## Verification plan

1. Parse `docker compose -f compose.coolify.yaml config` with placeholder secrets and assert no
   stateful host ports, no mutable image tags, expected exact volume names, and all completion/health
   dependencies.
2. Unit-test private transport validation: only opted-in exact internal names/auth pass; remote
   plaintext and misspelled/alternate hosts fail; all current TLS cases continue to pass.
3. Unit-test backup environment parsing, redaction, lock contention, missed schedule, stale health,
   status atomicity, failure preservation, and restore production-target refusal with fake process
   adapters—never real credentials.
4. Integration-test fresh first boot, second unchanged deploy, concurrent migration serialization,
   injected migration failure, bootstrap idempotence, and unchanged named-volume identity.
5. Test release API calls against fixtures and a staging Coolify resource: exact two-digest
   read-back before deploy, polling terminal states/timeouts, no deploy on partial PATCH, and public
   ready failure propagation.
6. Run the disposable B2/Object Lock compatibility preflight described above, then test daily,
   skip-if-unchanged/dedup behavior, failed upload, retention older than lock, integrity failure,
   and alerts.
7. Restore a real generated backup into isolated PostgreSQL/MinIO/Vaultwarden targets and run the
   existing restore verifier plus Vaultwarden attachment and Chromium PDF smoke tests.
8. Run `npm run format:check`, lint, typecheck, security/framework/supply-chain/tenant/mutation/
   sensitive-content checks, complexity, all unit tests, migration validation, build, exact Node 22
   PDF tests, and isolated E2E. Production approval additionally requires the staging Coolify and
   B2 restore evidence.

Implementation is complete only when tests and runbooks agree with these fail-closed contracts;
passing static tests alone is not evidence that a provider-side Object Lock or Coolify rollout was
configured correctly.
