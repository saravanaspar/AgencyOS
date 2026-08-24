import { NextResponse } from "next/server";
import { z } from "zod";

import { readBoundedRequestJson } from "@/lib/server/bounded-request";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { structuredLog } from "@/lib/server/observability";
import { incrementMetric, observeMetric } from "@/lib/server/runtime-metrics";
import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import { aiProviders } from "@/modules/ai/ai";
import { runAgencyOsAgent } from "@/modules/ai/server/agent";
import { modulePermissionKeys } from "@/modules/permissions/module-access";
import {
  authorizeCurrentUser,
  authorizationStatus,
} from "@/modules/permissions/server/authorization";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  provider: z.enum(aiProviders),
  model: z.string().trim().min(2).max(100),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(12_000),
      }),
    )
    .min(1)
    .max(12),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? "missing";
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 });
  }
  const authorization = await authorizeCurrentUser([modulePermissionKeys.ai]);
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.reason },
      { status: authorizationStatus(authorization.reason) },
    );
  }
  const allowed = await authorizedRateLimitAllows({
    kind: "ai",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "AI requests are temporarily rate limited or the shared limiter is unavailable." },
      { status: 429 },
    );
  }
  const bounded = await readBoundedRequestJson(request, 160_000);
  if (!bounded.ok) {
    return NextResponse.json(
      { error: bounded.status === 413 ? "AI request is too large." : "Invalid AI request." },
      { status: bounded.status === 413 ? 413 : 400 },
    );
  }
  const parsed = requestSchema.safeParse(bounded.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Review the provider, model, and message history." },
      { status: 400 },
    );
  }
  try {
    const result = await runAgencyOsAgent(parsed.data);
    incrementMetric("ai_requests_total", { provider: parsed.data.provider, outcome: "succeeded" });
    observeMetric("ai_request_duration_ms", Date.now() - startedAt, {
      provider: parsed.data.provider,
      outcome: "succeeded",
    });
    structuredLog("info", "ai.request.succeeded", {
      requestId,
      provider: parsed.data.provider,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    incrementMetric("ai_requests_total", { provider: parsed.data.provider, outcome: "failed" });
    observeMetric("ai_request_duration_ms", Date.now() - startedAt, {
      provider: parsed.data.provider,
      outcome: "failed",
    });
    structuredLog("error", "ai.request.failed", {
      requestId,
      provider: parsed.data.provider,
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 500) : "AI request failed." },
      { status: 502 },
    );
  }
}
