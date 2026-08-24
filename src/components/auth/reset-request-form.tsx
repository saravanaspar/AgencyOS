"use client";

import { useActionState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";

import { requestPasswordResetAction } from "@/modules/identity/actions/auth";
import type { PasswordResetRequestActionState } from "@/modules/identity/schemas/auth";

const initialState: PasswordResetRequestActionState = {
  status: "idle",
};

interface ResetRequestFormProps {
  pageError?: string;
}

export function ResetRequestForm({ pageError }: ResetRequestFormProps) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.status === "success") {
    return (
      <div className="login-form reset-confirmation" role="status">
        <span className="reset-confirmation__icon">
          <MailCheck size={22} aria-hidden="true" />
        </span>
        <div>
          <h2>Check your email</h2>
          <p>{state.message}</p>
        </div>
        <Link className="button button--secondary button--md" href="/login">
          <ArrowLeft size={16} aria-hidden="true" />
          Return to sign in
        </Link>
      </div>
    );
  }

  const emailError = state.fieldErrors?.email?.[0];

  return (
    <form className="login-form" action={formAction} noValidate>
      <div>
        <h2>Reset your password</h2>
        <p>Enter the email address attached to your AgencyOS account.</p>
      </div>

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

      <label className="field">
        <span>Email address</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@agency.com"
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "reset-email-error" : undefined}
          disabled={pending}
          required
        />
        {emailError ? (
          <small className="field-error" id="reset-email-error">
            {emailError}
          </small>
        ) : null}
      </label>

      <button
        className="button button--primary button--md login-submit"
        type="submit"
        disabled={pending}
      >
        {pending ? "Sending reset link" : "Send reset link"}
      </button>

      <Link className="text-link reset-back-link" href="/login">
        <ArrowLeft size={15} aria-hidden="true" />
        Return to sign in
      </Link>
    </form>
  );
}
