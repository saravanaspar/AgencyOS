"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PasswordRequirements } from "@/components/auth/password-requirements";
import { resetPasswordAction } from "@/modules/identity/actions/auth";
import { isPasswordPolicySatisfied } from "@/modules/identity/password-policy";
import type { PasswordResetActionState } from "@/modules/identity/schemas/auth";

const initialState: PasswordResetActionState = {
  status: "idle",
};

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const passwordReady = isPasswordPolicySatisfied(password) && password === confirmPassword;

  const passwordError = state.fieldErrors?.password?.[0];
  const confirmPasswordError = state.fieldErrors?.confirmPassword?.[0];

  return (
    <form className="login-form" action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />
      <div>
        <h2>Choose a new password</h2>
        <p>Use at least 12 characters with a letter and a number.</p>
      </div>

      {state.status === "error" && state.message ? (
        <div className="form-alert form-alert--error" role="alert">
          {state.message}
        </div>
      ) : null}

      <label className="field">
        <span>New password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "new-password-error" : "reset-password-requirements"}
          disabled={pending}
          minLength={12}
          required
        />
        {passwordError ? (
          <small className="field-error" id="new-password-error">
            {passwordError}
          </small>
        ) : null}
      </label>

      <label className="field">
        <span>Confirm new password</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={Boolean(confirmPasswordError)}
          aria-describedby={confirmPasswordError ? "confirm-password-error" : undefined}
          disabled={pending}
          minLength={12}
          required
        />
        {confirmPasswordError ? (
          <small className="field-error" id="confirm-password-error">
            {confirmPasswordError}
          </small>
        ) : null}
      </label>

      <div id="reset-password-requirements">
        <PasswordRequirements password={password} confirmation={confirmPassword} showConfirmation />
      </div>

      <button
        className="button button--primary button--md login-submit"
        type="submit"
        disabled={pending || !passwordReady}
      >
        {pending ? "Updating password" : "Update password"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>

      <p className="login-form__note">
        Reset link expired? <Link href="/forgot-password">Request another link.</Link>
      </p>
    </form>
  );
}
