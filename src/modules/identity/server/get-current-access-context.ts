import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContext } from "@/lib/server/request-context";
import { withInfrastructureRetry } from "@/lib/server/retry";
import { getCurrentIdentitySession } from "@/modules/identity/server/auth-session";
import { getWorkspaceCounters } from "@/modules/identity/server/workspace-counters";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import {
  evaluateCurrentSecuritySession,
  type SessionSecurityState,
} from "@/modules/security/server/session-security";

export type AccessDenialReason =
  | "access-check-failed"
  | "insufficient-permission"
  | "invitation-pending"
  | "membership-inactive"
  | "mfa-required"
  | "no-membership"
  | "organization-inactive"
  | "role-pending"
  | "session-expired"
  | "session-revoked"
  | "signed-out";

export interface AccessPermissionRow {
  key: string;
  scope: PermissionScope | null;
  effect: "allow" | "deny";
  source: "override" | "role";
}

export interface CurrentAccessContext {
  user: {
    id: string;
    email: string;
    metadata: Record<string, unknown>;
  };
  membership: {
    id: string;
    organizationId: string;
  };
  unreadNotificationCount: number;
  pendingApprovalCount: number;
  permissionRows: readonly AccessPermissionRow[];
  security: SessionSecurityState;
}

export type CurrentAccessResult =
  { allowed: true; context: CurrentAccessContext } | { allowed: false; reason: AccessDenialReason };

interface MembershipAccessRow {
  id: string;
  organization_id: string;
  membership_status: "active" | "deactivated" | "invited" | "suspended";
  organization_status: "active" | "suspended" | "archived" | null;
  has_active_role: boolean;
  has_privileged_role: boolean;
  permission_rows: AccessPermissionRow[];
}

export async function getCurrentAccessContext(): Promise<CurrentAccessResult> {
  try {
    const identitySession = await getCurrentIdentitySession({ allowPendingMfa: true });
    if (!identitySession) return { allowed: false, reason: "signed-out" };
    if (identitySession.status === "pending_mfa") return { allowed: false, reason: "mfa-required" };

    const userId = identitySession.userId;
    const email = identitySession.email;
    const sessionId = identitySession.id;
    const assuranceLevel = identitySession.assuranceLevel;
    const issuedAt = identitySession.issuedAt;

    const database = getDatabaseClient();
    const memberships = await withInfrastructureRetry(
      () => database<MembershipAccessRow[]>`
        select
          membership.id,
          membership.organization_id,
          membership.status as membership_status,
          organization.status as organization_status,
          exists (
            select 1
            from public.membership_roles as assignment
            join public.roles as role
              on role.id = assignment.role_id
             and role.organization_id = membership.organization_id
             and role.status = 'active'
            where assignment.membership_id = membership.id
          ) as has_active_role,
          exists (
            select 1
            from public.membership_roles as assignment
            join public.roles as role
              on role.id = assignment.role_id
             and role.organization_id = membership.organization_id
             and role.status = 'active'
             and role.is_privileged
            where assignment.membership_id = membership.id
          ) as has_privileged_role,
          case
            when membership.status = 'active' and organization.status = 'active' then
              coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'key', grant_row.key,
                    'scope', grant_row.scope,
                    'effect', grant_row.effect,
                    'source', grant_row.source
                  )
                )
                from (
                  select
                    permission.key,
                    role_permission.scope::text as scope,
                    'allow'::text as effect,
                    'role'::text as source
                  from public.membership_roles as assignment
                  join public.roles as role
                    on role.id = assignment.role_id
                   and role.organization_id = membership.organization_id
                   and role.status = 'active'
                  join public.role_permissions as role_permission
                    on role_permission.role_id = role.id
                  join public.permissions as permission
                    on permission.id = role_permission.permission_id
                  where assignment.membership_id = membership.id

                  union all

                  select
                    permission.key,
                    override_grant.scope::text,
                    override_grant.effect::text,
                    'override'::text
                  from public.membership_permission_overrides as override_grant
                  join public.permissions as permission
                    on permission.id = override_grant.permission_id
                  where override_grant.membership_id = membership.id
                    and (override_grant.expires_at is null or override_grant.expires_at > now())
                ) as grant_row
              ), '[]'::jsonb)
            else '[]'::jsonb
          end as permission_rows
        from public.memberships as membership
        left join public.organizations as organization
          on organization.id = membership.organization_id
        where membership.user_id = ${userId}::uuid
        order by
          case when membership.status = 'active' then 0 else 1 end,
          membership.created_at asc
      `,
      { attempts: 2, operationName: "Current membership and permission lookup" },
    );

    const usableMembership = memberships.find(
      (membership) =>
        membership.membership_status === "active" &&
        membership.organization_status === "active" &&
        membership.has_active_role,
    );

    if (usableMembership) {
      const request = await getRequestSecurityContext();
      const [security, counters] = await Promise.all([
        evaluateCurrentSecuritySession({
          organizationId: usableMembership.organization_id,
          membershipId: usableMembership.id,
          userId,
          sessionId,
          assuranceLevel,
          issuedAt,
          privileged: usableMembership.has_privileged_role,
          request,
        }),
        getWorkspaceCounters(usableMembership.organization_id, usableMembership.id),
      ]);
      if (!security.allowed) return security;

      return {
        allowed: true,
        context: {
          user: {
            id: userId,
            email,
            metadata: identitySession.metadata,
          },
          membership: {
            id: usableMembership.id,
            organizationId: usableMembership.organization_id,
          },
          unreadNotificationCount: counters.unreadNotificationCount,
          pendingApprovalCount: counters.pendingApprovalCount,
          permissionRows: usableMembership.permission_rows ?? [],
          security: security.state,
        },
      };
    }

    if (memberships.some((membership) => membership.membership_status === "invited")) {
      return { allowed: false, reason: "invitation-pending" };
    }

    const activeMemberships = memberships.filter(
      (membership) => membership.membership_status === "active",
    );

    if (activeMemberships.length === 0) {
      return memberships.length > 0
        ? { allowed: false, reason: "membership-inactive" }
        : { allowed: false, reason: "no-membership" };
    }

    if (
      activeMemberships.some(
        (membership) => membership.organization_status === "active" && !membership.has_active_role,
      )
    ) {
      return { allowed: false, reason: "role-pending" };
    }

    return { allowed: false, reason: "organization-inactive" };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
