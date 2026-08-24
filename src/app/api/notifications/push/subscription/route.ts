import { NextResponse } from "next/server";

import { readBoundedRequestJson } from "@/lib/server/bounded-request";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { notificationPushSubscriptionSchema } from "@/modules/notifications/schemas/notifications";
import {
  revokeNotificationPushSubscriptions,
  saveNotificationPushSubscription,
} from "@/modules/notifications/server/delivery-queue";
import { notificationPermissionKeys } from "@/modules/notifications/server/notifications";
import {
  authorizationStatus,
  authorizeCurrentUser,
} from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store" };
const MAX_REQUEST_BYTES = 8 * 1024;

async function authorizedContext() {
  return authorizeCurrentUser([notificationPermissionKeys.managePreferences]);
}

export async function POST(request: Request) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return NextResponse.json(
      { ok: false, message: "Request origin was not accepted." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  const authorization = await authorizedContext();
  if (!authorization.allowed) {
    return NextResponse.json(
      { ok: false, message: "Push preferences could not be updated." },
      { status: authorizationStatus(authorization.reason), headers: noStoreHeaders },
    );
  }
  try {
    const bounded = await readBoundedRequestJson(request, MAX_REQUEST_BYTES);
    if (!bounded.ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            bounded.status === 413 ? "Request is too large." : "Push subscription data is invalid.",
        },
        { status: bounded.status === 413 ? 413 : 400, headers: noStoreHeaders },
      );
    }
    const parsed = notificationPushSubscriptionSchema.safeParse(bounded.value);
    if (!parsed.success || !parsed.data.endpoint || !parsed.data.keys) {
      return NextResponse.json(
        { ok: false, message: "Push subscription data is invalid." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    await saveNotificationPushSubscription(authorization.context, {
      endpoint: parsed.data.endpoint,
      expirationTime: parsed.data.expirationTime,
      keys: parsed.data.keys,
    });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Push notifications could not be enabled." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return NextResponse.json(
      { ok: false, message: "Request origin was not accepted." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  const authorization = await authorizedContext();
  if (!authorization.allowed) {
    return NextResponse.json(
      { ok: false, message: "Push preferences could not be updated." },
      { status: authorizationStatus(authorization.reason), headers: noStoreHeaders },
    );
  }
  try {
    const bounded = await readBoundedRequestJson(request, MAX_REQUEST_BYTES);
    if (!bounded.ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            bounded.status === 413 ? "Request is too large." : "Push subscription data is invalid.",
        },
        { status: bounded.status === 413 ? 413 : 400, headers: noStoreHeaders },
      );
    }
    const parsed = notificationPushSubscriptionSchema.safeParse(bounded.value);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: "Push subscription data is invalid." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    const revoked = await revokeNotificationPushSubscriptions(
      authorization.context,
      parsed.data.endpoint,
    );
    return NextResponse.json({ ok: true, revoked }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Push notifications could not be disabled." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
