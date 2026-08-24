import "server-only";

import { redirect } from "next/navigation";

import type { AccessDenialReason } from "@/modules/identity/server/get-current-access-context";
import { hasRequiredPermissions } from "@/modules/permissions/module-access";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";

export type AuthorizationFailureReason = AccessDenialReason | "insufficient-permission";

export type AuthorizationResult =
  | { allowed: true; context: CurrentPermissionContext }
  | { allowed: false; reason: AuthorizationFailureReason };

export async function authorizeCurrentUser(
  requiredPermissions: readonly string[],
): Promise<AuthorizationResult> {
  const permissionContext = await getCurrentPermissionContext();

  if (!permissionContext.allowed) {
    return permissionContext;
  }

  if (!hasRequiredPermissions(permissionContext.context.permissions, requiredPermissions)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  return permissionContext;
}

export async function requirePagePermissions(
  requiredPermissions: readonly string[],
  nextPath: string,
): Promise<CurrentPermissionContext> {
  const authorization = await authorizeCurrentUser(requiredPermissions);

  if (authorization.allowed) {
    return authorization.context;
  }

  if (authorization.reason === "signed-out") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (authorization.reason === "session-expired" || authorization.reason === "session-revoked") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}&session=ended`);
  }

  if (authorization.reason === "mfa-required") {
    redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  }

  if (
    authorization.reason === "no-membership" ||
    authorization.reason === "invitation-pending" ||
    authorization.reason === "role-pending"
  ) {
    redirect("/pending-access");
  }

  redirect(`/access-denied?reason=${authorization.reason}`);
}

export function authorizationStatus(reason: AuthorizationFailureReason): 401 | 403 | 503 {
  if (reason === "signed-out" || reason === "session-expired" || reason === "session-revoked")
    return 401;
  if (reason === "access-check-failed") return 503;
  return 403;
}
