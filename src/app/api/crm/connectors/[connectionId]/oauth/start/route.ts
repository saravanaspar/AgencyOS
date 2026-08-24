import { NextResponse } from "next/server";

import { beginCrmOAuthAuthorization } from "@/modules/crm/server/imports";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreRedirect(destination: URL | string) {
  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser(["crm.connection.manage"]);
  if (!authorization.allowed) {
    return noStoreRedirect(new URL("/access-denied", request.url));
  }

  try {
    const { connectionId } = await context.params;
    const destination = await beginCrmOAuthAuthorization(authorization.context, connectionId);
    return noStoreRedirect(destination);
  } catch {
    return noStoreRedirect(new URL("/crm?tab=imports&oauth=configuration-error", request.url));
  }
}
