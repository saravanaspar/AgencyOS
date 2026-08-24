"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { PasswordRequirements } from "@/components/auth/password-requirements";
import { signUpAction } from "@/modules/identity/actions/auth";
import { isPasswordPolicySatisfied } from "@/modules/identity/password-policy";
import type { SignUpActionState } from "@/modules/identity/schemas/auth";

const initialSignUpActionState: SignUpActionState = {
  status: "idle",
};

export function SignUpForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, formAction, pending] = useActionState(signUpAction, initialSignUpActionState);
  const passwordReady = isPasswordPolicySatisfied(password) && password === confirmPassword;

  const fullNameError = state.fieldErrors?.fullName?.[0];
  const emailError = state.fieldErrors?.email?.[0];
  const passwordError = state.fieldErrors?.password?.[0];
  const confirmPasswordError = state.fieldErrors?.confirmPassword?.[0];

  if (state.status === "success") {
    return (
      <section className="login-form" aria-live="polite">
        <span className="reset-confirmation__icon">
          <CheckCircle2 size={22} aria-hidden="true" />
        </span>
        <div>
          <h2>Check your email</h2>
          <p>{state.message}</p>
        </div>
        <Link className="button button--primary button--md login-submit" href="/login">
          Return to sign in
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <form className="login-form" action={formAction} noValidate>
      <div>
        <h2>Request AgencyOS access</h2>
        <p>Create an account. An administrator must approve your organization access.</p>
      </div>

      {state.status === "error" && state.message ? (
        <div className="form-alert form-alert--error" role="alert">
          {state.message}
        </div>
      ) : null}

      <label className="field">
        <span>Full name</span>
        <input
          type="text"
          name="fullName"
          autoComplete="name"
          placeholder="Alex Morgan"
          aria-invalid={Boolean(fullNameError)}
          aria-describedby={fullNameError ? "signup-name-error" : undefined}
          disabled={pending}
          required
        />
        {fullNameError ? (
          <small className="field-error" id="signup-name-error">
            {fullNameError}
          </small>
        ) : null}
      </label>

      <label className="field">
        <span>Work email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@agency.com"
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "signup-email-error" : undefined}
          disabled={pending}
          required
        />
        {emailError ? (
          <small className="field-error" id="signup-email-error">
            {emailError}
          </small>
        ) : null}
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 12 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(passwordError)}
          aria-describedby={
            passwordError ? "signup-password-error" : "signup-password-requirements"
          }
          disabled={pending}
          required
        />
        {passwordError ? (
          <small className="field-error" id="signup-password-error">
            {passwordError}
          </small>
        ) : null}
      </label>

      <label className="field">
        <span>Confirm password</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Enter the password again"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={Boolean(confirmPasswordError)}
          aria-describedby={confirmPasswordError ? "signup-confirm-password-error" : undefined}
          disabled={pending}
          required
        />
        {confirmPasswordError ? (
          <small className="field-error" id="signup-confirm-password-error">
            {confirmPasswordError}
          </small>
        ) : null}
      </label>

      <div id="signup-password-requirements">
        <PasswordRequirements password={password} confirmation={confirmPassword} showConfirmation />
      </div>

      <button
        className="button button--primary button--md login-submit"
        type="submit"
        disabled={pending || !passwordReady}
      >
        {pending ? "Creating account" : "Create account"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>

      <p className="login-form__note">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
