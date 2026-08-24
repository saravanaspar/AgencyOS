import { NextResponse } from "next/server";
import { z } from "zod";

import { readBoundedRequestText } from "@/lib/server/bounded-request";
import { runInternalWorkerRequest } from "@/lib/server/internal-worker";
import {
  getInternalWorkerDefinition,
  internalWorkerJobKeys,
} from "@/modules/workers/server/worker-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({ job: z.enum(internalWorkerJobKeys) });
const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    return NextResponse.json(
      { ok: false, message: "Content-Type must be application/json." },
      { status: 415, headers: noStoreHeaders },
    );
  }

  const bounded = await readBoundedRequestText(request, 2 * 1024, { requireContentLength: true });
  if (!bounded.ok) {
    return NextResponse.json(
      {
        ok: false,
        message:
          bounded.status === 411
            ? "A bounded Content-Length header is required."
            : "Worker request payload is too large.",
      },
      { status: bounded.status, headers: noStoreHeaders },
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(bounded.text) as unknown;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Worker request JSON is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const parsed = requestSchema.safeParse(decoded);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Worker job is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const definition = getInternalWorkerDefinition(parsed.data.job);
  return runInternalWorkerRequest({
    request,
    secret: process.env.INTERNAL_WORKER_SECRET,
    leaseName: definition.leaseName,
    execute: definition.execute,
    ready: definition.ready,
    notConfiguredMessage: definition.notConfiguredMessage,
    notReadyMessage: definition.notReadyMessage,
    unavailableMessage: definition.unavailableMessage,
  });
}
