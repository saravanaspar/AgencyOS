import "server-only";

import { NextResponse } from "next/server";

import { runWithRedisLease } from "@/integrations/redis/coordination";
import { incrementRedisRateLimit } from "@/integrations/redis/rate-limit";
import { hasValidBearerSecret } from "@/lib/server/bearer-auth";
import { structuredLog } from "@/lib/server/observability";
import { incrementMetric, observeMetric } from "@/lib/server/runtime-metrics";
import {
  getRequestSecurityContextFromRequest,
  hashSecurityIdentity,
} from "@/lib/server/request-context";

const noStoreHeaders = { "cache-control": "no-store" };

export interface InternalWorkerRequestOptions<T> {
  request: Request;
  secret: string | null | undefined;
  leaseName: string;
  execute: () => Promise<T>;
  notConfiguredMessage: string;
  unavailableMessage: string;
  ready?: boolean;
  notReadyMessage?: string;
}

export async function runInternalWorkerRequest<T>(
  options: InternalWorkerRequestOptions<T>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestId = options.request.headers.get("x-request-id") ?? "missing";
  const secret = options.secret?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { ok: false, message: options.notConfiguredMessage },
      { status: 503, headers: noStoreHeaders },
    );
  }
  if (!hasValidBearerSecret(options.request, secret)) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized." },
      { status: 401, headers: noStoreHeaders },
    );
  }
  const requestContext = getRequestSecurityContextFromRequest(options.request);
  const rateIdentity = hashSecurityIdentity(
    `${options.leaseName}:${requestContext.ipAddress ?? "unknown"}:${options.request.headers.get("authorization") ?? "missing"}`,
  );
  const workerLimit = Number.parseInt(
    process.env.SECURITY_WORKER_RATE_LIMIT_PER_MINUTE ?? "120",
    10,
  );
  const rate = await incrementRedisRateLimit(
    "security:internal-worker",
    rateIdentity,
    Number.isSafeInteger(workerLimit) && workerLimit > 0 ? Math.min(workerLimit, 1000) : 120,
    60,
  );
  if (rate.available && !rate.allowed) {
    incrementMetric("internal_worker_requests_total", {
      worker: options.leaseName,
      outcome: "rate_limited",
    });
    return NextResponse.json(
      { ok: false, message: "Worker rate limit exceeded." },
      { status: 429, headers: { ...noStoreHeaders, "retry-after": "60" } },
    );
  }
  if (options.ready === false) {
    return NextResponse.json(
      { ok: false, message: options.notReadyMessage ?? options.notConfiguredMessage },
      { status: 503, headers: noStoreHeaders },
    );
  }

  try {
    const result = await runWithRedisLease(
      { name: `worker:${options.leaseName}`, ttlMs: 65_000 },
      options.execute,
    );
    if (!result.executed) {
      incrementMetric("internal_worker_requests_total", {
        worker: options.leaseName,
        outcome: "already_running",
      });
      observeMetric("internal_worker_duration_ms", Date.now() - startedAt, {
        worker: options.leaseName,
        outcome: "already_running",
      });
      return NextResponse.json(
        { ok: true, skipped: "already-running", coordination: result.coordination },
        { status: 202, headers: noStoreHeaders },
      );
    }
    incrementMetric("internal_worker_requests_total", {
      worker: options.leaseName,
      outcome: "succeeded",
    });
    observeMetric("internal_worker_duration_ms", Date.now() - startedAt, {
      worker: options.leaseName,
      outcome: "succeeded",
    });
    structuredLog("info", "internal_worker.succeeded", {
      requestId,
      worker: options.leaseName,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { ok: true, summary: result.value, coordination: result.coordination },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    incrementMetric("internal_worker_requests_total", {
      worker: options.leaseName,
      outcome: "failed",
    });
    observeMetric("internal_worker_duration_ms", Date.now() - startedAt, {
      worker: options.leaseName,
      outcome: "failed",
    });
    structuredLog("error", "internal_worker.failed", {
      requestId,
      worker: options.leaseName,
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { ok: false, message: options.unavailableMessage },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
