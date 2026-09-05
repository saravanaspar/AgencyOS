# Backups and recovery

## Final backup design

Restic 0.18.1 creates encrypted, deduplicated snapshots in the persistent `restic-repository`
volume using normal repository locks. A filesystem lock serializes backup and maintenance.
The uploader sends new repository objects to B2 without overwrite or deletion; snapshot pointers
are uploaded last, after dependencies. Restic lock files never reach B2. Only read-only remote
checks and restores use `--no-lock`.

This supersedes the earlier direct-to-B2 no-lock writer design: restic's no-lock option does not
disable backup locks. Do not run restic backup/forget/prune directly against the locked B2 mirror.
The local repository can be rebuilt from B2 after host loss.

## One-time provider setup

1. Create a private B2 bucket with Object Lock and **default Compliance retention of 30 days**.
   The backup checks this configuration before writing. Enablement alone is insufficient.
2. Create a bucket/prefix-restricted writer key with list/read/write and read-bucket-retention
   permission. Grant **no delete or bucket-retention write permission**.
3. Use a separate **read-only** key for `B2_MAINTENANCE_*`. The variable name is retained, but the
   maintenance service does not need remote deletion rights. Use read-only `B2_RESTORE_*` keys
   during recovery.
4. Generate and separately escrow `RESTIC_PASSWORD`. Losing it makes backups unrecoverable.
5. Configure endpoint, bucket, prefix and region in Coolify. Use one repository per stack.
6. Configure an external success heartbeat accepting POST, and optionally a failure webhook.

Never independently change the local repository volume, B2 prefix or password. An empty local
volume first probes and downloads an existing remote repository. Network/authentication errors
fail the job instead of being treated as an empty bucket.

## Data and consistency

- AgencyOS and Vaultwarden use separate uncompressed custom `pg_dump` files with hash checks.
- Current objects in the four logical storage locations are captured via the S3 API. Cloud mode
  uses the mapped B2 prefixes and a separate read-only source key.
- Vaultwarden files, keys and configuration are copied from its data volume. Live SQLite is
  refused; the bundled vault uses PostgreSQL.
- The encrypted manifest records capture boundaries, release ID and dump hashes.

Each PostgreSQL dump is consistent. The dumps and file copies are not one cross-system transaction.
Concurrent object deletion/replacement can cause mismatches. Verify referenced files during the
restore drill, or use a maintenance window for an exact cross-store capture. Historical MinIO
object-version payloads are not exported; previous captured states remain in restic snapshots.
Redis and ClamAV signatures are reconstructible and excluded.

Configure Coolify's own instance/configuration backup separately. Independently escrow its APP_KEY
and AgencyOS encryption keys. The application stack does not extract Coolify secrets or mount the
Docker socket.

## Schedule, retention and disk use

Backups run daily and before application migrations. Health detects stale success, newer failures,
and missing/stale maintenance records. Success requires a readable B2 snapshot and successful
external heartbeat; a dead VPS is detected by the heartbeat service.

Unchanged content chunks are reused. The stable capture path supports snapshot grouping, but
manifest timestamps and dump metadata still change. Some new data may upload even without business
changes; `--skip-if-unchanged` cannot guarantee no new snapshot.

Weekly maintenance checks B2; the first weekly run each month reads a 10% sample. Local snapshot
selection uses 7 daily, 4 weekly, 12 monthly, and 1 yearly selections; one snapshot may satisfy
multiple tiers. **Remote snapshots and packs are retained indefinitely.** Automatic remote pruning is
disabled because those snapshots can still reference old packs; blindly deleting packs would
corrupt recovery. `BACKUP_PRUNE_ENABLED=1` fails explicitly. Reducing long-term remote storage
requires a separately validated off-host repository rotation or garbage collection procedure.
This package does not automate that procedure.

Budget local disk for live data, one full staging capture and the complete encrypted repository.
Monitor both VPS and B2 usage; 80 GiB is only a starting estimate for very small datasets.
Compliance protects object versions until their retention dates. Preserve bucket version history
and independent credentials; if a compromised writer hides objects with newer versions, recovery
may require selecting prior B2 object versions.

Run these commands inside the backup/maintenance containers:

```bash
node scripts/backup/health.mjs
node scripts/backup/health.mjs --maintenance
node scripts/backup/run-backup.mjs --reason=manual
node scripts/backup/run-maintenance.mjs --weekly
```

## Required provider verification

Before real business data, use a disposable locked B2 bucket to test two backups, deduplication,
protected-object deletion refusal, remote integrity checks, a failed upload, and complete restore.
Failure must not advance last-success or publish a snapshot before its dependencies. These tests
require your credentials and have not run in the coding environment.

## Isolated recovery

1. Create a separate PostgreSQL cluster with pgcrypto/pgTAP packages and two empty databases named
   with `recovery`. Use that cluster's administrative account. Create a separate MinIO server or
   provider-created B2 recovery bucket/prefixes.
2. Stop recovery Vaultwarden and prepare an empty recovery data directory.
3. Run the operations image with a recovery volume. Set `NODE_ENV=development`,
   `AGENCYOS_RESTORE_DRILL=1`, an exact `AGENCYOS_RESTORE_SNAPSHOT`, `AGENCYOS_RECOVERY_ID`, and
   matching `RECOVERY_TARGET_CONFIRM`. Configure original and recovery endpoint variables from
   `.env.example`, plus read-only B2 credentials and the restic password.
4. Run `node scripts/backup/restore-prepare.mjs`. It verifies downloaded restic content, both dump
   hashes and dump readability before service writes.
5. Run `node scripts/backup/restore-components.mjs`. It refuses production/occupied targets,
   creates compatibility NOLOGIN roles on the isolated cluster, restores explicit database targets,
   and copies objects and vault files. Canonical MinIO bucket names are retained on the isolated
   server so database references continue to work.
6. Start recovery using matching images and stable encryption keys. Check database doctor/status,
   permissions, file references, vault login/attachments, scanner, worker and representative PDFs.
   Run the existing restore-drill verifier. Only then deliberately cut over domains.

A failed partial restore must be retried using new empty recovery targets; existing targets are
never silently overwritten. Repeat a real drill quarterly and after backup-tool changes.

References: [restic](https://restic.readthedocs.io/en/stable/040_backup.html),
[Backblaze Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).
