import { KeyRound, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { validateIdentityVerificationToken } from "@/modules/identity/server/verification-token";

export const metadata = { title: "Choose a new password" };

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const parameters = await searchParams;
  const token = Array.isArray(parameters.token) ? parameters.token[0] : parameters.token;
  if (!token || !(await validateIdentityVerificationToken(token, "password_reset"))) {
    redirect("/forgot-password?error=invalid-link");
  }

  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-context__brand">
          <span className="brand-mark brand-mark--inverse">AO</span>
          <strong>AgencyOS</strong>
        </div>
        <div className="login-context__copy">
          <span className="login-context__icon">
            <KeyRound size={22} aria-hidden="true" />
          </span>
          <h1>Set a secure password.</h1>
          <p>The single-use recovery token is validated before your password can be changed.</p>
          <ul>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              At least 12 characters
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              Includes a letter and a number
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              Other sessions revoked after reset
            </li>
          </ul>
        </div>
        <small>AgencyOS security</small>
      </section>
      <section className="login-form-wrap">
        <ResetPasswordForm token={token} />
      </section>
    </main>
  );
}
