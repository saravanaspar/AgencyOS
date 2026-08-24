import type { NextRequest } from "next/server";

import { updateIdentitySession } from "@/integrations/auth/proxy";
import { createContentSecurityPolicy } from "@/lib/server/content-security-policy";

function requestCorrelationId(request: NextRequest): string {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const requestId = requestCorrelationId(request);
  const contentSecurityPolicy = createContentSecurityPolicy({ nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = await updateIdentitySession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Request-ID", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
