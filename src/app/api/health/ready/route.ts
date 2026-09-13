import { NextResponse } from "next/server";

import {
  checkDatabase,
  checkObjectStorage,
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
  const [database, redis, objectStorage, scanner] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkObjectStorage(),
    checkPrivateFileScanner(),
  ]);
  const configuration = configurationCheck();
  const checks = { configuration, database, redis, objectStorage, scanner };
  const required = [configuration, database];
  if (policy.redisRequired) required.push(redis);
  if (policy.objectStorageRequired) required.push(objectStorage);
  if (policy.privateFileScannerRequired) required.push(scanner);
  const ready = required.every((check) => check.status === "ok");

  if (!ready) {
    structuredLog("warn", "health.readiness.failed", {
      checks,
      required: policy,
    });
  }

  return NextResponse.json(
    { status: ready ? "ready" : "not_ready" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
