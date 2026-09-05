import { type NextRequest, NextResponse } from "next/server";

import {
  IDENTITY_SESSION_COOKIE,
  parseIdentitySessionToken,
} from "@/integrations/auth/session-token";
import { handlesOwnApiAuthentication } from "@/lib/server/self-authenticated-api-paths";

const publicPaths = new Set([
  "/access-denied",
  "/auth/confirm",
  "/forgot-password",
  "/login",
  "/mfa",
  "/pending-access",
  "/reset-password",
  "/signup",
]);

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function hasAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestOrigin = request.nextUrl.origin;
    const configuredOrigin = new URL(process.env.APP_URL ?? requestOrigin).origin;
    return origin === requestOrigin || origin === configuredOrigin;
  } catch {
    return false;
  }
}

export async function updateIdentitySession(
  request: NextRequest,
  requestHeaders = new Headers(request.headers),
) {
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const sessionToken = parseIdentitySessionToken(
    request.cookies.get(IDENTITY_SESSION_COOKIE)?.value,
  );
  const hasSessionCookie = Boolean(sessionToken);
  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.has(pathname);
  const handlesOwnAuthentication = handlesOwnApiAuthentication(pathname, request.method);

  if (
    pathname.startsWith("/api/") &&
    isUnsafeMethod(request.method) &&
    !handlesOwnAuthentication &&
    !hasAllowedOrigin(request)
  ) {
    return NextResponse.json(
      { error: "cross-origin-request-rejected" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  // Proxy performs only the cheap cookie-shape gate. Every protected page and
  // API mutation revalidates the opaque session against PostgreSQL through the
  // normal authorization boundary, so a forged cookie never grants access.
  if (!hasSessionCookie && !isPublicPath && !handlesOwnAuthentication) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(loginUrl);
    redirectResponse.headers.set("Cache-Control", "private, no-store");
    return redirectResponse;
  }

  return response;
}
