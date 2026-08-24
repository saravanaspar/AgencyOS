import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/modules/identity/actions/auth";
import type { AccessDenialReason } from "@/modules/identity/server/get-current-access-context";

interface AccessDeniedPageProps {
  searchParams: Promise<{ reason?: string | string[] }>;
}

const messages: Record<AccessDenialReason, { title: string; description: string }> = {
  "access-check-failed": {
    title: "Access could not be verified",
    description:
      "AgencyOS could not verify your organization access. Try again or contact an administrator.",
  },
  "insufficient-permission": {
    title: "Your role does not allow this action",
    description:
      "You are signed in, but your current organization role does not grant access to this page.",
  },
  "invitation-pending": {
    title: "Invitation is not active yet",
    description:
      "Your organization invitation still needs to be accepted or activated by an administrator.",
  },
  "mfa-required": {
    title: "Multi-factor authentication required",
    description:
      "Your role requires a verified authenticator before AgencyOS can open the workspace.",
  },
  "membership-inactive": {
    title: "Your organization access is inactive",
    description:
      "Your membership has been suspended or deactivated. Contact your AgencyOS administrator.",
  },
  "no-membership": {
    title: "No organization membership found",
    description:
      "This account is authenticated but has not been granted access to an AgencyOS organization.",
  },
  "organization-inactive": {
    title: "Organization access is unavailable",
    description: "The organization linked to this account is suspended, archived, or unavailable.",
  },
  "role-pending": {
    title: "No active role is assigned",
    description:
      "Your membership exists, but an AgencyOS administrator must assign an active role before you can enter the workspace.",
  },
  "session-expired": {
    title: "Your session expired",
    description:
      "Sign in again to continue. AgencyOS ended the session according to organization policy.",
  },
  "session-revoked": {
    title: "Your session was revoked",
    description: "An administrator or another signed-in session ended this session.",
  },
  "signed-out": {
    title: "Your session has ended",
    description: "Sign in again to continue.",
  },
};

function getReason(value: string | string[] | undefined): AccessDenialReason {
  const reason = Array.isArray(value) ? value[0] : value;
  return reason && reason in messages ? (reason as AccessDenialReason) : "access-check-failed";
}

export default async function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  const parameters = await searchParams;
  const message = messages[getReason(parameters.reason)];

  return (
    <main className="standalone-state">
      <span className="error-state__icon">
        <ShieldAlert size={22} aria-hidden="true" />
      </span>
      <p className="standalone-state__code">ACCESS RESTRICTED</p>
      <h1>{message.title}</h1>
      <p>{message.description}</p>
      <div className="page-heading__actions">
        <Link className="button button--secondary button--md" href="/dashboard" prefetch={false}>
          Try again
        </Link>
        <form action={signOutAction}>
          <button className="button button--primary button--md" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
