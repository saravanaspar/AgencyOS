import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import type { AccessDenialReason } from "@/modules/identity/server/get-current-access-context";

export function PageAccessFailure({
  reason,
  nextPath,
}: {
  reason: AccessDenialReason;
  nextPath: string;
}) {
  if (reason === "access-check-failed") {
    return <AccessCheckRetry />;
  }

  if (reason === "signed-out") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (reason === "session-expired" || reason === "session-revoked") {
    redirect(`/login?next=${encodeURIComponent(nextPath)}&session=ended`);
  }

  if (reason === "mfa-required") {
    redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  }

  if (reason === "no-membership" || reason === "invitation-pending" || reason === "role-pending") {
    redirect("/pending-access");
  }

  redirect(`/access-denied?reason=${reason}`);
}
