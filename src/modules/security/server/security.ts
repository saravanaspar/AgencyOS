import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  incrementRedisRateLimit,
  type RedisRateLimitResult,
} from "@/integrations/redis/rate-limit";
import {
  getRequestSecurityContext,
  hashSecurityIdentity,
  type RequestSecurityContext,
} from "@/lib/server/request-context";
import { toJsonValue } from "@/lib/server/json-value";
import { validateSafeJsonObject } from "@/lib/security/safe-json-object";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { getCurrentIdentitySession } from "@/modules/identity/server/auth-session";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  securityPermissionKeys,
  type SecurityEventItem,
  type SecurityIncidentItem,
  type SecurityMemberItem,
  type SecurityPolicy,
  type SecurityRestoreDrillItem,
  type SecuritySessionItem,
  type SecurityWorkspaceData,
} from "@/modules/security/security";

interface SecurityPolicyRow {
  require_privileged_mfa: boolean;
  recommend_mfa: boolean;
  absolute_session_minutes: number;
  idle_timeout_minutes: number;
  reauthentication_minutes: number;
  suspicious_failure_threshold: number;
  suspicious_window_minutes: number;
  login_limit_per_window: number;
  password_reset_limit_per_window: number;
  api_limit_per_minute: number;
  ai_limit_per_minute: number;
  worker_limit_per_minute: number;
  export_limit_per_minute: number;
  mcp_limit_per_minute: number;
}

export type SecurityWorkspaceResult =
  | { allowed: true; data: SecurityWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export type AuthenticationRateLimitKind = "login" | "password-reset" | "sign-up";
export type AuthorizedRateLimitKind = "api" | "ai" | "worker" | "export" | "mcp";

export const defaultSecurityPolicy: SecurityPolicy = {
  requirePrivilegedMfa: true,
  recommendMfa: true,
  absoluteSessionMinutes: 720,
  idleTimeoutMinutes: 30,
  reauthenticationMinutes: 15,
  suspiciousFailureThreshold: 5,
  suspiciousWindowMinutes: 15,
  loginLimitPerWindow: 10,
  passwordResetLimitPerWindow: 5,
  apiLimitPerMinute: 120,
  aiLimitPerMinute: 10,
  workerLimitPerMinute: 60,
  exportLimitPerMinute: 10,
  mcpLimitPerMinute: 30,
};

function policyFromRow(row: SecurityPolicyRow | undefined): SecurityPolicy {
  if (!row) return defaultSecurityPolicy;
  return {
    requirePrivilegedMfa: row.require_privileged_mfa,
    recommendMfa: row.recommend_mfa,
    absoluteSessionMinutes: row.absolute_session_minutes,
    idleTimeoutMinutes: row.idle_timeout_minutes,
    reauthenticationMinutes: row.reauthentication_minutes,
    suspiciousFailureThreshold: row.suspicious_failure_threshold,
    suspiciousWindowMinutes: row.suspicious_window_minutes,
    loginLimitPerWindow: row.login_limit_per_window,
    passwordResetLimitPerWindow: row.password_reset_limit_per_window,
    apiLimitPerMinute: row.api_limit_per_minute,
    aiLimitPerMinute: row.ai_limit_per_minute,
    workerLimitPerMinute: row.worker_limit_per_minute,
    exportLimitPerMinute: row.export_limit_per_minute,
    mcpLimitPerMinute: row.mcp_limit_per_minute,
  };
}

export async function getOrganizationSecurityPolicy(
  organizationId: string,
): Promise<SecurityPolicy> {
  const database = getDatabaseClient();
  const [row] = await database<SecurityPolicyRow[]>`
    select * from public.organization_security_policies
    where organization_id = ${organizationId}::uuid
    limit 1
  `;
  return policyFromRow(row);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function requireRecentReauthentication(
  context: CurrentPermissionContext,
): Promise<void> {
  const [policy, identitySession] = await Promise.all([
    getOrganizationSecurityPolicy(context.membership.organizationId),
    getCurrentIdentitySession(),
  ]);
  const sessionId = identitySession?.id ?? null;
  if (!sessionId) throw new Error("Reauthenticate before completing this action.");
  const database = getDatabaseClient();
  const [session] = await database<{ reauthenticated_at: Date | null; assurance_level: string }[]>`
    select reauthenticated_at, assurance_level
    from public.security_sessions
    where id = ${sessionId}::uuid
      and membership_id = ${context.membership.id}::uuid
      and organization_id = ${context.membership.organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  const cutoff = Date.now() - policy.reauthenticationMinutes * 60_000;
  if (
    !session?.reauthenticated_at ||
    session.reauthenticated_at.getTime() < cutoff ||
    (context.security.privileged && session.assurance_level !== "aal2")
  ) {
    throw new Error("Reauthenticate before completing this action.");
  }
}

async function knownMembershipsForEmail(email: string) {
  const database = getDatabaseClient();
  return database<
    {
      organization_id: string;
      membership_id: string;
      user_id: string;
      suspicious_failure_threshold: number;
      suspicious_window_minutes: number;
      login_limit_per_window: number;
      password_reset_limit_per_window: number;
    }[]
  >`
    select
      membership.organization_id,
      membership.id as membership_id,
      membership.user_id,
      policy.suspicious_failure_threshold,
      policy.suspicious_window_minutes,
      policy.login_limit_per_window,
      policy.password_reset_limit_per_window
    from public.identity_accounts as auth_user
    join public.memberships as membership on membership.user_id = auth_user.id
    join public.organization_security_policies as policy
      on policy.organization_id = membership.organization_id
    where lower(auth_user.email) = lower(${email})
      and membership.status = 'active'
  `;
}

export async function authenticationRateLimitAllows(input: {
  kind: AuthenticationRateLimitKind;
  email: string;
  request: RequestSecurityContext;
}): Promise<boolean> {
  const memberships = input.kind === "sign-up" ? [] : await knownMembershipsForEmail(input.email);
  const limit =
    input.kind === "sign-up"
      ? defaultSecurityPolicy.passwordResetLimitPerWindow
      : memberships.length
        ? Math.min(
            ...memberships.map((row) =>
              input.kind === "login"
                ? row.login_limit_per_window
                : row.password_reset_limit_per_window,
            ),
          )
        : input.kind === "login"
          ? defaultSecurityPolicy.loginLimitPerWindow
          : defaultSecurityPolicy.passwordResetLimitPerWindow;
  const emailHash = hashSecurityIdentity(input.email);
  const networkRatePromise = input.request.ipAddress
    ? incrementRedisRateLimit(
        `security:${input.kind}:network`,
        hashSecurityIdentity(
          input.kind === "sign-up"
            ? input.request.ipAddress
            : `${input.request.ipAddress}:${emailHash}`,
        ),
        limit,
        900,
      )
    : Promise.resolve<RedisRateLimitResult>({ available: true, allowed: true, count: 0 });
  const [emailRate, networkRate] = await Promise.all([
    incrementRedisRateLimit(`security:${input.kind}:email`, emailHash, limit, 900),
    networkRatePromise,
  ]);
  if (emailRate.available && networkRate.available) {
    return emailRate.allowed && networkRate.allowed;
  }
  if (
    (emailRate.available && !emailRate.allowed) ||
    (networkRate.available && !networkRate.allowed)
  ) {
    return false;
  }
  if (input.kind === "sign-up" || memberships.length === 0) {
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.SECURITY_RATE_LIMIT_REDIS_FAILURE_MODE === "allow"
    );
  }

  const database = getDatabaseClient();
  const eventType =
    input.kind === "login" ? "security.login_attempt" : "security.password_reset_requested";
  const [row] = await database<{ count: number }[]>`
    select count(*)::integer as count
    from public.security_events
    where organization_id = any(${memberships.map((item) => item.organization_id)}::uuid[])
      and event_type = ${eventType}
      and occurred_at >= now() - interval '15 minutes'
      and metadata ->> 'emailHash' = ${emailHash}
  `;
  return (row?.count ?? 0) < limit;
}

export async function authorizedRateLimitAllows(input: {
  kind: AuthorizedRateLimitKind;
  context: CurrentPermissionContext;
  request: RequestSecurityContext;
}): Promise<boolean> {
  const policy = await getOrganizationSecurityPolicy(input.context.membership.organizationId);
  const limit =
    input.kind === "ai"
      ? policy.aiLimitPerMinute
      : input.kind === "worker"
        ? policy.workerLimitPerMinute
        : input.kind === "export"
          ? policy.exportLimitPerMinute
          : input.kind === "mcp"
            ? policy.mcpLimitPerMinute
            : policy.apiLimitPerMinute;
  const identity = hashSecurityIdentity(
    `${input.context.membership.organizationId}:${input.context.membership.id}:${input.request.ipAddress ?? "unknown"}`,
  );
  const result = await incrementRedisRateLimit(`security:${input.kind}`, identity, limit, 60);
  if (result.available) return result.allowed;
  // Authenticated endpoints fail closed in production when the shared limiter is unavailable.
  // A local-only bypass is permitted explicitly for development and test environments.
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.SECURITY_RATE_LIMIT_REDIS_FAILURE_MODE === "allow"
  );
}

export async function appendSecurityEvent(input: {
  organizationId: string;
  membershipId?: string | null;
  sessionId?: string | null;
  eventType: string;
  severity?: "info" | "warning" | "critical";
  request: RequestSecurityContext;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const metadata = input.metadata ?? {};
  validateSafeJsonObject(metadata, {
    label: "Security-event metadata",
    maximumBytes: 16 * 1024,
    maximumDepth: 10,
    maximumNodes: 500,
  });
  const database = getDatabaseClient();
  await database`
    insert into public.security_events (
      organization_id, membership_id, session_id, event_type, severity,
      ip_address, user_agent, request_id, metadata
    ) values (
      ${input.organizationId}::uuid,
      ${input.membershipId ?? null}::uuid,
      ${input.sessionId ?? null}::uuid,
      ${input.eventType},
      ${input.severity ?? "info"},
      ${input.request.ipAddress}::inet,
      ${input.request.userAgent},
      ${input.request.requestId},
      ${database.json(toJsonValue(metadata))}
    )
  `;
}

export async function recordAuthenticationEvent(input: {
  kind: "login_success" | "login_failure" | "password_reset_requested";
  email: string;
  userId?: string | null;
  request: RequestSecurityContext;
}): Promise<void> {
  const memberships = await knownMembershipsForEmail(input.email);
  if (memberships.length === 0) return;
  const database = getDatabaseClient();
  const emailHash = hashSecurityIdentity(input.email);

  for (const membership of memberships) {
    await appendSecurityEvent({
      organizationId: membership.organization_id,
      membershipId: membership.membership_id,
      eventType:
        input.kind === "login_success"
          ? "security.login_success"
          : input.kind === "login_failure"
            ? "security.login_attempt"
            : "security.password_reset_requested",
      severity: input.kind === "login_failure" ? "warning" : "info",
      request: input.request,
      metadata: { emailHash, outcome: input.kind },
    });

    if (input.kind !== "login_failure") continue;
    const [failureCount] = await database<{ count: number }[]>`
      select count(*)::integer as count
      from public.security_events
      where organization_id = ${membership.organization_id}::uuid
        and membership_id = ${membership.membership_id}::uuid
        and event_type = 'security.login_attempt'
        and occurred_at >= now() - (${membership.suspicious_window_minutes}::text || ' minutes')::interval
    `;
    if ((failureCount?.count ?? 0) < membership.suspicious_failure_threshold) continue;

    const [existingAlert] = await database<{ id: string }[]>`
      select id::text as id
      from public.security_events
      where organization_id = ${membership.organization_id}::uuid
        and membership_id = ${membership.membership_id}::uuid
        and event_type = 'security.suspicious_login'
        and occurred_at >= now() - (${membership.suspicious_window_minutes}::text || ' minutes')::interval
      limit 1
    `;
    if (existingAlert) continue;

    await database.begin(async (sql) => {
      await sql`
        insert into public.security_events (
          organization_id, membership_id, event_type, severity, ip_address,
          user_agent, request_id, metadata
        ) values (
          ${membership.organization_id}::uuid,
          ${membership.membership_id}::uuid,
          'security.suspicious_login',
          'critical',
          ${input.request.ipAddress}::inet,
          ${input.request.userAgent},
          ${input.request.requestId},
          ${sql.json(toJsonValue({ emailHash, failureCount: failureCount?.count ?? 0 }))}
        )
      `;
      await sql`
        insert into public.notifications (
          organization_id, recipient_membership_id, category, severity, title, message,
          deep_link, source_module, source_entity_type, source_entity_id, dedupe_key, metadata
        ) values (
          ${membership.organization_id}::uuid,
          ${membership.membership_id}::uuid,
          'security_alert',
          'error',
          'Suspicious sign-in activity',
          'AgencyOS detected repeated failed sign-in attempts for your account.',
          '/settings/security',
          'security',
          'membership',
          ${membership.membership_id},
          ${`security-login:${membership.membership_id}`},
          ${sql.json(toJsonValue({ failureCount: failureCount?.count ?? 0 }))}
        )
        on conflict (recipient_membership_id, dedupe_key)
        where dedupe_key is not null and read_at is null and archived_at is null
        do update set occurrence_count = public.notifications.occurrence_count + 1,
                      last_occurred_at = now(), updated_at = now()
      `;
    });
  }
}

export async function getSecurityWorkspaceData(): Promise<SecurityWorkspaceResult> {
  const authorization = await authorizeCurrentUser([securityPermissionKeys.view]);
  if (!authorization.allowed) return { allowed: false, reason: authorization.reason };

  const context = authorization.context;
  const organizationScope =
    context.permissionScopes.get(securityPermissionKeys.view) === "organization";
  const database = getDatabaseClient();
  const identitySession = await getCurrentIdentitySession();
  const currentSessionId = identitySession?.id ?? null;
  const currentAal = identitySession?.assuranceLevel ?? "aal1";

  const [policyRow, sessionRows, memberRows, eventRows, incidentRows, drillRows, factorRows] =
    await Promise.all([
      database<SecurityPolicyRow[]>`
        select * from public.organization_security_policies
        where organization_id = ${context.membership.organizationId}::uuid limit 1
      `,
      database<
        {
          id: string;
          membership_id: string;
          status: "active" | "revoked" | "expired";
          assurance_level: "aal1" | "aal2";
          ip_address: string | null;
          user_agent: string | null;
          created_at: Date;
          last_seen_at: Date;
          absolute_expires_at: Date;
          idle_expires_at: Date;
          reauthenticated_at: Date | null;
          revoked_at: Date | null;
          revocation_reason: string | null;
          member_name: string;
          member_email: string;
        }[]
      >`
        select session.id, session.membership_id, session.status, session.assurance_level,
               session.ip_address::text, session.user_agent, session.created_at, session.last_seen_at,
               session.absolute_expires_at, session.idle_expires_at, session.reauthenticated_at,
               session.revoked_at, session.revocation_reason,
               coalesce(profile.display_name, auth_user.email, 'AgencyOS member') as member_name,
               coalesce(auth_user.email, '') as member_email
        from public.security_sessions as session
        join public.memberships as membership on membership.id = session.membership_id
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.profiles as profile on profile.id = membership.user_id
        where session.organization_id = ${context.membership.organizationId}::uuid
          and (${organizationScope} or session.membership_id = ${context.membership.id}::uuid)
        order by (session.status = 'active') desc, session.last_seen_at desc
        limit 100
      `,
      organizationScope
        ? database<
            {
              membership_id: string;
              name: string;
              email: string;
              status: string;
              privileged: boolean;
              verified_mfa_factors: number;
              active_sessions: number;
            }[]
          >`
            select membership.id as membership_id,
                   coalesce(profile.display_name, auth_user.email, 'AgencyOS member') as name,
                   coalesce(auth_user.email, '') as email,
                   membership.status,
                   exists (
                     select 1 from public.membership_roles assignment
                     join public.roles role on role.id = assignment.role_id
                     where assignment.membership_id = membership.id
                       and role.organization_id = membership.organization_id
                       and role.status = 'active' and role.is_privileged
                   ) as privileged,
                   (select count(*)::integer from public.identity_mfa_factors factor
                    where factor.user_id = membership.user_id and factor.status = 'verified') as verified_mfa_factors,
                   (select count(*)::integer from public.security_sessions session
                    where session.membership_id = membership.id and session.status = 'active') as active_sessions
            from public.memberships membership
            join public.identity_accounts auth_user on auth_user.id = membership.user_id
            left join public.profiles profile on profile.id = membership.user_id
            where membership.organization_id = ${context.membership.organizationId}::uuid
            order by name asc
            limit 500
          `
        : Promise.resolve([]),
      database<
        {
          id: string;
          membership_id: string | null;
          member_name: string | null;
          event_type: string;
          severity: "info" | "warning" | "critical";
          ip_address: string | null;
          occurred_at: Date;
          metadata: Record<string, unknown>;
        }[]
      >`
        select event.id::text, event.membership_id,
               coalesce(profile.display_name, auth_user.email) as member_name,
               event.event_type, event.severity, event.ip_address::text,
               event.occurred_at, event.metadata
        from public.security_events event
        left join public.memberships membership on membership.id = event.membership_id
        left join public.identity_accounts auth_user on auth_user.id = membership.user_id
        left join public.profiles profile on profile.id = membership.user_id
        where event.organization_id = ${context.membership.organizationId}::uuid
          and (${organizationScope} or event.membership_id = ${context.membership.id}::uuid)
        order by event.occurred_at desc, event.id desc
        limit 100
      `,
      organizationScope
        ? database<
            {
              id: string;
              incident_number: string;
              title: string;
              severity: SecurityIncidentItem["severity"];
              status: SecurityIncidentItem["status"];
              classification: string;
              summary: string;
              containment_summary: string | null;
              communication_status: string;
              detected_at: Date;
              resolved_at: Date | null;
              owner_name: string | null;
            }[]
          >`
            select incident.id, incident.incident_number, incident.title, incident.severity,
                   incident.status, incident.classification, incident.summary,
                   incident.containment_summary, incident.communication_status,
                   incident.detected_at, incident.resolved_at,
                   coalesce(profile.display_name, auth_user.email) as owner_name
            from public.security_incidents incident
            left join public.memberships owner on owner.id = incident.owner_membership_id
            left join public.identity_accounts auth_user on auth_user.id = owner.user_id
            left join public.profiles profile on profile.id = owner.user_id
            where incident.organization_id = ${context.membership.organizationId}::uuid
            order by incident.detected_at desc limit 100
          `
        : Promise.resolve([]),
      organizationScope
        ? database<
            {
              id: string;
              drill_type: string;
              status: SecurityRestoreDrillItem["status"];
              runbook_version: string;
              started_at: Date;
              completed_at: Date | null;
              recovery_point_minutes: number | null;
              recovery_time_minutes: number | null;
              evidence_summary: string;
              executed_by_name: string;
            }[]
          >`
            select drill.id, drill.drill_type, drill.status, drill.runbook_version,
                   drill.started_at, drill.completed_at, drill.recovery_point_minutes,
                   drill.recovery_time_minutes, drill.evidence_summary,
                   coalesce(profile.display_name, auth_user.email, 'AgencyOS member') as executed_by_name
            from public.security_restore_drills drill
            join public.memberships membership on membership.id = drill.executed_by_membership_id
            join public.identity_accounts auth_user on auth_user.id = membership.user_id
            left join public.profiles profile on profile.id = membership.user_id
            where drill.organization_id = ${context.membership.organizationId}::uuid
            order by drill.started_at desc limit 100
          `
        : Promise.resolve([]),
      database<{ verified_mfa_factors: number }[]>`
        select count(*)::integer as verified_mfa_factors
        from public.identity_mfa_factors factor
        where factor.user_id = ${context.user.id}::uuid and factor.status = 'verified'
      `,
    ]);

  const sessions: SecuritySessionItem[] = sessionRows.map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    status: row.status,
    assuranceLevel: row.assurance_level,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: iso(row.created_at)!,
    lastSeenAt: iso(row.last_seen_at)!,
    absoluteExpiresAt: iso(row.absolute_expires_at)!,
    idleExpiresAt: iso(row.idle_expires_at)!,
    reauthenticatedAt: iso(row.reauthenticated_at),
    revokedAt: iso(row.revoked_at),
    revocationReason: row.revocation_reason,
    current: row.id === currentSessionId,
    own: row.membership_id === context.membership.id,
  }));
  const members: SecurityMemberItem[] = memberRows.map((row) => ({
    membershipId: row.membership_id,
    name: row.name,
    email: row.email,
    status: row.status,
    privileged: row.privileged,
    verifiedMfaFactors: row.verified_mfa_factors,
    activeSessions: row.active_sessions,
  }));
  const events: SecurityEventItem[] = eventRows.map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    memberName: row.member_name,
    eventType: row.event_type,
    severity: row.severity,
    ipAddress: row.ip_address,
    occurredAt: iso(row.occurred_at)!,
    metadata: recordValue(row.metadata),
  }));
  const incidents: SecurityIncidentItem[] = incidentRows.map((row) => ({
    id: row.id,
    incidentNumber: row.incident_number,
    title: row.title,
    severity: row.severity,
    status: row.status,
    classification: row.classification,
    summary: row.summary,
    containmentSummary: row.containment_summary,
    communicationStatus: row.communication_status,
    detectedAt: iso(row.detected_at)!,
    resolvedAt: iso(row.resolved_at),
    ownerName: row.owner_name,
  }));
  const restoreDrills: SecurityRestoreDrillItem[] = drillRows.map((row) => ({
    id: row.id,
    drillType: row.drill_type,
    status: row.status,
    runbookVersion: row.runbook_version,
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    recoveryPointMinutes: row.recovery_point_minutes,
    recoveryTimeMinutes: row.recovery_time_minutes,
    evidenceSummary: row.evidence_summary,
    executedByName: row.executed_by_name,
  }));
  const currentSession = sessions.find((session) => session.current);

  return {
    allowed: true,
    data: {
      policy: policyFromRow(policyRow[0]),
      sessions,
      members,
      events,
      incidents,
      restoreDrills,
      capabilities: {
        organizationScope,
        managePolicy: context.permissions.has(securityPermissionKeys.manage),
        revokeOrganizationSessions: context.permissions.has(securityPermissionKeys.revoke),
        resetMfa: context.permissions.has(securityPermissionKeys.resetMfa),
        recordOperations: context.permissions.has(securityPermissionKeys.manage),
      },
      current: {
        sessionId: currentSessionId,
        membershipId: context.membership.id,
        privileged: context.security.privileged,
        assuranceLevel: currentAal,
        verifiedMfaFactors: factorRows[0]?.verified_mfa_factors ?? 0,
        recentReauthentication: currentSession
          ? Boolean(
              currentSession.reauthenticatedAt &&
              new Date(currentSession.reauthenticatedAt).getTime() >=
                Date.now() - policyFromRow(policyRow[0]).reauthenticationMinutes * 60_000,
            )
          : false,
      },
    },
  };
}

export async function getRequestContextForSecurityAction(): Promise<RequestSecurityContext> {
  return getRequestSecurityContext();
}
