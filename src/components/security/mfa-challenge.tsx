"use client";

import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";

import {
  beginMfaEnrollmentAction,
  verifyMfaAction,
  type MfaActionState,
} from "@/modules/security/actions/mfa";

const initialState: MfaActionState = { status: "idle" };

interface MfaChallengeProps {
  nextPath: string;
  verifiedFactorId: string | null;
}

export function MfaChallenge({ nextPath, verifiedFactorId }: MfaChallengeProps) {
  const [enrollment, startEnrollment, enrolling] = useActionState(
    beginMfaEnrollmentAction,
    initialState,
  );
  const [verification, verify, verifying] = useActionState(verifyMfaAction, initialState);
  const [code, setCode] = useState("");
  const factorId = verifiedFactorId ?? enrollment.factorId ?? null;

  return (
    <div className="login-form mfa-form">
      <div>
        <span className="mfa-form__icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <h2>Verify your identity</h2>
        <p>Privileged AgencyOS access requires a second authentication factor.</p>
      </div>

      {!factorId ? (
        <form action={startEnrollment}>
          <button
            className="button button--secondary button--md login-submit"
            type="submit"
            disabled={enrolling}
          >
            {enrolling ? (
              <>
                <LoaderCircle className="spin" size={16} /> Preparing authenticator
              </>
            ) : (
              <>
                <KeyRound size={16} /> Set up authenticator
              </>
            )}
          </button>
        </form>
      ) : null}

      {enrollment.secret ? (
        <section className="mfa-enrollment" aria-labelledby="mfa-enrollment-title">
          <div>
            <h3 id="mfa-enrollment-title">Add AgencyOS to your authenticator</h3>
            <p>{enrollment.message}</p>
          </div>
          <details open>
            <summary>Authenticator setup key</summary>
            <code>{enrollment.secret}</code>
          </details>
          {enrollment.otpauthUri ? (
            <a className="button button--secondary button--sm" href={enrollment.otpauthUri}>
              Open authenticator app
            </a>
          ) : null}
        </section>
      ) : null}

      {enrollment.status === "error" && enrollment.message ? (
        <div className="form-alert form-alert--error" role="alert">
          {enrollment.message}
        </div>
      ) : null}
      {verification.status === "error" && verification.message ? (
        <div className="form-alert form-alert--error" role="alert">
          {verification.message}
        </div>
      ) : null}

      {factorId ? (
        <form action={verify} className="mfa-verification-form">
          <input type="hidden" name="factorId" value={factorId} />
          <input type="hidden" name="next" value={nextPath} />
          <label className="field">
            <span>Authenticator code</span>
            <input
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="000000"
              disabled={verifying}
              required
            />
          </label>
          <button
            className="button button--primary button--md login-submit"
            type="submit"
            disabled={verifying || code.length !== 6}
          >
            {verifying ? (
              <>
                <LoaderCircle className="spin" size={16} /> Verifying
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Verify code
              </>
            )}
          </button>
        </form>
      ) : null}

      <p className="login-form__note">
        Keep authenticator recovery access outside AgencyOS. Never share the setup key or a current
        code.
      </p>
    </div>
  );
}
