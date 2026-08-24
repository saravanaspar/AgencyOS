import { NextRequest, NextResponse } from "next/server";

import { getRequestSecurityContext } from "@/lib/server/request-context";
import { createIdentitySession, identityRequiresMfa } from "@/modules/identity/server/auth-session";
import { getSafeNextPath } from "@/modules/identity/schemas/auth";
import { consumeIdentityVerificationToken } from "@/modules/identity/server/verification-token";
import { getDatabaseClient } from "@/integrations/postgres/database";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const purpose = request.nextUrl.searchParams.get("purpose");
  const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next") ?? "/pending-access");

  if (purpose !== "email_verification") {
    return NextResponse.redirect(new URL("/login?error=invalid-confirmation", request.url));
  }

  const identity = await consumeIdentityVerificationToken(token, "email_verification");
  if (!identity) {
    return NextResponse.redirect(new URL("/login?error=invalid-confirmation", request.url));
  }

  const database = getDatabaseClient();
  await database`
    update public.identity_accounts
    set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now(), last_seen_at = now()
    where id = ${identity.userId}::uuid
  `;

  const securityContext = await getRequestSecurityContext();
  const requiresMfa = await identityRequiresMfa(identity.userId);
  await createIdentitySession({
    userId: identity.userId,
    status: requiresMfa ? "pending_mfa" : "active",
    request: securityContext,
  });

  const destination = requiresMfa ? `/mfa?next=${encodeURIComponent(nextPath)}` : nextPath;
  return NextResponse.redirect(new URL(destination, request.url));
}
