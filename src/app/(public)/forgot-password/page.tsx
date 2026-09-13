import { KeyRound, ShieldCheck } from "lucide-react";

import { ResetRequestForm } from "@/components/auth/reset-request-form";
import { BrandLogo } from "@/components/brand/brand-logo";

export const metadata = { title: "Reset password" };

interface ForgotPasswordPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const parameters = await searchParams;
  const error = Array.isArray(parameters.error) ? parameters.error[0] : parameters.error;
  const pageError =
    error === "invalid-link"
      ? "This reset link is invalid or has expired. Request a new link."
      : undefined;

  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-context__brand">
          <BrandLogo inverse priority />
        </div>
        <div className="login-context__copy">
          <span className="login-context__icon">
            <KeyRound size={22} aria-hidden="true" />
          </span>
          <h1>Restore account access.</h1>
          <p>A time-limited recovery link will be sent to the account email address.</p>
          <ul>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              Generic response protects account privacy
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              Recovery links expire automatically
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              Existing sessions are revoked after reset
            </li>
          </ul>
        </div>
        <small>AgencyOS security</small>
      </section>
      <section className="login-form-wrap">
        <ResetRequestForm pageError={pageError} />
      </section>
    </main>
  );
}
