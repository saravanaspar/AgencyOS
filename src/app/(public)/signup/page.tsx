import { CheckCircle2, UserPlus } from "lucide-react";

import { SignUpForm } from "@/components/auth/signup-form";
import { BrandLogo } from "@/components/brand/brand-logo";

export const metadata = { title: "Request access" };

export default function SignUpPage() {
  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-context__brand">
          <BrandLogo inverse priority />
        </div>
        <div className="login-context__copy">
          <span className="login-context__icon">
            <UserPlus size={22} />
          </span>
          <h1>Request access without receiving permissions.</h1>
          <p>
            Creating an account verifies your identity. Organization membership, roles, and
            permissions are granted separately by an AgencyOS administrator.
          </p>
          <ul>
            <li>
              <CheckCircle2 size={16} />
              Email verification required
            </li>
            <li>
              <CheckCircle2 size={16} />
              No default organization access
            </li>
            <li>
              <CheckCircle2 size={16} />
              Administrator approval required
            </li>
          </ul>
        </div>
        <small>Account creation does not grant workspace access</small>
      </section>

      <section className="login-form-wrap">
        <SignUpForm />
      </section>
    </main>
  );
}
