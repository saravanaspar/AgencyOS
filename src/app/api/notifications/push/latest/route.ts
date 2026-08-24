import { NextResponse } from "next/server";

import { latestUnreadPushNotification } from "@/modules/notifications/server/delivery-queue";
import { notificationPermissionKeys } from "@/modules/notifications/server/notifications";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function GET() {
  const authorization = await authorizeCurrentUser([notificationPermissionKeys.view]);
  if (!authorization.allowed) {
    return NextResponse.json(
      { ok: false },
      { status: authorizationStatus(authorization.reason), headers: noStoreHeaders },
    );
  }
  try {
    const notification = await latestUnreadPushNotification(authorization.context);
    return NextResponse.json({ ok: true, notification }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: noStoreHeaders });
  }
}
