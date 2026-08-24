import "server-only";

import { getApplicationEnv } from "@/lib/validation/env";

export function isAllowedApplicationOrigin(
  request: Request,
  options: { requireOrigin?: boolean } = {},
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return !options.requireOrigin;

  try {
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = new URL(getApplicationEnv().appUrl).origin;
    return origin === requestOrigin || origin === configuredOrigin;
  } catch {
    return false;
  }
}
