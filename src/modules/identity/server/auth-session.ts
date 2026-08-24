import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  IDENTITY_SESSION_COOKIE,
  parseIdentitySessionToken,
} from "@/integrations/auth/session-token";
import type { RequestSecurityContext } from "@/lib/server/request-context";

const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

export type IdentitySessionStatus = "pending_mfa" | "active";

export interface IdentitySession {
  id: string;
  userId: string;
  email: string;
  metadata: Record<string, unknown>;
  status: IdentitySessionStatus;
  assuranceLevel: "aal1" | "aal2";
  issuedAt: Date;
  expiresAt: Date;
}

function tokenHash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function setSessionCookie(value: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(IDENTITY_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearIdentitySessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(IDENTITY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function createIdentitySession(input: {
  userId: string;
  status: IdentitySessionStatus;
  request: RequestSecurityContext;
}): Promise<IdentitySession> {
  const database = getDatabaseClient();
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_LIFETIME_SECONDS * 1000);
  const hash = tokenHash(secret);

  const [row] = await database<
    {
      email: string;
      raw_user_meta_data: unknown;
    }[]
  >`
    with inserted as (
      insert into public.identity_sessions (
        id, user_id, token_hash, status, assurance_level,
        ip_address, user_agent, issued_at, expires_at, last_seen_at
      )
      values (
        ${id}::uuid, ${input.userId}::uuid, ${hash}, ${input.status}, 'aal1',
        ${input.request.ipAddress}::inet, ${input.request.userAgent}, ${issuedAt}, ${expiresAt}, now()
      )
      returning user_id
    )
    select account.email, account.raw_user_meta_data
    from inserted
    join public.identity_accounts account on account.id = inserted.user_id
  `;
  if (!row) throw new Error("Authenticated identity could not be loaded.");

  await setSessionCookie(`${id}.${secret}`, expiresAt);
  return {
    id,
    userId: input.userId,
    email: row.email,
    metadata: asMetadata(row.raw_user_meta_data),
    status: input.status,
    assuranceLevel: "aal1",
    issuedAt,
    expiresAt,
  };
}

export async function getCurrentIdentitySession(
  options: {
    allowPendingMfa?: boolean;
  } = {},
): Promise<IdentitySession | null> {
  const store = await cookies();
  const parsed = parseIdentitySessionToken(store.get(IDENTITY_SESSION_COOKIE)?.value);
  if (!parsed) return null;

  const database = getDatabaseClient();
  const [row] = await database<
    {
      id: string;
      user_id: string;
      token_hash: Buffer;
      status: string;
      assurance_level: string;
      issued_at: Date;
      expires_at: Date;
      email: string;
      raw_user_meta_data: unknown;
      disabled_at: Date | null;
    }[]
  >`
    select session.id, session.user_id, session.token_hash, session.status,
      session.assurance_level, session.issued_at, session.expires_at,
      account.email, account.raw_user_meta_data, account.disabled_at
    from public.identity_sessions session
    join public.identity_accounts account on account.id = session.user_id
    where session.id = ${parsed.id}::uuid
      and session.status in ('pending_mfa', 'active')
      and session.expires_at > now()
    limit 1
  `;
  if (!row || row.disabled_at) return null;

  const expected = Buffer.from(row.token_hash);
  const received = tokenHash(parsed.secret);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  const status = row.status === "pending_mfa" ? "pending_mfa" : "active";
  if (status === "pending_mfa" && !options.allowPendingMfa) return null;

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    metadata: asMetadata(row.raw_user_meta_data),
    status,
    assuranceLevel: row.assurance_level === "aal2" ? "aal2" : "aal1",
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}

export async function activateIdentitySessionWithMfa(sessionId: string): Promise<void> {
  const database = getDatabaseClient();
  await database`
    update public.identity_sessions
    set status = 'active', assurance_level = 'aal2', mfa_verified_at = now(), last_seen_at = now()
    where id = ${sessionId}::uuid and status in ('pending_mfa', 'active') and expires_at > now()
  `;
}

export async function revokeCurrentIdentitySession(): Promise<void> {
  const store = await cookies();
  const parsed = parseIdentitySessionToken(store.get(IDENTITY_SESSION_COOKIE)?.value);
  try {
    if (parsed) {
      const database = getDatabaseClient();
      await database.begin(async (sql) => {
        await sql`
          update public.identity_sessions
          set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
              revocation_reason = coalesce(revocation_reason, 'sign_out')
          where id = ${parsed.id}::uuid and status in ('pending_mfa', 'active')
        `;
        await sql`
          update public.security_sessions
          set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
              revocation_reason = coalesce(revocation_reason, 'sign_out')
          where id = ${parsed.id}::uuid and status = 'active'
        `;
      });
    }
  } finally {
    // Clearing the browser credential must not depend on database availability.
    await clearIdentitySessionCookie();
  }
}

export async function revokeIdentitySessionsForUser(userId: string, reason: string): Promise<void> {
  const database = getDatabaseClient();
  await database.begin(async (sql) => {
    await sql`
      update public.identity_sessions
      set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
          revocation_reason = coalesce(revocation_reason, ${reason})
      where user_id = ${userId}::uuid and status in ('pending_mfa', 'active')
    `;
    await sql`
      update public.security_sessions
      set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
          revocation_reason = coalesce(revocation_reason, ${reason})
      where user_id = ${userId}::uuid and status = 'active'
    `;
  });
}

export async function identityRequiresMfa(userId: string): Promise<boolean> {
  const database = getDatabaseClient();
  const [row] = await database<{ required: boolean }[]>`
    select (
      exists (
        select 1 from public.identity_mfa_factors factor
        where factor.user_id = ${userId}::uuid and factor.status = 'verified'
      )
      or exists (
        select 1
        from public.memberships membership
        join public.membership_roles assignment on assignment.membership_id = membership.id
        join public.roles role on role.id = assignment.role_id and role.status = 'active'
        join public.organization_security_policies policy on policy.organization_id = membership.organization_id
        where membership.user_id = ${userId}::uuid
          and membership.status = 'active'
          and role.is_privileged
          and policy.require_privileged_mfa
      )
    ) as required
  `;
  return Boolean(row?.required);
}
