"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContext } from "@/lib/server/request-context";
import {
  clearIdentitySessionCookie,
  createIdentitySession,
  getCurrentIdentitySession,
  identityRequiresMfa,
  revokeCurrentIdentitySession,
  revokeIdentitySessionsForUser,
} from "@/modules/identity/server/auth-session";
import {
  sendIdentityPasswordResetEmail,
  sendIdentityVerificationEmail,
} from "@/modules/identity/server/auth-email";
import {
  createLocalIdentity,
  setIdentityPassword,
  verifyIdentityPassword,
} from "@/modules/identity/server/credentials";
import {
  consumeIdentityVerificationToken,
  issueIdentityVerificationToken,
} from "@/modules/identity/server/verification-token";
import {
  getSafeNextPath,
  passwordResetRequestSchema,
  passwordResetSchema,
  signInSchema,
  signUpSchema,
  type PasswordResetActionState,
  type PasswordResetRequestActionState,
  type SignInActionState,
  type SignUpActionState,
} from "@/modules/identity/schemas/auth";
import {
  authenticationRateLimitAllows,
  recordAuthenticationEvent,
} from "@/modules/security/server/security";

function developmentTokenMessage(prefix: string, token: string): string | null {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_DEV_SHOW_TOKENS !== "1")
    return null;
  return `${prefix} Development token: ${token}`;
}

export async function signInAction(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const result = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: { email: fieldErrors.email, password: fieldErrors.password },
    };
  }

  const request = await getRequestSecurityContext();
  if (
    !(await authenticationRateLimitAllows({ kind: "login", email: result.data.email, request }))
  ) {
    return { status: "error", message: "Too many sign-in attempts. Wait before trying again." };
  }

  const identity = await verifyIdentityPassword({
    email: result.data.email,
    password: result.data.password,
  });
  if (!identity) {
    await recordAuthenticationEvent({ kind: "login_failure", email: result.data.email, request });
    return { status: "error", message: "Email or password is incorrect." };
  }
  if (!identity.emailConfirmedAt) {
    await recordAuthenticationEvent({
      kind: "login_failure",
      email: result.data.email,
      userId: identity.userId,
      request,
    });
    return { status: "error", message: "Confirm your email address before signing in." };
  }

  const requiresMfa = await identityRequiresMfa(identity.userId);
  const session = await createIdentitySession({
    userId: identity.userId,
    status: requiresMfa ? "pending_mfa" : "active",
    request,
  });
  await recordAuthenticationEvent({
    kind: "login_success",
    email: identity.email,
    userId: identity.userId,
    request,
  });

  const nextPath = getSafeNextPath(result.data.next);
  revalidatePath("/", "layout");
  if (session.status === "pending_mfa") {
    redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  }
  redirect(nextPath);
}

export async function signUpAction(
  _previousState: SignUpActionState,
  formData: FormData,
): Promise<SignUpActionState> {
  const result = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        fullName: fieldErrors.fullName,
        email: fieldErrors.email,
        password: fieldErrors.password,
        confirmPassword: fieldErrors.confirmPassword,
      },
    };
  }

  const request = await getRequestSecurityContext();
  if (
    !(await authenticationRateLimitAllows({ kind: "sign-up", email: result.data.email, request }))
  ) {
    return {
      status: "error",
      message: "Too many account requests. Wait before trying again.",
    };
  }

  try {
    const identity = await createLocalIdentity({
      email: result.data.email,
      password: result.data.password,
      fullName: result.data.fullName,
    });
    if (!identity.confirmed) {
      const token = await issueIdentityVerificationToken({
        userId: identity.id,
        purpose: "email_verification",
        lifetimeMinutes: 24 * 60,
      });
      const sent = await sendIdentityVerificationEmail(result.data.email, token);
      const development = developmentTokenMessage("Email delivery is not configured.", token);
      return {
        status: "success",
        message:
          development ??
          (sent
            ? "Check your email to confirm the account request. After confirmation, an administrator must grant organization access."
            : "Account request recorded, but confirmation email delivery is not configured. Ask an AgencyOS administrator to configure RESEND_API_KEY and NOTIFICATION_EMAIL_FROM."),
      };
    }
  } catch {
    return { status: "error", message: "Your account request could not be submitted. Try again." };
  }

  // Keep the response generic when an already-confirmed address signs up again.
  return {
    status: "success",
    message: "If this address can be registered, a confirmation email has been sent.",
  };
}

export async function requestPasswordResetAction(
  _previousState: PasswordResetRequestActionState,
  formData: FormData,
): Promise<PasswordResetRequestActionState> {
  const result = passwordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!result.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      fieldErrors: { email: result.error.flatten().fieldErrors.email },
    };
  }

  const request = await getRequestSecurityContext();
  if (
    !(await authenticationRateLimitAllows({
      kind: "password-reset",
      email: result.data.email,
      request,
    }))
  ) {
    return {
      status: "success",
      message: "If an account exists for that address, a password-reset link has been sent.",
    };
  }

  const database = getDatabaseClient();
  const [identity] = await database<{ id: string; email: string }[]>`
    select id, email from public.identity_accounts
    where lower(email) = lower(${result.data.email}) and disabled_at is null
    limit 1
  `;
  let development: string | null = null;
  if (identity) {
    const token = await issueIdentityVerificationToken({
      userId: identity.id,
      purpose: "password_reset",
      lifetimeMinutes: 30,
    });
    await sendIdentityPasswordResetEmail(identity.email, token);
    development = developmentTokenMessage("Password reset email is not configured.", token);
  }
  await recordAuthenticationEvent({
    kind: "password_reset_requested",
    email: result.data.email,
    request,
  });

  return {
    status: "success",
    message:
      development ?? "If an account exists for that address, a password-reset link has been sent.",
  };
}

export async function resetPasswordAction(
  _previousState: PasswordResetActionState,
  formData: FormData,
): Promise<PasswordResetActionState> {
  const result = passwordResetSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  const token = String(formData.get("token") ?? "");
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: { password: fieldErrors.password, confirmPassword: fieldErrors.confirmPassword },
    };
  }

  const identity = await consumeIdentityVerificationToken(token, "password_reset");
  if (!identity) {
    return {
      status: "error",
      message: "This reset link is invalid or has expired. Request a new link.",
    };
  }

  await setIdentityPassword(identity.userId, result.data.password);
  await revokeIdentitySessionsForUser(identity.userId, "password_reset");
  revalidatePath("/", "layout");
  redirect("/login?passwordReset=success");
}

export async function signOutAction(): Promise<void> {
  const session = await getCurrentIdentitySession({ allowPendingMfa: true }).catch(() => null);
  if (session) {
    await revokeCurrentIdentitySession();
  } else {
    // An expired, malformed, or unreachable server-side session must not keep a
    // browser credential around merely because there is nothing left to revoke.
    await clearIdentitySessionCookie();
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
