import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertImmutableImage,
  deployCoolify,
  deploymentState,
  deploymentUuid,
} from "../../scripts/release/deploy-coolify.mjs";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("Coolify deployment contract", () => {
  it("ships the complete private persistent stack without host-published ports", () => {
    const compose = source("compose.coolify.yaml");
    for (const service of [
      "postgres",
      "redis",
      "minio",
      "clamav",
      "bootstrap",
      "vaultwarden",
      "predeploy-backup",
      "migrate",
      "app",
      "worker",
      "gateway",
      "backup",
      "backup-maintenance",
    ]) {
      expect(compose).toContain(`  ${service}:`);
    }
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("condition: service_completed_successfully");
    for (const suffix of [
      "postgres-v1",
      "redis-v1",
      "minio-v1",
      "clamav-signatures-v1",
      "vaultwarden-v1",
      "backup-state-v1",
      "restic-cache-v1",
      "backup-stage-v1",
    ]) {
      expect(compose).toContain(`\${AGENCYOS_VOLUME_PREFIX:-agencyos-production}-${suffix}`);
    }
  });

  it("requires immutable release images and pins all bundled external images", () => {
    const compose = source("compose.coolify.yaml");
    expect(compose).toContain(
      "AGENCYOS_IMAGE:?Set AGENCYOS_IMAGE to an immutable application digest",
    );
    expect(compose).toContain("AGENCYOS_OPERATIONS_IMAGE:?Set AGENCYOS_OPERATIONS_IMAGE");
    for (const line of compose.split(/\r?\n/)) {
      const image = line.match(/^\s+image:\s+([^$\s][^\s]*)$/)?.[1];
      if (image) expect(image).toContain("@sha256:");
    }
    const operations = source("Containerfile.operations");
    expect(operations).toContain("restic/restic:0.18.1@sha256:");
    expect(operations).toContain("minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:");
  });

  it("keeps writer credentials out of the maintenance service declaration", () => {
    const maintenance = source("compose.coolify.yaml").split("  backup-maintenance:")[1];
    expect(maintenance).toContain("B2_MAINTENANCE_KEY_ID");
    expect(maintenance).not.toContain("B2_WRITER_KEY_ID");
  });

  it("accepts only immutable image references and known Coolify response shapes", () => {
    expect(
      assertImmutableImage(`ghcr.io/acme/agencyos@sha256:${"a".repeat(64)}`, "image"),
    ).toContain("@sha256:");
    expect(() => assertImmutableImage("ghcr.io/acme/agencyos:latest", "image")).toThrow();
    expect(deploymentUuid({ deployment_uuid: "deployment_12345" })).toBe("deployment_12345");
    expect(deploymentUuid({ deployments: [{ uuid: "deployment_67890" }] })).toBe(
      "deployment_67890",
    );
    expect(deploymentState({ status: "finished" })).toBe("succeeded");
    expect(deploymentState({ deployment: { status: "failed" } })).toBe("failed");
  });

  it("does not request a deployment when digest read-back differs", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/envs") && calls.filter((entry) => entry.endsWith("/envs")).length <= 3) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([{ key: "AGENCYOS_IMAGE", value: "wrong" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await expect(
      deployCoolify({
        environment: {
          COOLIFY_BASE_URL: "https://coolify.example.test",
          COOLIFY_API_TOKEN: "secret",
          COOLIFY_APPLICATION_UUID: "application_12345",
          AGENCYOS_IMAGE: `ghcr.io/acme/app@sha256:${"a".repeat(64)}`,
          AGENCYOS_OPERATIONS_IMAGE: `ghcr.io/acme/ops@sha256:${"b".repeat(64)}`,
          AGENCYOS_RELEASE_ID: "release-1",
          PRODUCTION_APP_URL: "https://agency.example.test",
        },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("did not persist the exact AGENCYOS_IMAGE");
    expect(calls.some((url) => url.endsWith("/api/v1/deploy"))).toBe(false);
  });

  it("keeps ordinary pushes non-deploying and requires explicit manual confirmation", () => {
    const workflow = source(".github/workflows/release.yml");
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).not.toMatch(/push:\n\s+branches:/);
    expect(workflow).toContain('test "$CONFIRM" = "DEPLOY"');
    expect(workflow).toContain("scripts/release/deploy-coolify.mjs");
  });
});
