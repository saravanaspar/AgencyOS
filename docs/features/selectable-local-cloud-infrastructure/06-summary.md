# Delivery summary: selectable local or cloud infrastructure

AgencyOS can now be deployed from Coolify in either of two explicit modes:

- `compose.coolify.yaml` keeps PostgreSQL, Redis, and MinIO on the VPS with the existing volume
  identities.
- `compose.coolify.cloud.yaml` removes those three local services and uses Neon-compatible
  PostgreSQL, authenticated native Upstash-compatible Redis TLS, and a mutable B2 runtime bucket.

Both modes retain ClamAV, Vaultwarden, automatic pre-deploy backups, forward-only migrations,
worker/gateway startup gates, scheduled backups, and maintenance. Backups include AgencyOS
PostgreSQL, Vaultwarden PostgreSQL, all four logical runtime object locations (MinIO or B2), and
Vaultwarden files. Redis remains excluded because its cache and coordination data are
reconstructible.

The default local Restic snapshot selection is exactly 7 daily, 4 weekly, 12 monthly, and 1 yearly.
The remote B2 repository is encrypted, deduplicated, append-only, and intentionally not
automatically pruned; Object Lock protects uploaded data according to the bucket policy.

Use `docs/COOLIFY.md` for deployment and `docs/BACKUP_RECOVERY.md` for provider permissions,
retention semantics, and isolated restoration. A real disposable-provider staging gate remains
mandatory before storing irreplaceable production data.
