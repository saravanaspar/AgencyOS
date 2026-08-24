import { CheckCircle2, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { MfaChallenge } from "@/components/security/mfa-challenge";
import { getCurrentIdentitySession } from "@/modules/identity/server/auth-session";
import { getSafeNextPath } from "@/modules/identity/schemas/auth";
import { getDatabaseClient } from "@/integrations/postgres/database";

export const metadata = { title: "Two-factor authentication" };

interface MfaPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function MfaPage({ searchParams }: MfaPageProps) {
  const parameters = await searchParams;
  const requested = Array.isArray(parameters.next) ? parameters.next[0] : parameters.next;
  const nextPath = getSafeNextPath(requested);
  const session = await getCurrentIdentitySession({ allowPendingMfa: true });
  if (!session) redirect(`/login?next=${encodeURIComponent(`/mfa?next=${nextPath}`)}`);
  if (session.assuranceLevel === "aal2" && session.status === "active") redirect(nextPath);

  const database = getDatabaseClient();
  const [factor] = await database<{ id: string }[]>`
    select id from public.identity_mfa_factors
    where user_id = ${session.userId}::uuid and factor_type = 'totp' and status = 'verified'
    order by verified_at desc
    limit 1
  `;

  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-context__brand">
          <span className="brand-mark brand-mark--inverse">AO</span>
          <strong>AgencyOS</strong>
        </div>
        <div className="login-context__copy">
          <span className="login-context__icon">
            <ShieldCheck size={22} />
          </span>
          <h1>Protect privileged access.</h1>
          <p>
            A second factor limits the impact of a stolen password and is mandatory for privileged
            organization roles.
          </p>
          <ul>
            <li>
              <CheckCircle2 size={16} /> Time-based authenticator codes
            </li>
            <li>
              <CheckCircle2 size={16} /> Session-bound assurance
            </li>
            <li>
              <CheckCircle2 size={16} /> Security-event evidence
            </li>
          </ul>
        </div>
        <small>
          AgencyOS never asks for an authenticator code outside this verification screen
        </small>
      </section>
      <section className="login-form-wrap">
        <MfaChallenge nextPath={nextPath} verifiedFactorId={factor?.id ?? null} />
      </section>
    </main>
  );
}
