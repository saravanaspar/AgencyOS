# Final quality report

Date: 2026-09-05. Scope: infrastructure changes relative to the supplied AgencyOS.zip.

## Assessment

Implementation delivered as a deployment candidate. Production approval is pending real container,
Coolify and B2 restore evidence. The independent review agent stopped because workspace credits
were exhausted; the primary agent resumed the code review and corrections. Do not describe this
as an independently approved production release.

## Corrected defects

- Replaced invalid no-lock restic writes to a Compliance-locked bucket with a normally locked local
  encrypted repository and a B2 mirror. Dependencies publish before snapshot pointers; mirror
  commands never overwrite or delete remote objects. The writer verifies bucket default retention.
- Added the persistent local repository volume, stable capture path and serialized maintenance.
- Disabled remote pruning explicitly. Remote snapshots/packs are retained indefinitely; automatic
  off-site retention/garbage collection remains an unimplemented requirement. Local snapshot
  selection and remote integrity checks are automatic.
- Fixed PostgreSQL CREATE ROLE password binding using server-side literal quoting.
- Fixed restore to supply pg_restore's explicit database option, recreate compatibility roles,
  verify downloaded files and retain canonical buckets on the isolated recovery server.
- Included database tests and runtime source in the operations image because migration validation
  reads them. Added a built-image migration-validator smoke check in CI.
- Added ClamAV signature-download egress and increased its memory ceiling to 3 GiB.
- Restored Nginx's required worker privilege-drop capabilities and validated Redis config inputs.
- Fixed the release helper's inherited-stdio return handling.
- Pin Coolify's source commit and verify the live app's baked-in revision. Reject API redirects.
- Added built-runtime Chromium PDF generation before image publication. Apply pending migrations
  to the isolated CI database before checking its status.
- Backup health now detects newer failures, future-dated success and absent maintenance records.
- Updated the old single-image provenance assertion for both app and operations digests.

## Verification evidence

- `npm run check`: PASS. Includes whole-repository formatting, ESLint, TypeScript, framework,
  supply-chain, tenant-scope, mutation-boundary, sensitive-content and complexity gates.
- `npm test -- --reporter=dot`: 655 passed, 3 failed, 658 total across 138 files. All three failures
  are existing Chromium launch failures in finance PDF, HR letter PDF and salary-slip PDF tests.
  The local runtime is unsupported Node 24.19.0. Node 22 image execution remains required.
- `npm run db:check`: PASS, 67 migrations, 206 public tables, 440 runtime source files.
- Compose/workflow YAML parsing: PASS. 13 services; dependency graph acyclic; named-volume
  references resolve; no host-published service ports; scanner has outbound networking.
- Added behavioral tests for immutable publication ordering/failure and backup health failures.
- `npm run build`: BLOCKED by sandbox/runtime `ENOENT: uv_resident_set_memory` during webpack
  build. This is not a successful production build; it must pass on the Node 22 release runner.

## Required external gates and limits

Docker/Podman and production/provider credentials are unavailable here. Image pulls/digest
availability, image builds, fresh and repeat Compose deployment, one-shot recreation, induced
migration failure, actual Coolify API rollout, B2 uploads/Object Lock and isolated full restores
have not been exercised. Source checks validate pin syntax, not registry availability.

The release gate uses an isolated CI database and deployed E2E environment configured by the
operator. A live application revision check protects the final production handoff. A single VPS
does not guarantee zero downtime or zero lag. Use 16 GiB for overlapping scans/backups/deploys;
measure 8 GiB before relying on it. PostgreSQL's small custom image still builds on first host
deployment; application/operations images build off-host.

Backups are not a cross-store transaction and do not export old MinIO version payloads. Coolify
control-plane backup and independent key escrow must be configured by the operator. The provided
SPDX artifacts describe npm dependencies; they are not a complete inventory of operating-system
packages, restic and MinIO binaries.

The final authority for backup behavior is docs/BACKUP_RECOVERY.md; it supersedes the original
architecture's no-lock writer and automatic remote prune proposal.
