import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";

export interface RequestSecurityContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

function validAddress(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

function boundedHeader(value: string | null, maximum: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

/**
 * Trust only the canonical client address written by the deployment edge.
 * Raw X-Forwarded-For is intentionally ignored because its trust semantics depend
 * on proxy topology and can include attacker-supplied hops.
 */
export function trustedClientIp(requestHeaders: Pick<Headers, "get">): string | null {
  return validAddress(requestHeaders.get("x-real-ip"));
}

export async function getRequestSecurityContext(): Promise<RequestSecurityContext> {
  const requestHeaders = await headers();
  return {
    ipAddress: trustedClientIp(requestHeaders),
    userAgent: boundedHeader(requestHeaders.get("user-agent"), 500),
    requestId: boundedHeader(
      requestHeaders.get("x-request-id") ?? requestHeaders.get("x-vercel-id"),
      200,
    ),
  };
}

export function getRequestSecurityContextFromRequest(request: Request): RequestSecurityContext {
  return {
    ipAddress: trustedClientIp(request.headers),
    userAgent: boundedHeader(request.headers.get("user-agent"), 500),
    requestId: boundedHeader(
      request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id"),
      200,
    ),
  };
}

export function hashSecurityIdentity(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
