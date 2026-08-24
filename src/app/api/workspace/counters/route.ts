import { NextResponse } from "next/server";

import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function GET() {
  const access = await getCurrentPermissionContext();
  if (!access.allowed) {
    const status =
      access.reason === "signed-out" ||
      access.reason === "session-expired" ||
      access.reason === "session-revoked"
        ? 401
        : access.reason === "access-check-failed"
          ? 503
          : 403;
    return NextResponse.json({ ok: false }, { status, headers: noStoreHeaders });
  }

  return NextResponse.json(
    {
      unreadNotificationCount: access.context.unreadNotificationCount,
      pendingApprovalCount: access.context.pendingApprovalCount,
    },
    { headers: noStoreHeaders },
  );
}
