import { NextResponse } from "next/server";

import { hasValidBearerSecret } from "@/lib/server/bearer-auth";
import {
  checkDatabase,
  checkMinio,
  checkPrivateFileScanner,
  checkRedis,
} from "@/lib/server/dependency-health";
import { getRuntimeDependencyPolicy } from "@/lib/validation/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32 || !hasValidBearerSecret(request, secret)) {
    return NextResponse.json(
      { status: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const [database, redis, minio, scanner] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkMinio(),
    checkPrivateFileScanner(),
  ]);
  const required = getRuntimeDependencyPolicy();
  const healthy =
    database.status === "ok" &&
    (!required.redisRequired || redis.status === "ok") &&
    (!required.minioRequired || minio.status === "ok") &&
    (!required.privateFileScannerRequired || scanner.status === "ok");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      dependencies: { database, redis, minio, scanner },
      required,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
