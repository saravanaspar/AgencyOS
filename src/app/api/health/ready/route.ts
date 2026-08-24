import { NextResponse } from "next/server";

import {
  checkDatabase,
  checkMinio,
  checkPrivateFileScanner,
  checkRedis,
  type DependencyCheck,
} from "@/lib/server/dependency-health";
import { structuredLog } from "@/lib/server/observability";
import { getRuntimeDependencyPolicy, validateProductionEnvironment } from "@/lib/validation/env";

export const dynamic = "force-dynamic";

function configurationCheck(): DependencyCheck {
  try {
    validateProductionEnvironment();
    return { status: "ok" };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.name : "invalid" };
  }
}

export async function GET() {
  const policy = getRuntimeDependencyPolicy();
  const [database, redis, minio, scanner] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkMinio(),
    checkPrivateFileScanner(),
  ]);
  const configuration = configurationCheck();
  const checks = { configuration, database, redis, minio, scanner };
  const required = [configuration, database];
  if (policy.redisRequired) required.push(redis);
  if (policy.minioRequired) required.push(minio);
  if (policy.privateFileScannerRequired) required.push(scanner);
  const ready = required.every((check) => check.status === "ok");

  if (!ready) {
    structuredLog("warn", "health.readiness.failed", {
      checks,
      required: policy,
    });
  }

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks,
      required: policy,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
