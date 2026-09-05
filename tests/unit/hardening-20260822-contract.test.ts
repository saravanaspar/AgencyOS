import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { trustedClientIp } from "@/lib/server/request-context";

const root = process.cwd();
const source = (file: string) => readFileSync(join(root, file), "utf8");

describe("August 2026 production hardening contracts", () => {
  it("uses a trusted-edge client IP model instead of attacker-controlled left-most XFF", () => {
    expect(
      trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" })),
    ).toBeNull();
    expect(
      trustedClientIp(
        new Headers({ "x-real-ip": "192.0.2.44", "x-forwarded-for": "203.0.113.9, 198.51.100.7" }),
      ),
    ).toBe("192.0.2.44");
    const nginx = source("deploy/nginx/agencyos.conf");
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr");
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
  });

  it("disables JavaScript and file-scheme access in PDF rendering", () => {
    const renderer = source("src/lib/server/html-to-pdf.ts");
    expect(renderer).toContain("setJavaScriptEnabled(false)");
    expect(renderer).not.toContain('url.startsWith("file:")');
    expect(renderer).toContain('request.abort("blockedbyclient")');
  });

  it("ships fail-closed AI egress governance and metadata-only provider evidence", () => {
    const migration = source("database/migrations/20260822006200_ai_governance_policy.sql");
    const governance = source("src/modules/ai/server/governance.ts");
    const agent = source("src/modules/ai/server/agent.ts");
    expect(migration).toContain("enabled boolean not null default false");
    expect(migration).toContain("external_data_egress_enabled boolean not null default false");
    expect(migration).toContain("automation_ai_provider_events");
    expect(migration).toContain(
      "Prompts, tool payloads, credentials, and model output are never stored",
    );
    expect(governance).toContain("requireCurrentAiGovernance");
    expect(governance).toContain("filterToolsForAiPolicy");
    expect(agent).toContain("requireCurrentAiGovernance(input.provider)");
  });

  it("enforces immutable CI and image inputs and build-once release provenance", () => {
    const supplyChain = source("scripts/security/verify-supply-chain.mjs");
    const release = source(".github/workflows/release.yml");
    const containerfile = source("Containerfile");
    expect(supplyChain).toContain("40-character commit SHA");
    expect(containerfile).toContain("node:22.23.2-bookworm-slim@sha256:");
    for (const chromiumRuntimeLibrary of ["libexpat1", "libnspr4", "libnss3"]) {
      expect(containerfile).toContain(chromiumRuntimeLibrary);
    }
    expect(containerfile).toContain("--no-install-recommends");
    expect(release).toContain("podman build");
    expect(release).toContain("podman push");
    expect(release).toContain("npm sbom --omit=dev --sbom-format spdx");
    expect(release).toContain("actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6");
    expect(release).toContain("subject-digest: ${{ steps.images.outputs.app_digest }}");
    expect(release).toContain("subject-digest: ${{ steps.images.outputs.operations_digest }}");
  });

  it("runs local dependencies and production containers through Podman", () => {
    const packageJson = JSON.parse(source("package.json"));
    const scripts = packageJson.scripts as Record<string, string>;
    for (const name of [
      "db:start",
      "redis:start",
      "storage:start",
      "scanner:start",
      "dependencies:start",
      "container:build",
      "production:start",
    ]) {
      expect(scripts[name]).toContain("podman");
    }
    expect(source("compose.database.yaml")).toContain("Containerfile.postgres");
    expect(source("Containerfile.postgres")).toContain("postgresql-17-pgtap");
    expect(source("compose.redis.yaml")).toContain("127.0.0.1:${AGENCYOS_REDIS_PORT:-6379}");
    expect(source("compose.object-storage.yaml")).toContain("127.0.0.1:9000:9000");
    expect(source("compose.object-storage.yaml")).toContain("minio/minio:");
    expect(source("compose.object-storage.yaml")).toContain("@sha256:");
    expect(source("compose.scanner.yaml")).toContain("127.0.0.1:3310:3310");
    expect(source("compose.scanner.yaml")).toContain("clamav/clamav:");
    expect(source("compose.scanner.yaml")).toContain("@sha256:");
    expect(source("compose.production.yaml")).toContain(":ro,Z");
  });

  it("makes authenticated browser coverage part of PR CI", () => {
    const workflow = source(".github/workflows/react-doctor.yml");
    const postgresContainer = source("Containerfile.postgres");
    const redisCompose = source("compose.redis.yaml");
    expect(workflow).toContain("authenticated-e2e:");
    expect(workflow).toContain("podman-compose");
    expect(postgresContainer).toContain("postgres:17.10-bookworm@sha256:");
    expect(redisCompose).toContain("redis:7.4.10-alpine@sha256:");
    expect(workflow).toContain("npm run db:migrate");
    expect(workflow).toContain("npm run db:test");
    expect(workflow).toContain("npm run test:e2e:seed");
    expect(workflow).toContain('AGENCYOS_E2E_CONFIRM_ISOLATED: "1"');
  });

  it("keeps observability private and machine-readable", () => {
    const proxy = source("src/proxy.ts");
    const metrics = source("src/app/api/metrics/route.ts");
    const logger = source("src/lib/server/observability.ts");
    expect(proxy).toContain('requestHeaders.set("x-request-id", requestId)');
    expect(proxy).toContain('response.headers.set("X-Request-ID", requestId)');
    expect(metrics).toContain("hasValidBearerSecret");
    expect(metrics).toContain("renderPrometheusMetrics");
    const selfAuthenticated = source("src/lib/server/self-authenticated-api-paths.ts");
    expect(selfAuthenticated).toContain('["/api/health/live", new Set(["GET"])]');
    expect(selfAuthenticated).toContain('["/api/health/ready", new Set(["GET"])]');
    const dependencyHealth = source("src/lib/server/dependency-health.ts");
    expect(dependencyHealth).toContain('"x-agencyos-health-check": "1"');
    expect(dependencyHealth).toContain('parsed.verdict !== "clean"');
    expect(logger).toContain("JSON.stringify");
  });

  it("prevents new self-managed migration transactions", () => {
    const validator = source("scripts/database/validate-migrations.mjs");
    const runner = source("scripts/database/migrate.mjs");
    const recovery = source("scripts/database/legacy-migration-recovery.mjs");
    expect(validator).toContain("legacySelfManagedMigrationNames");
    expect(runner).toContain("inspectLegacySelfManagedMigration");
    expect(recovery).toContain("20260718005300");
    expect(recovery).toContain("20260722005500");
  });

  it("blocks unreviewed tenant-scope and complexity growth", () => {
    expect(source("scripts/security/audit-tenant-scope.mjs")).toContain(
      "Tenant-scope audit failed",
    );
    expect(source("scripts/quality/check-complexity-budget.mjs")).toContain(
      "Complexity budget failed",
    );
    const worker = source("scripts/workers/run.mjs");
    expect(worker).toContain("INTERNAL_APP_URL is required for the production worker process.");
    const packageJson = JSON.parse(source("package.json"));
    expect(packageJson.scripts.check).toContain("security:tenant-scope");
    expect(packageJson.scripts.check).toContain("quality:complexity");
  });
});
