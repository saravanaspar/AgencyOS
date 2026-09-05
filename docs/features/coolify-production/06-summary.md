# Delivery summary

The changed-files package adds the full Coolify Compose stack, stable persistent volumes,
authenticated private services, PostgreSQL-backed Vaultwarden, explicit GitHub production
releases, immutable image handoff, pre-deploy backups and locked migrations, encrypted daily
deduplicated B2 backup publication, health checks and isolated recovery tools.

Read docs/COOLIFY.md for setup and docs/BACKUP_RECOVERY.md for backup/recovery. After committing
the complete project, the explicit release command is:

```bash
npm run release:production -- v1.0.0
```

The ZIP is an overlay onto the exact original uploaded project. Extract into its root, review and
commit all files, including the pre-existing uncommitted project changes. No Git commit, push,
provider account change or actual deployment was performed in this coding session.

Local source checks passed; 655/658 tests passed, with three Chromium launch failures. Production
build and container/provider validation remain blocked by the local runtime and missing access.
Automatic remote backup deletion is deliberately not implemented; encrypted data is deduplicated,
but old remote snapshots/packs are kept until a separately validated retention procedure exists.

See 05-quality.md for exact verification and limits. This is not a production approval certificate.
