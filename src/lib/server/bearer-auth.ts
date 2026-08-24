import "server-only";

import { timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidBearerSecret(
  request: Request,
  configuredSecret: string | undefined,
): boolean {
  const configured = configuredSecret?.trim();
  if (!configured) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") && safeEqual(authorization.slice(7), configured);
}
