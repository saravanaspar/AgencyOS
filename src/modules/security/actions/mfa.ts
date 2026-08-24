"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  decryptSecretObjectWithEnvironmentKey,
  encryptSecretObjectWithEnvironmentKey,
} from "@/lib/security/secret-envelope";
import { getRequestSecurityContext } from "@/lib/server/request-context";
import {
  activateIdentitySessionWithMfa,
  getCurrentIdentitySession,
} from "@/modules/identity/server/auth-session";
import { getSafeNextPath } from "@/modules/identity/schemas/auth";
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from "@/modules/security/totp";
import {
  authenticationRateLimitAllows,
  recordAuthenticationEvent,
} from "@/modules/security/server/security";

export interface MfaActionState {
  status: "idle" | "ready" | "error";
  message?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
  otpauthUri?: string;
}

async function recordMfaEvent(userId: string, eventType: string): Promise<void> {
  const request = await getRequestSecurityContext();
  const database = getDatabaseClient();
  await database`
    insert into public.security_events (
      organization_id, membership_id, event_type, severity, ip_address, user_agent, request_id
    )
    select membership.organization_id, membership.id, ${eventType}, 'info',
           ${request.ipAddress}::inet, ${request.userAgent}, ${request.requestId}
    from public.memberships as membership
    where membership.user_id = ${userId}::uuid
      and membership.status = 'active'
  `;
}

const verificationSchema = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().max(2048).optional(),
});

function encryptTotpSecret(secret: string): string {
  return encryptSecretObjectWithEnvironmentKey(
    { secret },
    "AUTH_ENCRYPTION_KEY",
    "authenticator factor",
  );
}

function decryptTotpSecret(envelope: string): string {
  const secret = decryptSecretObjectWithEnvironmentKey(
    envelope,
    "AUTH_ENCRYPTION_KEY",
    "authenticator factor",
  ).secret;
  if (!secret) throw new Error("Authenticator secret is unavailable.");
  return secret;
}

export async function beginMfaEnrollmentAction(): Promise<MfaActionState> {
  const session = await getCurrentIdentitySession({ allowPendingMfa: true });
  if (!session) return { status: "error", message: "Sign in again to enroll MFA." };

  const database = getDatabaseClient();
  const factors = await database<
    { id: string; status: "verified" | "unverified"; secret_envelope: string }[]
  >`
    select id, status, secret_envelope
    from public.identity_mfa_factors
    where user_id = ${session.userId}::uuid and factor_type = 'totp'
    order by case when status = 'verified' then 0 else 1 end, created_at desc
  `;
  const verified = factors.find((factor) => factor.status === "verified");
  if (verified) {
    return {
      status: "ready",
      message: "Your authenticator is already enrolled. Enter the current code.",
      factorId: verified.id,
    };
  }

  await database`
    delete from public.identity_mfa_factors
    where user_id = ${session.userId}::uuid and status = 'unverified'
  `;
  const factorId = randomUUID();
  const secret = generateTotpSecret();
  await database`
    insert into public.identity_mfa_factors (
      id, user_id, factor_type, status, friendly_name, secret_envelope
    ) values (
      ${factorId}::uuid, ${session.userId}::uuid, 'totp', 'unverified',
      'AgencyOS authenticator', ${encryptTotpSecret(secret)}
    )
  `;
  await recordMfaEvent(session.userId, "security.mfa_enrollment_started");
  return {
    status: "ready",
    message: "Add the setup key to your authenticator, then enter the current six-digit code.",
    factorId,
    secret,
    otpauthUri: buildTotpUri({ secret, email: session.email }),
  };
}

export async function verifyMfaAction(
  _previous: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const parsed = verificationSchema.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Enter the current six-digit authenticator code." };
  }

  const session = await getCurrentIdentitySession({ allowPendingMfa: true });
  if (!session) return { status: "error", message: "Sign in again to verify MFA." };
  const request = await getRequestSecurityContext();
  if (!(await authenticationRateLimitAllows({ kind: "login", email: session.email, request }))) {
    return {
      status: "error",
      message: "Too many authentication attempts. Wait before trying again.",
    };
  }
  const database = getDatabaseClient();
  const [factor] = await database<
    { id: string; status: "verified" | "unverified"; secret_envelope: string }[]
  >`
    select id, status, secret_envelope
    from public.identity_mfa_factors
    where id = ${parsed.data.factorId}::uuid
      and user_id = ${session.userId}::uuid
      and factor_type = 'totp'
    limit 1
  `;
  if (!factor) {
    return { status: "error", message: "The authentication factor is no longer available." };
  }

  let accepted = false;
  try {
    accepted = verifyTotpCode(decryptTotpSecret(factor.secret_envelope), parsed.data.code);
  } catch {
    return { status: "error", message: "The authentication factor could not be decrypted." };
  }
  if (!accepted) {
    await recordAuthenticationEvent({
      kind: "login_failure",
      email: session.email,
      userId: session.userId,
      request,
    });
    return {
      status: "error",
      message: "That code was not accepted. Use the current code and try again.",
    };
  }

  await database.begin(async (sql) => {
    if (factor.status !== "verified") {
      await sql`
        update public.identity_mfa_factors
        set status = 'verified', verified_at = now(), updated_at = now()
        where id = ${factor.id}::uuid and user_id = ${session.userId}::uuid
      `;
    }
  });
  await activateIdentitySessionWithMfa(session.id);
  await recordMfaEvent(session.userId, "security.mfa_verified");
  redirect(getSafeNextPath(parsed.data.next));
}
