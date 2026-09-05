# AgencyOS container deployment

For the complete persistent Coolify topology, automatic migration gate, two-image release handoff,
and backups, use [`docs/COOLIFY.md`](../docs/COOLIFY.md). The Podman flow below remains useful for
release-candidate verification but is not the complete stateful production stack.

Use `compose.coolify.yaml` for bundled local PostgreSQL/Redis/MinIO or
`compose.coolify.cloud.yaml` for hosted PostgreSQL, native TLS Redis, and B2 runtime storage.

AgencyOS requires ordinary PostgreSQL plus the dependencies declared required by runtime policy. Production defaults `REDIS_REQUIRED`, `MINIO_REQUIRED`, and `PRIVATE_FILE_SCANNER_REQUIRED` to true; explicitly set a flag to `0` only for an intentional degraded deployment. PostgreSQL may be hosted by Neon, a local/self-hosted server, or another compatible provider. No Supabase service or CLI is required.

Build and publish one immutable application image:

```bash
podman build --pull=always --format=oci -f Containerfile -t registry.example.com/agencyos:0.1.0 .
podman push --digestfile agencyos-image-digest.txt registry.example.com/agencyos:0.1.0
printf '%s@%s\n' registry.example.com/agencyos "$(tr -d '\n' < agencyos-image-digest.txt)"
```

Set `AGENCYOS_IMAGE` to the resulting digest, keep runtime secrets in a private `.env.production`, and configure:

- `DATABASE_URL`: normal application connection; a provider pooler is allowed.
- `DATABASE_ADMIN_URL`: direct/non-pooled PostgreSQL connection for migrations, tests, and restore/copy operations.
- `AUTH_ENCRYPTION_KEY`: stable 32-byte key for AgencyOS-owned TOTP factors.
- `CRM_CONNECTOR_ENCRYPTION_KEY`: stable key that decodes to exactly 32 bytes while connector credentials exist.
- `INTERNAL_WORKER_SECRET`: at least 32 characters; protects worker, operator-status, and metrics boundaries.
- `AUDIT_PIPELINE_ALERT_WEBHOOK_URL` and `AUDIT_PIPELINE_ALERT_WEBHOOK_SECRET`: required, independent out-of-band audit-pipeline alert destination. The URL must be HTTPS without embedded credentials; use a distinct bearer secret of at least 32 characters.
- `INTERNAL_APP_URL`: private worker-to-web address such as `http://app:3000`; keep `APP_URL` as the public HTTPS origin.

Run the forward-only database gate before replacing application processes:

```bash
npm ci
npm run db:status
npm run db:migrate
npm run db:doctor
npm run db:test
AGENCYOS_IMAGE=registry.example.com/agencyos@sha256:REPLACE_ME \
  podman-compose --project-name agencyos-production -f compose.production.yaml up -d
```

The manifest runs independent web and worker processes, waits for dependency-aware readiness, uses restart supervision, and puts a buffering 28 MiB ingress limit in front of all route handlers. Terminate TLS at the load balancer in front of loopback port 8080. The bundled Nginx configuration canonicalizes forwarded IP/protocol headers; if a CDN or load balancer is placed in front of Nginx, configure Nginx `real_ip` with only that provider's trusted CIDRs so `$remote_addr` represents the actual client before relying on IP-based security signals.

Use `/api/health/live` for liveness and `/api/health/ready` for the load balancer. `/api/health/status` and `/api/metrics` require `Authorization: Bearer <INTERNAL_WORKER_SECRET>` and are intended only for trusted operator/monitoring access.

Container resource controls default to 2 GiB memory, 2 CPUs, and 256 PIDs for app/worker services. Override them at Compose interpolation time with `AGENCYOS_MEMORY_LIMIT`, `AGENCYOS_CPU_LIMIT`, and `AGENCYOS_PIDS_LIMIT` after load testing; the gateway has a separate 256 MiB/1 CPU/128 PID cap.

Back up PostgreSQL and every MinIO bucket before migrations. Use provider snapshots or `pg_dump --format=custom` for PostgreSQL and a version-pinned MinIO client to mirror all buckets into encrypted, access-controlled, off-host storage. Record checksums, retain at least one immutable copy, and test both restores in an isolated environment on a schedule. Do not continue a deployment when either backup or restore verification is stale.

The GitHub Release Gate verifies the reviewed framework floor and dependency audit, runs the full
release suite, then builds and pushes the application image once with Podman. GitHub's official
attestation action signs both SLSA provenance and the npm-generated SPDX SBOM for the pushed image.
Promote the emitted `name@sha256:...` value between environments; do not rebuild source separately
for production.
