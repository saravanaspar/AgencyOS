import { CheckCircle2, LockKeyhole } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { getSafeNextPath } from "@/modules/identity/schemas/auth";

export const metadata = { title: "Sign in" };

interface LoginPageProps {
  searchParams: Promise<{
    authError?: string | string[];
    next?: string | string[];
    passwordReset?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const requestedNextPath = firstValue(parameters.next);
  const nextPath = requestedNextPath ? getSafeNextPath(requestedNextPath) : undefined;
  const notice =
    firstValue(parameters.passwordReset) === "success"
      ? "Your password was updated. Sign in with the new password."
      : undefined;
  const pageError =
    firstValue(parameters.authError) === "link-expired"
      ? "This authentication link is invalid or has expired. Request a new link."
      : undefined;

  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-context__brand">
          <span className="brand-mark brand-mark--inverse">AO</span>
          <strong>AgencyOS</strong>
        </div>
        <div className="login-context__copy">
          <span className="login-context__icon">
            <LockKeyhole size={22} />
          </span>
          <h1>One place for agency operations.</h1>
          <p>
            Projects, finance, people, documents, approvals, and support share one permission model
            and audit trail.
          </p>
          <ul>
            <li>
              <CheckCircle2 size={16} />
              Role-aware access
            </li>
            <li>
              <CheckCircle2 size={16} />
              Complete activity history
            </li>
            <li>
              <CheckCircle2 size={16} />
              Cross-module records
            </li>
          </ul>
        </div>
        <small>Workspace access requires an active membership and assigned permissions</small>
      </section>

      <section className="login-form-wrap">
        <LoginForm nextPath={nextPath} notice={notice} pageError={pageError} />
      </section>
    </main>
  );
}
