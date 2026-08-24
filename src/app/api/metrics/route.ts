import { hasValidBearerSecret } from "@/lib/server/bearer-auth";
import { renderPrometheusMetrics } from "@/lib/server/runtime-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.INTERNAL_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32 || !hasValidBearerSecret(request, secret)) {
    return new Response("Unauthorized.\n", {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(renderPrometheusMetrics(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
