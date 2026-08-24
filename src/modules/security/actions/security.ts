"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContext } from "@/lib/server/request-context";
import { getCurrentIdentitySession } from "@/modules/identity/server/auth-session";
import { verifyIdentityPassword } from "@/modules/identity/server/credentials";
import { toJsonValue } from "@/lib/server/json-value";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  reauthenticateSchema,
  resetMfaSchema,
  restoreDrillSchema,
  revokeSessionSchema,
  securityIncidentCreateSchema,
  securityIncidentUpdateSchema,
  securityPolicySchema,
  type SecurityActionState,
} from "@/modules/security/schemas/security";
import { securityPermissionKeys } from "@/modules/security/security";
import {
  appendSecurityEvent,
  requireRecentReauthentication,
} from "@/modules/security/server/security";

class SecurityActionError extends Error {}

function success(message: string): SecurityActionState {
  return { status: "success", message };
}

function failure(message: string, fieldErrors?: Record<string, string[]>): SecurityActionState {
  return { status: "error", message, fieldErrors };
}

async function authorize(permission: string, recent = false) {
  const result = await authorizeCurrentUser([permission]);
  if (!result.allowed) {
    throw new SecurityActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this security action."
        : "Your session or organization access is no longer active.",
    );
  }
  if (recent) await requireRecentReauthentication(result.context);
  return result.context;
}

function refreshSecurity(): void {
  revalidatePath("/settings/security");
  revalidatePath("/settings");
}

export async function reauthenticateSecurityAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = reauthenticateSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return failure("Enter your current password.");

  try {
    const context = await authorize(securityPermissionKeys.view);
    const request = await getRequestSecurityContext();
    const verified = await verifyIdentityPassword({
      userId: context.user.id,
      password: parsed.data.password,
    });
    if (!verified) {
      await appendSecurityEvent({
        organizationId: context.membership.organizationId,
        membershipId: context.membership.id,
        sessionId: context.security.sessionId,
        eventType: "security.reauthentication_failed",
        severity: "warning",
        request,
      });
      return failure("The password was not accepted.");
    }

    const identitySession = await getCurrentIdentitySession();
    const sessionId = identitySession?.id ?? context.security.sessionId;
    if (!sessionId) throw new SecurityActionError("The current session could not be identified.");

    const database = getDatabaseClient();
    await database`
      update public.security_sessions
      set reauthenticated_at = now(), last_seen_at = now()
      where id = ${sessionId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
        and membership_id = ${context.membership.id}::uuid
        and status = 'active'
    `;
    await appendSecurityEvent({
      organizationId: context.membership.organizationId,
      membershipId: context.membership.id,
      sessionId,
      eventType: "security.reauthentication_succeeded",
      request,
    });
    refreshSecurity();
    return success("Identity confirmed. Sensitive security actions are unlocked temporarily.");
  } catch (error) {
    return failure(
      error instanceof SecurityActionError || error instanceof Error
        ? error.message
        : "Identity confirmation failed.",
    );
  }
}

export async function updateSecurityPolicyAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = securityPolicySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return failure(
      "Check the security-policy values and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize(securityPermissionKeys.manage, true);
    const request = await getRequestSecurityContext();
    const database = getDatabaseClient();
    const policy = parsed.data;
    await database.begin(async (sql) => {
      const [before] = await sql<Record<string, unknown>[]>`
        select * from public.organization_security_policies
        where organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      await sql`
        update public.organization_security_policies
        set require_privileged_mfa = ${Boolean(policy.requirePrivilegedMfa)},
            recommend_mfa = ${Boolean(policy.recommendMfa)},
            absolute_session_minutes = ${policy.absoluteSessionMinutes},
            idle_timeout_minutes = ${policy.idleTimeoutMinutes},
            reauthentication_minutes = ${policy.reauthenticationMinutes},
            suspicious_failure_threshold = ${policy.suspiciousFailureThreshold},
            suspicious_window_minutes = ${policy.suspiciousWindowMinutes},
            login_limit_per_window = ${policy.loginLimitPerWindow},
            password_reset_limit_per_window = ${policy.passwordResetLimitPerWindow},
            api_limit_per_minute = ${policy.apiLimitPerMinute},
            ai_limit_per_minute = ${policy.aiLimitPerMinute},
            worker_limit_per_minute = ${policy.workerLimitPerMinute},
            export_limit_per_minute = ${policy.exportLimitPerMinute},
            mcp_limit_per_minute = ${policy.mcpLimitPerMinute},
            updated_by_membership_id = ${context.membership.id}::uuid
        where organization_id = ${context.membership.organizationId}::uuid
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          request_id, source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${context.user.id}::uuid,
          'security.policy.updated',
          'organization_security_policy',
          ${context.membership.organizationId},
          ${request.requestId},
          'web',
          ${sql.json(toJsonValue(before ?? {}))},
          ${sql.json(toJsonValue(policy))},
          ${Object.keys(policy)}::text[],
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id }))}
        )
      `;
    });
    await appendSecurityEvent({
      organizationId: context.membership.organizationId,
      membershipId: context.membership.id,
      sessionId: context.security.sessionId,
      eventType: "security.policy_updated",
      request,
      metadata: { fields: Object.keys(policy) },
    });
    refreshSecurity();
    return success("Security policy updated.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Security policy could not be updated.",
    );
  }
}

export async function revokeSecuritySessionAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = revokeSessionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return failure("Choose a valid session and provide a reason.");

  try {
    const viewContext = await authorize(securityPermissionKeys.view);
    const database = getDatabaseClient();
    const [target] = await database<{ membership_id: string; user_id: string; status: string }[]>`
      select membership_id, user_id, status
      from public.security_sessions
      where id = ${parsed.data.sessionId}::uuid
        and organization_id = ${viewContext.membership.organizationId}::uuid
      limit 1
    `;
    if (!target) throw new SecurityActionError("The session was not found.");
    const own = target.membership_id === viewContext.membership.id;
    const context = own ? viewContext : await authorize(securityPermissionKeys.revoke, true);
    const request = await getRequestSecurityContext();

    await database.begin(async (sql) => {
      await sql`
        update public.security_sessions
        set status = 'revoked', revoked_at = now(),
            revoked_by_membership_id = ${context.membership.id}::uuid,
            revocation_reason = ${parsed.data.reason}
        where id = ${parsed.data.sessionId}::uuid and status = 'active'
      `;
      await sql`
        update public.identity_sessions
        set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
            revocation_reason = coalesce(revocation_reason, ${parsed.data.reason})
        where id = ${parsed.data.sessionId}::uuid
          and user_id = ${target.user_id}::uuid
          and status in ('pending_mfa', 'active')
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          request_id, source, after_state, metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${context.user.id}::uuid,
          'security.session.revoked',
          'security_session',
          ${parsed.data.sessionId},
          ${request.requestId},
          'web',
          ${sql.json(toJsonValue({ status: "revoked", reason: parsed.data.reason }))},
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id, targetMembershipId: target.membership_id }))}
        )
      `;
    });
    await appendSecurityEvent({
      organizationId: context.membership.organizationId,
      membershipId: target.membership_id,
      sessionId: parsed.data.sessionId,
      eventType: "security.session_revoked",
      severity: "warning",
      request,
      metadata: { reason: parsed.data.reason, actorMembershipId: context.membership.id },
    });
    refreshSecurity();
    return success("Session revoked.");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The session could not be revoked.");
  }
}

export async function resetMembershipMfaAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = resetMfaSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return failure("Choose a valid organization member.");

  try {
    const context = await authorize(securityPermissionKeys.resetMfa, true);
    if (parsed.data.membershipId === context.membership.id) {
      throw new SecurityActionError("Administrators cannot reset their own MFA from this control.");
    }
    const request = await getRequestSecurityContext();
    const database = getDatabaseClient();
    const [target] = await database<{ user_id: string }[]>`
      select user_id from public.memberships
      where id = ${parsed.data.membershipId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
      limit 1
    `;
    if (!target) throw new SecurityActionError("The member was not found.");

    await database.begin(async (sql) => {
      await sql`delete from public.identity_mfa_factors where user_id = ${target.user_id}::uuid`;
      await sql`
        update public.identity_sessions
        set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
            revocation_reason = coalesce(revocation_reason, 'mfa_reset')
        where user_id = ${target.user_id}::uuid and status in ('pending_mfa', 'active')
      `;
      await sql`
        update public.security_sessions
        set status = 'revoked', revoked_at = now(),
            revoked_by_membership_id = ${context.membership.id}::uuid,
            revocation_reason = 'mfa_reset'
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
          and status = 'active'
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          request_id, source, after_state, metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${context.user.id}::uuid,
          'security.mfa.reset',
          'membership',
          ${parsed.data.membershipId},
          ${request.requestId},
          'web',
          ${sql.json(toJsonValue({ mfaReset: true, sessionsRevoked: true }))},
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id }))}
        )
      `;
    });
    await appendSecurityEvent({
      organizationId: context.membership.organizationId,
      membershipId: parsed.data.membershipId,
      eventType: "security.mfa_reset",
      severity: "critical",
      request,
      metadata: { actorMembershipId: context.membership.id },
    });
    refreshSecurity();
    return success("MFA factors reset and active sessions revoked.");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "MFA could not be reset.");
  }
}

export async function createSecurityIncidentAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = securityIncidentCreateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return failure("Check the incident fields and try again.", parsed.error.flatten().fieldErrors);
  }
  try {
    const context = await authorize(securityPermissionKeys.manage);
    const request = await getRequestSecurityContext();
    const database = getDatabaseClient();
    const incidentNumber = `SEC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    await database.begin(async (sql) => {
      const [incident] = await sql<{ id: string }[]>`
        insert into public.security_incidents (
          organization_id, incident_number, title, severity, classification,
          summary, detected_at, owner_membership_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${incidentNumber}, ${parsed.data.title},
          ${parsed.data.severity}, ${parsed.data.classification}, ${parsed.data.summary}, now(),
          ${parsed.data.ownerMembershipId}::uuid, ${context.membership.id}::uuid
        ) returning id
      `;
      if (!incident) throw new SecurityActionError("The incident could not be created.");
      await sql`
        insert into public.security_incident_events (
          organization_id, incident_id, event_type, actor_membership_id, summary, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${incident.id}::uuid,
          'security.incident_created', ${context.membership.id}::uuid,
          'Incident recorded and awaiting triage.', '{}'::jsonb
        )
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          request_id, source, after_state, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'security.incident.created', 'security_incident', ${incident.id},
          ${request.requestId}, 'web',
          ${sql.json(toJsonValue({ incidentNumber, title: parsed.data.title, severity: parsed.data.severity, classification: parsed.data.classification }))},
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id }))}
        )
      `;
    });
    refreshSecurity();
    return success(`Incident ${incidentNumber} recorded.`);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The incident could not be recorded.");
  }
}

export async function updateSecurityIncidentAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = securityIncidentUpdateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return failure("Choose a valid incident status.");
  try {
    const context = await authorize(securityPermissionKeys.manage);
    const request = await getRequestSecurityContext();
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const [incident] = await sql<{ title: string; status: string }[]>`
        select title, status from public.security_incidents
        where id = ${parsed.data.incidentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      if (!incident) throw new SecurityActionError("The incident was not found.");
      await sql`
        update public.security_incidents
        set status = ${parsed.data.status},
            containment_summary = nullif(${parsed.data.containmentSummary}, ''),
            communication_status = ${parsed.data.communicationStatus},
            contained_at = case when ${parsed.data.status} in ('contained', 'resolved', 'closed') then coalesce(contained_at, now()) else contained_at end,
            resolved_at = case when ${parsed.data.status} in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
        where id = ${parsed.data.incidentId}::uuid
      `;
      await sql`
        insert into public.security_incident_events (
          organization_id, incident_id, event_type, actor_membership_id, summary, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.incidentId}::uuid,
          'security.incident_status_changed', ${context.membership.id}::uuid,
          ${`Incident status changed from ${incident.status} to ${parsed.data.status}.`},
          ${sql.json(toJsonValue({ from: incident.status, to: parsed.data.status, communicationStatus: parsed.data.communicationStatus }))}
        )
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          request_id, source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'security.incident.updated', 'security_incident', ${parsed.data.incidentId},
          ${request.requestId}, 'web',
          ${sql.json(toJsonValue({ status: incident.status }))},
          ${sql.json(toJsonValue({ status: parsed.data.status, communicationStatus: parsed.data.communicationStatus }))},
          ${["status", "containment_summary", "communication_status"]}::text[],
          ${sql.json(toJsonValue({ actorMembershipId: context.membership.id }))}
        )
      `;
    });
    refreshSecurity();
    return success("Incident status updated.");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The incident could not be updated.");
  }
}

export async function recordRestoreDrillAction(
  _previous: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const parsed = restoreDrillSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return failure(
      "Check the restore-drill evidence and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  try {
    const context = await authorize(securityPermissionKeys.manage, true);
    const request = await getRequestSecurityContext();
    const database = getDatabaseClient();
    const [drill] = await database<{ id: string }[]>`
      insert into public.security_restore_drills (
        organization_id, drill_type, status, runbook_version, started_at, completed_at,
        recovery_point_minutes, recovery_time_minutes, evidence_summary, evidence_hash,
        executed_by_membership_id
      ) values (
        ${context.membership.organizationId}::uuid, ${parsed.data.drillType}, ${parsed.data.status},
        ${parsed.data.runbookVersion}, ${parsed.data.startedAt}::timestamptz,
        ${parsed.data.completedAt}::timestamptz, ${parsed.data.recoveryPointMinutes},
        ${parsed.data.recoveryTimeMinutes}, ${parsed.data.evidenceSummary},
        ${parsed.data.evidenceHash}, ${context.membership.id}::uuid
      ) returning id
    `;
    if (!drill) throw new SecurityActionError("The restore drill was not recorded.");
    await appendSecurityEvent({
      organizationId: context.membership.organizationId,
      membershipId: context.membership.id,
      sessionId: context.security.sessionId,
      eventType: "security.restore_drill_recorded",
      severity: parsed.data.status === "failed" ? "critical" : "info",
      request,
      metadata: {
        drillId: drill.id,
        drillType: parsed.data.drillType,
        status: parsed.data.status,
        recoveryPointMinutes: parsed.data.recoveryPointMinutes,
        recoveryTimeMinutes: parsed.data.recoveryTimeMinutes,
      },
    });
    await database`
      insert into public.audit_events (
        organization_id, actor_user_id, action, entity_type, entity_id,
        request_id, source, after_state, metadata
      ) values (
        ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
        'security.restore_drill.recorded', 'security_restore_drill', ${drill.id},
        ${request.requestId}, 'web',
        ${database.json(toJsonValue({ drillType: parsed.data.drillType, status: parsed.data.status, runbookVersion: parsed.data.runbookVersion }))},
        ${database.json(toJsonValue({ actorMembershipId: context.membership.id }))}
      )
    `;
    refreshSecurity();
    return success("Restore-drill evidence recorded.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "The restore drill could not be recorded.",
    );
  }
}
