import { Clock3 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/modules/identity/actions/auth";
import { getCurrentAccessContext } from "@/modules/identity/server/get-current-access-context";

export const metadata = { title: "Access pending" };

export default async function PendingAccessPage() {
  const access = await getCurrentAccessContext();

  if (access.allowed) {
    redirect("/dashboard");
  }

  if (
    access.reason === "access-check-failed" ||
    access.reason === "membership-inactive" ||
    access.reason === "organization-inactive"
  ) {
    redirect(`/access-denied?reason=${access.reason}`);
  }

  const signedOut = access.reason === "signed-out";
  const invitationPending = access.reason === "invitation-pending";
  const rolePending = access.reason === "role-pending";

  return (
    <main className="standalone-state">
      <span className="error-state__icon">
        <Clock3 size={22} aria-hidden="true" />
      </span>
      <p className="standalone-state__code">ACCESS PENDING</p>
      <h1>
        {signedOut
          ? "Confirm your email, then sign in"
          : invitationPending
            ? "Your invitation is awaiting activation"
            : rolePending
              ? "Your role assignment is pending"
              : "Your account is waiting for approval"}
      </h1>
      <p>
        {signedOut
          ? "Use the confirmation link sent to your email address. After confirmation, sign in to check your access status."
          : "Your account is authenticated, but it has no active organization membership or role. An AgencyOS administrator must approve and assign your access from Settings → User access."}
      </p>
      <div className="page-heading__actions">
        {signedOut ? (
          <>
            <Link className="button button--secondary button--md" href="/signup">
              Back to request access
            </Link>
            <Link className="button button--primary button--md" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <Link
              className="button button--secondary button--md"
              href="/dashboard"
              prefetch={false}
            >
              Check again
            </Link>
            <form action={signOutAction}>
              <button className="button button--primary button--md" type="submit">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
