import { NextResponse } from "next/server";

import { readBoundedRequestJson } from "@/lib/server/bounded-request";
import { crmConnectionIdSchema, crmWebhookPayloadSchema } from "@/modules/crm/schemas/imports";
import { processCrmWebhook, verifyMetaWebhook } from "@/modules/crm/server/imports";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const parsedParams = crmConnectionIdSchema.safeParse(await context.params);
  if (!parsedParams.success) return new NextResponse("Verification failed", { status: 403 });
  const { connectionId } = parsedParams.data;
  const url = new URL(request.url);
  try {
    const challenge = await verifyMetaWebhook(
      connectionId,
      url.searchParams.get("hub.mode"),
      url.searchParams.get("hub.verify_token"),
      url.searchParams.get("hub.challenge"),
    );
    if (!challenge) return new NextResponse("Verification failed", { status: 403 });
    return new NextResponse(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new NextResponse("Verification failed", { status: 403 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = crmConnectionIdSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { accepted: false, message: "Webhook rejected." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const { connectionId } = parsedParams.data;
  try {
    const bounded = await readBoundedRequestJson(request, 512 * 1024);
    if (!bounded.ok) {
      return NextResponse.json(
        {
          accepted: false,
          message:
            bounded.status === 413
              ? "Webhook payload exceeded 512 KB."
              : bounded.status === 411
                ? "Webhook Content-Length header is invalid."
                : "Webhook payload is invalid.",
        },
        { status: bounded.status, headers: { "cache-control": "no-store" } },
      );
    }
    const parsedPayload = crmWebhookPayloadSchema.safeParse(bounded.value);
    if (!parsedPayload.success) {
      return NextResponse.json(
        { accepted: false, message: "Webhook rejected." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const outcomes = await processCrmWebhook(connectionId, bounded.text, request.headers);
    return NextResponse.json(
      { accepted: true, imports: outcomes },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { accepted: false, message: "Webhook rejected." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
