# Architecture: selectable local or cloud infrastructure

## Decision

Implement two complete, mutually exclusive Coolify Compose entry points:

- `compose.coolify.yaml` remains the bundled/local production stack.
- `compose.coolify.cloud.yaml` is a new hosted-data-plane stack.

The cloud manifest must not define, build, start, persist, or depend on `postgres`, `redis`, or
`minio`. It retains local ClamAV, Vaultwarden's `/data` volume, the release/migration gate, the
application and worker, the gateway, and the backup/maintenance services. This is safer than
Compose profiles because a disabled profile can still leave interpolation and dependency ambiguity
in Coolify, while two explicit resources make the selected data plane visible and testable.

This feature is additive. It does not change an HTTP contract, database schema, stored logical
bucket value, migration history, or the names of any existing local volume. A populated deployment
cannot be moved by changing a flag: local-to-cloud is a deliberate cutover with data copy and
verification.

## Compatibility boundary

The following existing behavior is non-negotiable:

1. `compose.coolify.yaml` continues to start local PostgreSQL, Redis, and MinIO.
2. Its existing volume names remain exactly:
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-postgres-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-redis-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-minio-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-clamav-signatures-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-vaultwarden-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-backup-state-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-restic-cache-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-restic-repository-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-backup-stage-v1`
   - `${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-release-status-v1`
3. The four database-facing logical object-storage names remain exactly:
   - `private-file-quarantine`
   - `private-files`
   - `project-attachments`
   - `document-templates`
4. The existing `putMinioObject`, `readMinioObject`, `removeMinioObject`,
   `minioObjectExists`, constants, not-found behavior, and error codes remain exported.
5. Local environments may continue using `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`,
   `MINIO_SECRET_KEY`, and `MINIO_REGION`. These are not silently reinterpreted as a cloud
   administrator contract.
6. Existing schema-version-1 backup manifests and the `minio/<logical-name>` snapshot directory
   remain restorable.

The local manifest should receive only two behavior changes: an explicit
`AGENCYOS_INFRA_MODE=local`/`OBJECT_STORAGE_PROVIDER=minio` declaration and the requested retention
defaults. No service or volume is removed or renamed.

## Deployment topology

### Bundled/local mode

The existing 13-service graph is retained:

`postgres`, `redis`, `minio`, `clamav`, `bootstrap`, `vaultwarden`, `predeploy-backup`, `migrate`,
`app`, `worker`, `gateway`, `backup`, and `backup-maintenance`.

Local `bootstrap` remains responsible for the local Vaultwarden role/database and MinIO
bucket/user/policy provisioning. Plaintext Redis and MinIO remain legal only at the exact private
service URLs with `AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK=1`.

### Hosted/cloud mode

`compose.coolify.cloud.yaml` defines ten services:

1. `clamav`
2. `cloud-preflight`
3. `vaultwarden`
4. `predeploy-backup`
5. `migrate`
6. `app`
7. `worker`
8. `gateway`
9. `backup`
10. `backup-maintenance`

The cloud graph is:

- `cloud-preflight` waits for healthy ClamAV, validates every hosted dependency, and exits.
- `vaultwarden` waits for `cloud-preflight` and connects to its provider-created PostgreSQL
  database.
- `predeploy-backup` waits for `cloud-preflight` and healthy Vaultwarden. It must complete before
  `migrate`.
- `migrate` uses only the direct AgencyOS PostgreSQL URL and runs the existing locked release gate.
- `app` waits for `migrate` and healthy ClamAV. It has no dependency edge to a nonexistent local
  data service.
- `worker`, `gateway`, `backup`, and `backup-maintenance` keep the current sequencing and health
  behavior.

Both networks remain: `private` is `internal: true`, while `egress` permits provider access and
ClamAV signature updates. No service publishes a host port, mounts the Docker socket, or receives
unneeded root-provider credentials. Only `gateway:8080` and `vaultwarden:8080` are exposed for
Coolify-managed domains.

Cloud mode declares only these persistent volumes, using their current external names:

- `clamav-signatures`
- `vaultwarden-data`
- `backup-state`
- `restic-cache`
- `restic-repository`
- `backup-stage`
- `release-status`

It must not declare PostgreSQL, Redis, or MinIO data volumes.

## Environment contract

### Mode selection

| Variable                                 | Local manifest | Cloud manifest | Rule                                                                                                          |
| ---------------------------------------- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENCYOS_INFRA_MODE`                    | `local`        | `cloud`        | Required in production; only these values are accepted.                                                       |
| `OBJECT_STORAGE_PROVIDER`                | `minio`        | `b2`           | Must agree with infrastructure mode.                                                                          |
| `AGENCYOS_TRUST_PRIVATE_SERVICE_NETWORK` | `1`            | `1`            | In cloud mode this permits only the exact local ClamAV URL; it does not permit plaintext hosted dependencies. |

Legacy development environments without `AGENCYOS_INFRA_MODE` continue to work outside production.
Production fails closed when the mode is absent or conflicts with provider-specific variables.

### PostgreSQL

| Consumer                       | Variable                         | Cloud contract                                                                                                                                                                                 |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AgencyOS app/worker            | `DATABASE_URL`                   | Neon pooled runtime URL; remote TLS required.                                                                                                                                                  |
| migration/release gate, backup | `DATABASE_ADMIN_URL`             | Direct, non-pooler URL for the same AgencyOS database; remote TLS required.                                                                                                                    |
| Vaultwarden runtime            | `VAULTWARDEN_DATABASE_URL`       | Provider-created Vaultwarden database URL; remote TLS required. Use the provider-supported runtime URL; direct is preferred until the exact Vaultwarden/pooler combination passes a live test. |
| Vaultwarden backup             | `VAULTWARDEN_DATABASE_ADMIN_URL` | Direct URL for the same Vaultwarden database; required in cloud mode.                                                                                                                          |

Cloud validation requires `sslmode=require`, `verify-ca`, or `verify-full` (provider-equivalent secure
parameters may remain in the URL), rejects `sslmode=disable`, and rejects common pooler hosts/port
6543 for both administrative URLs. It verifies that each runtime/admin pair targets the same
database and that AgencyOS and Vaultwarden do not target the same database. The application image
never receives either administrative URL.

Local backup preserves compatibility by allowing `VAULTWARDEN_DATABASE_ADMIN_URL` to fall back to
the existing `VAULTWARDEN_DATABASE_URL` only for the exact local/private PostgreSQL topology.

### Redis

Cloud mode requires:

```text
REDIS_URL=rediss://default:<UPSTASH_PASSWORD>@<UPSTASH_TCP_HOST>:<PORT>
```

The URL must use native Redis TLS (`rediss://`), contain a username and non-empty credential, and
must not contain a fragment. An Upstash HTTPS REST endpoint is rejected. `REDIS_REQUIRED=1`
continues to fail closed. Redis remains cache, rate-limit, and coordination state and is not backed
up.

### Runtime object storage

`B2_*` remains reserved for the immutable backup repository. Mutable runtime storage uses a
separate, provider-neutral namespace:

```text
OBJECT_STORAGE_ENDPOINT=https://s3.<region>.backblazeb2.com
OBJECT_STORAGE_REGION=<b2-region>
OBJECT_STORAGE_ACCESS_KEY_ID=<runtime-read-write-delete-key-id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<runtime-application-key>

OBJECT_STORAGE_QUARANTINE_BUCKET=<provider-created-runtime-bucket>
OBJECT_STORAGE_QUARANTINE_PREFIX=private-file-quarantine
OBJECT_STORAGE_PRIVATE_FILES_BUCKET=<provider-created-runtime-bucket>
OBJECT_STORAGE_PRIVATE_FILES_PREFIX=private-files
OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET=<provider-created-runtime-bucket>
OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX=project-attachments
OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET=<provider-created-runtime-bucket>
OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX=document-templates
```

The recommended B2 layout is one mutable runtime bucket and four non-overlapping prefixes. The
explicit bucket variables also allow four provider-created buckets with empty prefixes. Every
logical role must be configured; implicit string substitution is forbidden.

Define one shared server-only location contract in
`src/integrations/object-storage/config.mjs`, accompanied by
`src/integrations/object-storage/config.d.mts`. It is imported by the TypeScript runtime adapter and
the Node operations scripts. This prevents the app, readiness, backup, preflight, and restore paths
from implementing divergent mapping rules.

For a logical location `(logicalBucket, objectName)`, the resolver returns:

```text
physicalBucket = configured bucket for logicalBucket
physicalKey    = configuredPrefix ? configuredPrefix + "/" + objectName : objectName
```

Local mode resolves the four logical names to identically named physical MinIO buckets with empty
prefixes, preserving all existing rows and object keys. Validation rejects path traversal,
leading/trailing slash ambiguity, empty segments, control characters, overlapping prefixes in the
same physical bucket, duplicate exact locations, endpoint credentials, endpoint path/query/hash,
and cloud HTTP endpoints.

The existing MinIO SDK remains the S3 data client. Account-wide `listBuckets()` is removed from
readiness. Readiness uses a bounded `bucketExists()`/HEAD-style check once per unique configured
physical bucket. `cloud-preflight` performs a random write, stat/read, and delete probe inside each
logical prefix using the runtime key, so a deployment cannot become healthy with incomplete B2
permissions. It never creates a B2 bucket or application key.

The runtime B2 key is limited to the mutable runtime bucket and only the list/read/write/delete
capabilities needed by the four locations. It has no access to the immutable backup bucket.

### Backup source key and immutable destination

Cloud backup jobs receive a separate read/list-only key for the mutable runtime bucket:

```text
OBJECT_STORAGE_BACKUP_ACCESS_KEY_ID=<runtime-bucket-read-key-id>
OBJECT_STORAGE_BACKUP_SECRET_ACCESS_KEY=<runtime-bucket-read-application-key>
```

The existing immutable destination contract remains:

```text
B2_ENDPOINT=https://s3.<backup-region>.backblazeb2.com
B2_REGION=<backup-region>
B2_BUCKET=<different-object-lock-enabled-bucket>
B2_PREFIX=agencyos/restic
B2_WRITER_KEY_ID=<non-delete-backup-writer-key-id>
B2_WRITER_APPLICATION_KEY=<writer-application-key>
B2_MAINTENANCE_KEY_ID=<read-only-key-id>
B2_MAINTENANCE_APPLICATION_KEY=<read-only-application-key>
B2_RESTORE_KEY_ID=<read-only-restore-key-id>
B2_RESTORE_APPLICATION_KEY=<read-only-restore-application-key>
RESTIC_PASSWORD=<separately-escrowed-secret>
```

After endpoint normalization, cloud validation rejects any runtime physical location whose bucket
equals `B2_BUCKET` at the same endpoint. It rejects reuse of the runtime, source-backup, and
immutable-writer key IDs. A different prefix in the same bucket is not sufficient: runtime and
backup must use distinct buckets. The backup repository retains default Compliance Object Lock of
at least 30 days and a non-delete writer.

Local mode continues using `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` for its existing source capture
path during this feature, so no currently deployed local backup loses permission. These credentials
do not exist in the cloud manifest.

## Runtime object-storage adapter

`src/integrations/minio/object-storage.ts` remains the compatibility facade and becomes
provider-neutral internally:

1. Validate the database-facing logical bucket and object key exactly as today.
2. Resolve it through the shared configuration module.
3. Call the MinIO SDK with the resolved physical bucket/key.
4. Preserve current body-size limits, metadata, not-found translations, and public error codes.

`getMinioEnv()` remains a compatibility accessor for local callers. Add `getObjectStorageEnv()` as
the canonical API. Do not expose physical bucket names to database rows or return values. The
health endpoint keeps its existing response shape (including any legacy `minio` label) to honor the
no-HTTP-contract-change requirement, while its implementation probes provider-neutral storage.

## Cloud preflight and release ordering

Add `scripts/operations/validate-cloud-production.mjs`. It performs no account provisioning and
must complete before any backup or migration:

1. Parse the strict `cloud` environment contract.
2. Connect to the pooled AgencyOS database and direct AgencyOS database, verify database identity,
   and run `SELECT 1`.
3. Connect to the Vaultwarden runtime and direct dump URLs, verify database identity and separation,
   and run `SELECT 1`.
4. Connect to native TLS Redis and issue `PING` with a bounded timeout.
5. Probe every unique B2 runtime location with a random object, byte-for-byte readback, stat, and
   delete.
6. Verify the local private ClamAV endpoint.
7. Validate that runtime and backup buckets and credentials are distinct.

The existing `scripts/operations/bootstrap-production.mjs` is local-only and should explicitly
refuse `AGENCYOS_INFRA_MODE=cloud`. The cloud script must refuse local mode. Neither logs URLs,
credentials, or object keys containing secrets.

Migrations continue through `scripts/operations/release-gate.mjs` with the direct URL, advisory
lock, checksums, status, and doctor. The ordering remains fail-before-replace:

```text
cloud-preflight -> predeploy-backup -> migrate -> app -> worker/gateway
```

Any failed preflight, backup, or migration prevents the new application container from becoming
eligible. The GitHub release workflow and `deploy-coolify.mjs` continue updating the same immutable
application/operations digests and release SHA; the chosen Coolify resource determines which
Compose entry point consumes them.

## Backup capture and publication

Refactor `scripts/backup/config.mjs` to return a provider-neutral object-storage source. The cloud
branch requires the source read/list key; the local branch retains the existing root-key contract.
Both branches use the same logical location resolver.

`scripts/backup/run-backup.mjs` keeps the stable on-disk namespace
`minio/<logical-bucket>/...` even for B2. This intentionally preserves schema-v1 restore
compatibility. For each logical location it:

1. Mirrors only the current objects below the configured physical prefix into the logical
   directory.
2. Records version-list metadata when the provider permits it, with the physical prefix stripped
   so inventory keys remain logical.
3. Never captures another logical prefix sharing the same physical bucket.
4. Fails the entire run on list, download, inventory, dump, Vaultwarden copy, Restic backup,
   publication, snapshot-readback, or required-heartbeat failure.

Write a schema-version-2 manifest containing an additive `objectStorage` block with provider,
logical counts, and redacted logical-to-physical descriptors (bucket/prefix but never endpoint
credentials). Retain the existing `minio` count field and status evidence fields for monitoring
compatibility. Restore accepts both versions 1 and 2. Version-list metadata is evidence only;
historical runtime object-version payloads are not part of the backup.

Restic behavior remains:

- encrypted by `RESTIC_PASSWORD`;
- content-defined/deduplicated;
- serialized with the existing filesystem lock;
- written to the persistent local repository first;
- mirrored append-only to the separate B2 bucket;
- published dependency-first and `snapshots` last;
- verified read-only from B2 before success evidence advances;
- never automatically pruned remotely.

PostgreSQL and Vaultwarden dumps use the direct hosted URLs. Vaultwarden `/data` remains copied
from its volume. Redis and ClamAV remain excluded as reconstructible state. The backup is
component-consistent only; it does not claim a cross-store transaction.

## Retention semantics

Set these exact defaults in code, both Compose manifests, and `.env.example`:

```text
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=12
BACKUP_KEEP_YEARLY=1
```

The validation minimums become 1 for every tier, and the default values become 7/4/12/1. The
monthly local `restic forget` command uses only:

```text
--group-by host
--keep-daily 7
--keep-weekly 4
--keep-monthly 12
--keep-yearly 1
```

Remove `--keep-within 35d`, because it overrides the requested daily selection. Restic may select
one snapshot for more than one calendar tier; 7/4/12/1 describes the retention policy, not a
promise of 24 distinct snapshots.

This selection applies to the persistent local Restic repository. The immutable B2 mirror is
append-only: previously published encrypted snapshots, indexes, and packs remain in B2
indefinitely, even after local `forget`. `BACKUP_PRUNE_ENABLED=1` continues to fail explicitly.
Therefore the requested selection improves the local catalog and normal restore choice, but it is
not a remote B2 deletion policy and remote storage can grow. A separately designed off-host
rotation/garbage-collection process is required before any remote deletion can be automated.

## Restore architecture

`restore-prepare.mjs` remains provider-independent because it reads the encrypted immutable B2
repository. It accepts schema versions 1 and 2 and validates both database dumps and the restored
manifest before producing evidence.

`restore-components.mjs` accepts either the legacy isolated MinIO contract or a new generic
recovery contract:

```text
RECOVERY_OBJECT_STORAGE_PROVIDER=minio|b2
RECOVERY_OBJECT_STORAGE_ENDPOINT=<isolated endpoint>
RECOVERY_OBJECT_STORAGE_REGION=<region>
RECOVERY_OBJECT_STORAGE_ACCESS_KEY_ID=<recovery key>
RECOVERY_OBJECT_STORAGE_SECRET_ACCESS_KEY=<recovery secret>
RECOVERY_OBJECT_STORAGE_QUARANTINE_BUCKET=<recovery bucket>
RECOVERY_OBJECT_STORAGE_QUARANTINE_PREFIX=<recovery prefix>
RECOVERY_OBJECT_STORAGE_PRIVATE_FILES_BUCKET=<recovery bucket>
RECOVERY_OBJECT_STORAGE_PRIVATE_FILES_PREFIX=<recovery prefix>
RECOVERY_OBJECT_STORAGE_PROJECT_ATTACHMENTS_BUCKET=<recovery bucket>
RECOVERY_OBJECT_STORAGE_PROJECT_ATTACHMENTS_PREFIX=<recovery prefix>
RECOVERY_OBJECT_STORAGE_DOCUMENT_TEMPLATES_BUCKET=<recovery bucket>
RECOVERY_OBJECT_STORAGE_DOCUMENT_TEMPLATES_PREFIX=<recovery prefix>
```

Legacy `RECOVERY_MINIO_ENDPOINT`, `RECOVERY_MINIO_ACCESS_KEY`, and
`RECOVERY_MINIO_SECRET_KEY` remain accepted only for the MinIO/canonical-bucket recovery shape.
Cloud/B2 restore requires provider-created recovery buckets; the script never creates them or uses
account-admin credentials. Local MinIO recovery may retain the existing canonical-bucket creation
behavior.

Isolation compares normalized endpoint, physical bucket, and prefix tuples. A recovery B2 bucket
may use the same regional endpoint as production, but must not target an identical or overlapping
production location. Every target prefix must be empty before any upload. The script maps the
snapshot's logical directories into the configured recovery physical locations while restored
database rows keep their original logical bucket values.

All existing recovery guards remain: non-production process, `AGENCYOS_RESTORE_DRILL=1`, exact
recovery ID confirmation, separate recovery databases, empty database/storage targets, verified
snapshot, no destructive database flags, and no production overwrite option.

## Exact implementation surface

### Add

- `compose.coolify.cloud.yaml` — complete cloud-mode Coolify entry point.
- `src/integrations/object-storage/config.mjs` — shared environment parser, normalizer, logical
  location resolver, overlap/isolation checks, and redacted descriptors.
- `src/integrations/object-storage/config.d.mts` — strict TypeScript declarations for the shared
  module.
- `scripts/operations/validate-cloud-production.mjs` — hosted dependency preflight.
- `scripts/storage/check-object-storage.mjs` — provider-neutral restricted-permission readiness
  check used by preflight/operations.

### Modify

- `compose.coolify.yaml` — explicit local mode plus 7/4/12/1 defaults only; preserve services and
  volumes.
- `.env.example` — document local and cloud variable sets, source-read key, recovery mapping, and
  retention.
- `package.json` — add `coolify:config:local`, `coolify:config:cloud`, and a provider-neutral
  `storage:check`; retain existing commands as aliases.
- `src/lib/validation/env.ts` — add mode/provider validation, authenticated cloud Redis validation,
  generic object-storage accessor, and legacy local compatibility.
- `src/integrations/minio/object-storage.ts` — resolve logical locations before SDK calls while
  preserving exports.
- `src/lib/server/dependency-health.ts` — restricted, provider-neutral per-bucket readiness without
  `listBuckets()`.
- `scripts/operations/bootstrap-production.mjs` — explicit local-only guard.
- `scripts/backup/config.mjs` and `scripts/backup/config.d.mts` — cloud direct URLs, source key,
  shared location map, and runtime/backup isolation.
- `scripts/backup/run-backup.mjs` — mapped capture and additive schema-v2 metadata.
- `scripts/backup/run-maintenance.mjs` — exact 7/4/12/1 local selection and no `keep-within`.
- `scripts/backup/restore-prepare.mjs` — accept and verify schema versions 1 and 2.
- `scripts/backup/restore-components.mjs` — mapped local/B2 isolated restore.
- `Containerfile.operations` — copy any newly added operations/storage sources needed at runtime.
- `docs/COOLIFY.md`, `docs/BACKUP_RECOVERY.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`,
  `docs/POSTGRESQL_CUTOVER.md`, and `deploy/README.md` — mode selection, provider setup, cutover,
  restore, retention, and limitations.
- Existing unit contract tests listed below.

No database migration, route, page, business module, or GitHub deployment-secret contract is
required. If the release script needs a source-only test adjustment for the second manifest, it
must remain compatible with either selected Coolify resource.

## Test plan

### Compose and compatibility contracts

Extend `tests/unit/coolify-deployment-contract.test.ts` to parse both YAML files and assert:

- local service set and every current external volume name are unchanged;
- cloud contains exactly the ten intended services and no `postgres`, `redis`, `minio`, related
  volumes, local-root credentials, host ports, or Docker socket;
- no cloud `depends_on` references a missing/local data service;
- both manifests use immutable app/operations images and preserve prebackup-before-migration;
- ClamAV has egress and the required persistent signature volume in both modes;
- cloud app/worker receive pooled runtime URLs but not admin URLs;
- cloud migrate/backup receive direct URLs but app does not;
- backup and runtime object-storage credentials are separated by service;
- both manifests default to 7/4/12/1 and keep remote prune disabled.

### Configuration and object mapping

Extend `env-validation.test.ts` and `minio-storage.test.ts` to cover:

- canonical local resolution with unchanged bucket/key values;
- cloud B2 resolution for all four logical roles into one bucket/four prefixes;
- four separate provider bucket mappings with empty prefixes;
- runtime CRUD uses only resolved physical locations;
- restricted readiness never calls `listBuckets()`;
- rejection of absent/conflicting mode, cloud HTTP, endpoint credentials/path/query/fragment,
  missing mapping, traversal, duplicate/overlapping prefixes, local admin variables in cloud, and
  cloud variables in local production;
- acceptance of Neon pooled runtime plus direct admin URLs and authenticated Upstash `rediss://`;
- rejection of an HTTP REST Redis URL, unauthenticated TLS Redis, insecure remote PostgreSQL, and a
  pooled administrative URL;
- rejection when any mutable runtime bucket equals the immutable backup bucket at the normalized
  endpoint or credential IDs are reused.

### Backup, retention, and restore

Extend `backup-operations-contract.test.ts` and `immutable-repository.test.ts` to prove:

- local capture retains canonical MinIO behavior;
- cloud capture requests each logical physical prefix with the source read key, strips prefixes in
  inventory, and never captures another prefix;
- PostgreSQL dumps use direct URLs; Redis is never captured;
- source, Restic, publication, remote-readback, or required-heartbeat failure cannot write success
  evidence;
- publication remains config/keys/data/index before snapshots with no overwrite/remove/delete;
- schema-v1 and schema-v2 snapshots prepare successfully;
- local MinIO and B2 mapped restores target only empty isolated locations;
- same endpoint plus a different bucket is accepted, while identical or overlapping physical
  target locations are rejected;
- default maintenance arguments are exactly daily 7, weekly 4, monthly 12, yearly 1, omit
  `--keep-within`, and remote pruning remains unavailable.

Keep the existing migration checksum/lock tests, release tests, security checks, build, E2E, and
Chromium PDF smoke gate. A final real provider gate must use disposable Neon/Upstash/B2 resources
and perform upload, scan, promotion, download, delete, backup, and isolated restore before cloud
mode is production-approved.

## Security model

- Runtime B2 key: mutable runtime bucket only; list/read/write/delete; no backup access.
- Backup source key: mutable runtime bucket only; list/read/version-read; no write/delete.
- Backup writer key: immutable backup bucket/prefix only; write/list/read as required by append-only
  publication; no delete.
- Maintenance/restore keys: immutable backup bucket read-only.
- Neon app URL: normal application privileges through pooler; no migration URL in app/worker.
- Neon migration/backup URL: direct database connection only in one-shot/backup services.
- Upstash: TLS native Redis credentials only in app/worker/preflight; not in backup.
- Cloud preflight temporarily receives runtime dependency credentials but no B2 backup writer or
  Restic password.
- Application never receives MinIO root credentials, B2 backup credentials, direct database URLs,
  or provider account-master credentials.
- All endpoints are credential-free; secrets stay in distinct Coolify environment values and are
  redacted from diagnostics.
- No automated provider account/bucket/key creation and no Docker-socket access.

## Migration, deployment, and rollback

### Fresh cloud installation

1. Create two Neon databases (AgencyOS and Vaultwarden), their runtime/direct credentials, one
   Upstash native Redis database, one mutable B2 runtime bucket/key set, and one separate
   Object-Lock-enabled B2 backup bucket/key set.
2. Configure `compose.coolify.cloud.yaml` once in a separate Coolify resource and enter its secrets.
3. Run cloud preflight, the first predeploy backup, migrations, then application health checks.
4. Complete a real object upload/scan/download test and an isolated restore drill before business
   data is accepted.

### Populated local-to-cloud cutover

1. Keep the current local resource intact and take a verified pre-cutover backup.
2. Enter a maintenance/read-only window and stop workers that can create new writes.
3. Copy PostgreSQL with the existing direct `db:copy` flow and verify migrations, row counts, and
   application invariants.
4. Copy the current objects from each canonical MinIO bucket into its mapped B2 prefix and verify
   counts, byte sizes, and sampled/full hashes. Existing MinIO historical versions are not moved by
   this feature unless an explicit version migration is run.
5. Seed/verify the provider-created Vaultwarden database and preserve the Vaultwarden `/data`
   volume or restore it into the cloud resource's stable named volume.
6. Run cloud preflight, predeploy backup, migration gate, smoke tests, and a cloud backup/restore
   drill.
7. Switch the domain only after all gates pass. Retain the stopped local resource and volumes for a
   defined rollback window.

Rollback before new cloud writes is a domain switch back to the intact local resource. Once cloud
writes occur, rollback requires a reverse verified data sync or restore; changing the Compose file
alone would lose those writes. Application-image rollback remains available through the existing
immutable digests, subject to the existing expand/contract migration policy.

No SQL migration is introduced by this feature.

## Risks and explicit limitations

1. **Remote retention is indefinite.** The 7/4/12/1 policy does not delete old immutable B2
   repository objects. B2 cost grows until a separately validated repository rotation/GC process
   exists.
2. **Backups are not cross-store atomic.** PostgreSQL dumps, B2 object capture, and Vaultwarden
   files have separate consistency boundaries. Prefer a quiet/maintenance window for high-value
   releases and validate application references after restore.
3. **Current objects only.** Runtime B2/MinIO historical object-version payloads are not downloaded;
   only current objects and version metadata are captured.
4. **Network dependency.** Cloud mode trades VPS memory/disk for dependency on provider latency,
   quotas, egress, outages, and TLS/DNS. Timeouts and health checks must remain bounded.
5. **B2 S3 compatibility requires a live gate.** MinIO SDK and `mc` compatibility must be proven
   against the exact B2 endpoint, key restrictions, multipart behavior, version listing, and Object
   Lock settings before production approval.
6. **Vaultwarden pooler compatibility is not assumed.** Use a direct hosted PostgreSQL runtime URL
   unless the selected pooled endpoint is proven with the pinned Vaultwarden image.
7. **Cutover is not a toggle.** A populated local installation needs a verified database/object
   copy and write freeze; otherwise cloud mode starts against empty or divergent data.
8. **Restore must remain isolated.** Same-region B2 endpoints are normal, so isolation is based on
   bucket/prefix tuples, not hostname alone. Incorrect mappings must fail before the first upload.
9. **No automatic Coolify control-plane backup.** Coolify configuration and `APP_KEY` remain a
   separately configured operational responsibility.
10. **No production approval from source tests alone.** Exact container pulls, hosted preflight,
    deployment replacement, failure recovery, backup publication, and full restore require live
    evidence.

## Architecture checkpoint verdict

The design is approved for implementation as an additive infrastructure feature. The separate
cloud manifest is the decisive safety boundary. Implementation must not replace the local manifest,
rename local volumes, weaken the direct-migration/predeploy-backup gates, or imply that 7/4/12/1
automatically prunes the immutable B2 mirror.
