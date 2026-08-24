"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { signInAction } from "@/modules/identity/actions/auth";
import type { SignInActionState } from "@/modules/identity/schemas/auth";

const initialSignInActionState: SignInActionState = {
  status: "idle",
};

interface LoginFormProps {
  nextPath?: string;
  notice?: string;
  pageError?: string;
}

export function LoginForm({ nextPath, notice, pageError }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(signInAction, initialSignInActionState);

  const emailError = state.fieldErrors?.email?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  return (
    <form className="login-form" action={formAction} noValidate>
      <div>
        <h2>Sign in to AgencyOS</h2>
        <p>Use your organization account.</p>
      </div>

      {notice ? (
        <div className="form-alert form-alert--success" role="status">
          {notice}
        </div>
      ) : null}

      {pageError ? (
        <div className="form-alert form-alert--error" role="alert">
          {pageError}
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <div className="form-alert form-alert--error" role="alert">
          {state.message}
        </div>
      ) : null}

      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}

      <label className="field">
        <span>Email address</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@agency.com"
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "login-email-error" : undefined}
          disabled={pending}
          required
        />
        {emailError ? (
          <small className="field-error" id="login-email-error">
            {emailError}
          </small>
        ) : null}
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "login-password-error" : undefined}
          disabled={pending}
          required
        />
        {passwordError ? (
          <small className="field-error" id="login-password-error">
            {passwordError}
          </small>
        ) : null}
      </label>

      <div className="login-form__row login-form__row--end">
        <Link href="/forgot-password">Forgot password?</Link>
      </div>

      <button
        className="button button--primary button--md login-submit"
        type="submit"
        disabled={pending}
      >
        {pending ? "Signing in" : "Sign in"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>

      <p className="login-form__note">
        Need access? <Link href="/signup">Create an account request</Link>
      </p>
    </form>
  );
}
