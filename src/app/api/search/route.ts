import { NextResponse } from "next/server";

import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";
import { searchAuthorizedRecords } from "@/modules/search/server/search";

export async function GET(request: Request) {
  const authorization = await authorizeCurrentUser([]);
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.reason },
      {
        status: authorizationStatus(authorization.reason),
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const rateAllowed = await authorizedRateLimitAllows({
    kind: "api",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!rateAllowed) {
    return NextResponse.json(
      { error: "rate-limit-exceeded" },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "30", 10);
  const result = await searchAuthorizedRecords(query, Number.isFinite(limit) ? limit : 30);
  if (!result.allowed) {
    return NextResponse.json(
      { error: result.reason },
      {
        status: authorizationStatus(result.reason),
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
