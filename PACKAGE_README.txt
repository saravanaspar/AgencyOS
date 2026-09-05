AgencyOS changed-files overlay

Extract these files into the ROOT of the same AgencyOS project you uploaded, preserving paths and allowing replacement. Make a local copy first. No file deletions are required. This ZIP excludes Git history, dependencies, build output and real environment secrets. It includes every change made in this task relative to your original uploaded archive, not your earlier uncommitted changes (those are already in your original project).

Read docs/COOLIFY.md for setup and docs/BACKUP_RECOVERY.md for backups and recovery. Exact validation: docs/features/coolify-production/05-quality.md. Review and commit the full tree before running npm run release:production -- v1.0.0.

Local checks pass; 655 of 658 tests pass. Three Chromium launch tests and the production build require the supported Node 22/container environment. No VPS or B2 deployment was performed. Live Coolify, Object Lock and restore testing are still required. Remote backup pruning is disabled; old B2 snapshots/packs remain until a validated off-host retention procedure is available.

CHANGES.json records the original archive SHA-256 and hashes for each replacement/addition.
