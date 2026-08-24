import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AccessCheckRetry } from "@/components/feedback/access-check-retry";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

function getDisplayName(metadata: Record<string, unknown>, email: string): string {
  const candidates = [metadata.display_name, metadata.full_name, metadata.name];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return email.split("@", 1)[0] || "AgencyOS user";
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const access = await getCurrentPermissionContext();

  if (!access.allowed) {
    if (access.reason === "access-check-failed") {
      return <AccessCheckRetry />;
    }

    if (
      access.reason === "signed-out" ||
      access.reason === "session-expired" ||
      access.reason === "session-revoked"
    ) {
      redirect("/login?session=ended");
    }

    if (access.reason === "mfa-required") {
      redirect("/mfa?next=/dashboard");
    }

    if (
      access.reason === "no-membership" ||
      access.reason === "invitation-pending" ||
      access.reason === "role-pending"
    ) {
      redirect("/pending-access");
    }

    redirect(`/access-denied?reason=${access.reason}`);
  }

  const { email, metadata } = access.context.user;
  const displayName = getDisplayName(metadata, email);

  return (
    <WorkspaceShell
      permissions={[...access.context.permissions]}
      user={{ displayName, email }}
      unreadNotificationCount={access.context.unreadNotificationCount}
      pendingApprovalCount={access.context.pendingApprovalCount}
      membershipId={access.context.membership.id}
    >
      {children}
    </WorkspaceShell>
  );
}
