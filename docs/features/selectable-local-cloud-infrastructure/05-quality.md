# Quality report: selectable local or cloud infrastructure

## Verdict

Implementation review blockers are resolved. The change is ready for a disposable provider and
Coolify staging gate, but cannot be called live-production verified without real Neon, Upstash,
B2, GHCR, DNS, TLS, and Coolify credentials.

## Review closure

- P1: B2 capture no longer invokes MinIO cluster health; a behavior test covers this path.
- P1: Neon pooled/direct URLs are paired by normalized endpoint and database identity; different
  projects or databases are rejected.
- P1: remote recovery PostgreSQL URLs require `sslmode=require`, `verify-ca`, or `verify-full`.
- P2: recovery validates both empty databases, all object targets, and the Vaultwarden destination
  before the first database restore command.
- P2: object-storage probes use bounded agents/deadlines and cleanup cannot mask the probe error.
- P2: behavior coverage now executes B2 capture, retention, and schema-v1/v2 restore preparation.
- P2: `compose.production.yaml` defaults to local mode for backward compatibility.
- P3: the Coolify runbook now documents distinct local and cloud gate sequences.

## Automated results

- Focused infrastructure suite: 7 files, 48 tests passed.
- Full Vitest suite: 140 files; 674 passed and 3 Chromium-backed PDF tests failed to launch a
  browser under this workspace's unsupported Node 24 runtime.
- Formatting, ESLint, TypeScript, framework baseline, supply-chain pinning, tenant-scope audit,
  mutation-boundary audit, sensitive-content audit, complexity budget, and migration validation:
  passed.
- YAML parse/graph checks: local 13 services/10 volumes; cloud 10 services/7 volumes; no dangling
  cloud dependencies or local data-plane services in cloud mode.
- Local Next.js build: blocked by the same Node 24 runtime with `uv_resident_set_memory`. The release
  workflow runs the production build and Chromium smoke tests in the pinned Node 22 container.

## Required staging evidence

- Build and publish both immutable images from the protected release workflow.
- Prove the B2 runtime and backup keys have the documented least privileges and distinct buckets.
- Complete first and repeat deploys against disposable Neon, Upstash, B2, and Coolify resources.
- Prove a preflight or backup failure blocks migration and application replacement.
- Complete an isolated restore of both databases, all four logical object locations, and
  Vaultwarden files, then verify the restored application.
