import "server-only";

import { createHash } from "node:crypto";

import { getMinioClient } from "@/integrations/minio/object-storage";
import { objectStorageConfiguration } from "@/integrations/object-storage/config.mjs";
import { getRedisClient } from "@/integrations/redis/client";
import { scanBufferWithClamav } from "@/integrations/clamav/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { readBoundedResponseText } from "@/lib/server/bounded-response";
import { getPrivateFileScanConfiguration } from "@/modules/private-files/server/scan-config";

export type DependencyStatus = "ok" | "failed" | "not_configured";
export interface DependencyCheck {
  status: DependencyStatus;
  detail?: string;
  latencyMs?: number;
}

async function timedCheck(operation: () => Promise<void>): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3_000)),
    ]);
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.name : "unavailable",
      latencyMs: Date.now() - startedAt,
    };
  }
}

export function checkDatabase(): Promise<DependencyCheck> {
  return timedCheck(async () => {
    const database = getDatabaseClient();
    await database`select 1 as ready`;
  });
}

export async function checkRedis(): Promise<DependencyCheck> {
  const client = await getRedisClient().catch(() => null);
  if (!client) return { status: "not_configured" };
  return timedCheck(async () => {
    await client.ping();
  });
}

export function checkMinio(): Promise<DependencyCheck> {
  if (!process.env.MINIO_ENDPOINT?.trim() && !process.env.OBJECT_STORAGE_ENDPOINT?.trim()) {
    return Promise.resolve({ status: "not_configured" });
  }
  return timedCheck(async () => {
    const configuration = objectStorageConfiguration();
    const buckets = [...new Set(configuration.locations.map((location) => location.bucket))];
    for (const bucket of buckets) {
      if (!(await getMinioClient().bucketExists(bucket))) {
        throw new Error("object_storage_bucket_unavailable");
      }
    }
  });
}

export async function checkPrivateFileScanner(): Promise<DependencyCheck> {
  const configuration = getPrivateFileScanConfiguration();
  if (!configuration.configured || !configuration.provider || !configuration.scannerUrl) {
    return { status: "not_configured" };
  }

  if (configuration.provider === "clamav") {
    const endpoint = new URL(configuration.scannerUrl);
    return timedCheck(async () => {
      await scanBufferWithClamav({
        host: endpoint.hostname.replace(/^\[|\]$/g, ""),
        port: Number(endpoint.port || 3310),
        buffer: Buffer.alloc(0),
        timeoutMs: 2_000,
        maxResponseBytes: 4_096,
      });
    });
  }

  if (!configuration.scannerBearerToken) return { status: "not_configured" };

  return timedCheck(async () => {
    const empty = Buffer.alloc(0);
    const response = await fetch(configuration.scannerUrl!, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        authorization: `Bearer ${configuration.scannerBearerToken}`,
        "content-type": "application/octet-stream",
        "content-length": "0",
        "x-agencyos-file-id": "00000000-0000-4000-8000-000000000000",
        "x-agencyos-file-sha256": createHash("sha256").update(empty).digest("hex"),
        "x-agencyos-file-mime": "application/octet-stream",
        "x-agencyos-health-check": "1",
      },
      body: new Uint8Array(empty),
      signal: AbortSignal.timeout(2_500),
    });
    const text = await readBoundedResponseText(
      response,
      4_096,
      "Scanner health response exceeded the safe limit.",
    );
    if (!response.ok) throw new Error(`scanner_http_${response.status}`);
    const parsed = JSON.parse(text) as { verdict?: unknown };
    if (parsed.verdict !== "clean") throw new Error("scanner_health_invalid_verdict");
  });
}
