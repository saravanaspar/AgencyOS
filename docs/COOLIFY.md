# Coolify production deployment

This runbook deploys AgencyOS as one Coolify Docker Compose resource. Code containers are
replaceable; PostgreSQL, Redis, MinIO, ClamAV signatures, Vaultwarden, backup state/cache/staging,
and migration evidence use stable named volumes.

> **Data-loss boundary:** choose `AGENCYOS_VOLUME_PREFIX` once. Never rename it, delete the Coolify
> resource together with storage, or run `docker compose down -v`. Named volumes survive routine
> deploys, but they are not backups.

## Minimum host

Use 16 GiB RAM for the complete stack with deployment/scan/backup overlap. An 8 GiB host needs
measured workload limits and swap; it cannot be promised lag-free. Build app and operations images
in GitHub. The small PostgreSQL/pgTAP image currently builds on first host deployment. Keep 20%
disk free plus room for a full staging capture and the persistent encrypted restic repository.
Start with 4 vCPU and 80 GiB only for very small data; increase disk as measured usage requires.

## One-time setup

1. Install a current Coolify release and point separate AgencyOS and Vaultwarden domains at the VPS.
2. Give Coolify a read-only GHCR package credential.
3. Create the private, Object-Lock-enabled B2 bucket and split credentials described in
   [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md). Configure Coolify's own instance backup to a different
   prefix and escrow its `APP_KEY` plus the restic password offline.
4. Add the repository as a Docker Compose resource using `compose.coolify.yaml`. Disable automatic
   branch deployments.
5. Generate independent URL-safe secrets with `openssl rand -hex 32`. Generate the two stable
   application encryption keys with `openssl rand -base64 32`.
6. Enter every `${NAME:?message}` variable in Coolify using `.env.example` only as a placeholder
   inventory. Never commit or export actual values.
7. Set the private URLs consistently:

   - `DATABASE_URL=postgresql://agencyos:<password>@postgres:5432/agencyos`
   - `DATABASE_ADMIN_URL` to the same direct, non-pooled endpoint
   - `DATABASE_CONTROL_URL=postgresql://agencyos:<password>@postgres:5432/postgres`
   - `REDIS_URL=redis://default:<password>@redis:6379/0`
   - `VAULTWARDEN_DATABASE_URL=postgresql://vaultwarden:<password>@postgres:5432/vaultwarden`
   - `APP_URL` to the public AgencyOS HTTPS origin and `VAULTWARDEN_URL` to the vault HTTPS origin

8. Route the AgencyOS domain only to `gateway:8080`; route the vault domain only to
   `vaultwarden:8080`. Never route PostgreSQL, Redis, MinIO, ClamAV, migrations, or backups. MinIO's
   console is disabled.

The Compose opt-in permits plaintext transport only for authenticated `redis:6379`, non-root
`minio:9000`, and `clamav:3310` on its `internal: true` network. Remote Redis/MinIO endpoints still
require TLS. All external runtime images are digest-pinned; the custom PostgreSQL build starts from
a pinned image and includes pgTAP required by historical migrations.

## Protected GitHub release environment

Create a protected environment named `release`. Store `COOLIFY_API_TOKEN` as a secret and
`COOLIFY_BASE_URL`, `COOLIFY_APPLICATION_UUID`, and `PRODUCTION_APP_URL` as variables. Keep existing
release database/E2E values pointed at an isolated release-candidate environment—not production.
GitHub never receives production database, MinIO, Vaultwarden, B2, or restic credentials.

The handoff currently uses Coolify `/api/v1/applications/{uuid}/envs`, `/api/v1/deploy`, and
`/api/v1/deployments/{deployment_uuid}`. Validate those response shapes against the installed
Coolify version using a staging resource before first production use. The workflow fails closed if
the two exact digest values cannot be read back, polling fails, or public live/ready checks fail.

## First and routine releases

Commit and review the complete tree, then run:

```bash
npm run release:production -- v1.0.0
```

The helper refuses a dirty tree, creates an annotated tag when needed, verifies it targets `HEAD`,
and pushes only the tag. A manual workflow run is also possible but requires typing `DEPLOY` and
approving the protected environment. Ordinary branch pushes never deploy production.

The workflow runs release verification, builds the application and operations images once, records
both GHCR digests, publishes SBOM/provenance attestations, writes both digest variables to Coolify,
reads them back, pins Coolify's source commit, starts one deployment, polls it, and verifies public
health/security headers plus the running application's baked-in commit revision. It also tests
Chromium PDF creation inside the built runtime image before publishing.

Each deployment then fails closed through this sequence: PostgreSQL/MinIO health; idempotent
Vaultwarden-database and MinIO-identity bootstrap; Vaultwarden health; mandatory encrypted
pre-deploy backup; existing advisory-locked/checksum-verified migrations plus status/doctor; then
web, worker, and gateway startup. The operations digest changes each release so Coolify recreates
the one-shot gates. Prove that behavior with the staging Coolify version.

For the first Vaultwarden account only, temporarily set `VAULTWARDEN_SIGNUPS_ALLOWED=true`, create
the owner, then immediately set it to `false` and redeploy. Keep the admin token empty unless its UI
is intentionally needed. AgencyOS stores only vault item UUID references and never vault passwords.

## Operation and rollback

Inspect migration, pre-deploy backup, daily backup, and maintenance logs after releases. The backup
health check becomes unhealthy after 30 hours; the required external heartbeat detects a dead VPS.
Do not click redeploy while the release workflow is changing digest variables.

Rollback selects both previous digests from a release manifest and repeats the same handoff. Never
use `latest` and never reverse SQL automatically. Code rollback is safe only when migrations used
expand/contract compatibility. Data rollback always goes to an isolated recovery stack first.
