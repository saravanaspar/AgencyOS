import { NextResponse } from "next/server";

import { completeCrmOAuthAuthorization } from "@/modules/crm/server/imports";
import { isCrmOAuthProvider } from "@/modules/crm/server/crm-oauth";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreRedirect(destination: URL | string) {
  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser(["crm.connection.manage"]);
  if (!authorization.allowed) {
    return noStoreRedirect(new URL("/access-denied", request.url));
  }

  const url = new URL(request.url);
  const { provider } = await context.params;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");
  if (!isCrmOAuthProvider(provider) || !state || !code || denied) {
    return noStoreRedirect(new URL("/crm?tab=imports&oauth=cancelled", request.url));
  }

  try {
    await completeCrmOAuthAuthorization(authorization.context, provider, state, code);
    return noStoreRedirect(new URL("/crm?tab=imports&oauth=connected", request.url));
  } catch {
    return noStoreRedirect(new URL("/crm?tab=imports&oauth=failed", request.url));
  }
}
