import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import {
  authorizeCurrentUser,
  type AuthorizationFailureReason,
} from "@/modules/permissions/server/authorization";

export const permissionViewerPermissionKeys = {
  view: "settings.permission.view",
} as const;

export interface PermissionViewerMember {
  membershipId: string;
  displayName: string;
  email: string;
  status: "active" | "deactivated" | "invited" | "suspended";
  roleNames: string[];
}

export interface EffectivePermissionItem {
  key: string;
  module: string;
  description: string;
  isSensitive: boolean;
  allowed: boolean;
  roleSources: string[];
  overrideEffect: "allow" | "deny" | null;
  overrideScope: string | null;
  overrideReason: string | null;
  overrideExpiresAt: string | null;
}

export interface PermissionViewerData {
  organization: {
    id: string;
    legalName: string;
  };
  members: PermissionViewerMember[];
  selectedMember: PermissionViewerMember;
  permissions: EffectivePermissionItem[];
  summary: {
    allowed: number;
    denied: number;
    sensitiveAllowed: number;
  };
}

export type PermissionViewerResult =
  | { allowed: true; data: PermissionViewerData }
  | { allowed: false; reason: AuthorizationFailureReason | "membership-not-found" };

interface OrganizationRow {
  id: string;
  legal_name: string;
}

interface MemberRow {
  membership_id: string;
  display_name: string;
  email: string;
  status: PermissionViewerMember["status"];
  role_names: string[];
}

interface PermissionRow {
  key: string;
  module: string;
  description: string;
  is_sensitive: boolean;
  allowed: boolean;
  role_sources: string[];
  override_effect: "allow" | "deny" | null;
  override_scope: string | null;
  override_reason: string | null;
  override_expires_at: Date | null;
}

function mapMember(row: MemberRow): PermissionViewerMember {
  return {
    membershipId: row.membership_id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    roleNames: row.role_names,
  };
}

export async function getPermissionViewerData(
  requestedMembershipId?: string,
): Promise<PermissionViewerResult> {
  const authorization = await authorizeCurrentUser([permissionViewerPermissionKeys.view]);

  if (!authorization.allowed) {
    return authorization;
  }

  const database = getDatabaseClient();
  const organizationId = authorization.context.membership.organizationId;
  const selectedMembershipId = requestedMembershipId || authorization.context.membership.id;

  try {
    const [organizations, memberRows] = await withInfrastructureRetry(
      () =>
        Promise.all([
          database<OrganizationRow[]>`
        select id, legal_name
        from public.organizations
        where id = ${organizationId}::uuid
          and status = 'active'
        limit 1
      `,
          database<MemberRow[]>`
        select
          membership.id::text as membership_id,
          coalesce(
            profile.display_name,
            nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
            auth_user.email,
            'AgencyOS user'
          ) as display_name,
          coalesce(auth_user.email, '') as email,
          membership.status,
          coalesce(
            array_agg(distinct role.name order by role.name)
              filter (where role.id is not null),
            '{}'::text[]
          ) as role_names
        from public.memberships as membership
        join public.identity_accounts as auth_user
          on auth_user.id = membership.user_id
        left join public.profiles as profile
          on profile.id = membership.user_id
        left join public.membership_roles as assignment
          on assignment.membership_id = membership.id
        left join public.roles as role
          on role.id = assignment.role_id
         and role.organization_id = membership.organization_id
         and role.status = 'active'
        where membership.organization_id = ${organizationId}::uuid
        group by
          membership.id,
          auth_user.email,
          auth_user.raw_user_meta_data,
          profile.display_name
        order by display_name asc, email asc
      `,
        ]),
      { operationName: "Permission viewer member lookup" },
    );

    const members = memberRows.map(mapMember);
    const selectedMember = members.find((member) => member.membershipId === selectedMembershipId);

    if (!organizations[0] || !selectedMember) {
      return { allowed: false, reason: "membership-not-found" };
    }

    const permissionRows = await withInfrastructureRetry(
      () => database<PermissionRow[]>`
      with role_grants as (
        select
          permission.id as permission_id,
          role.name as role_name,
          role_permission.scope
        from public.membership_roles as assignment
        join public.roles as role
          on role.id = assignment.role_id
         and role.organization_id = ${organizationId}::uuid
         and role.status = 'active'
        join public.role_permissions as role_permission
          on role_permission.role_id = role.id
        join public.permissions as permission
          on permission.id = role_permission.permission_id
        where assignment.membership_id = ${selectedMembershipId}::uuid
      ),
      grants_by_permission as (
        select
          permission_id,
          array_agg(distinct role_name || ' · ' || scope order by role_name || ' · ' || scope) as role_sources
        from role_grants
        group by permission_id
      ),
      active_overrides as (
        select
          permission_id,
          effect,
          scope,
          reason,
          expires_at
        from public.membership_permission_overrides
        where membership_id = ${selectedMembershipId}::uuid
          and (expires_at is null or expires_at > now())
      )
      select
        permission.key,
        permission.module,
        permission.description,
        permission.is_sensitive,
        (
          (grant_summary.permission_id is not null or override_grant.effect = 'allow')
          and coalesce(override_grant.effect <> 'deny', true)
        ) as allowed,
        coalesce(grant_summary.role_sources, '{}'::text[]) as role_sources,
        override_grant.effect as override_effect,
        override_grant.scope as override_scope,
        override_grant.reason as override_reason,
        override_grant.expires_at as override_expires_at
      from public.permissions as permission
      left join grants_by_permission as grant_summary
        on grant_summary.permission_id = permission.id
      left join active_overrides as override_grant
        on override_grant.permission_id = permission.id
      order by permission.module asc, permission.key asc
    `,
      { operationName: "Permission viewer effective permission lookup" },
    );

    const permissions = permissionRows.map((row) => ({
      key: row.key,
      module: row.module,
      description: row.description,
      isSensitive: row.is_sensitive,
      allowed: row.allowed,
      roleSources: row.role_sources,
      overrideEffect: row.override_effect,
      overrideScope: row.override_scope,
      overrideReason: row.override_reason,
      overrideExpiresAt: row.override_expires_at?.toISOString() ?? null,
    }));

    return {
      allowed: true,
      data: {
        organization: {
          id: organizations[0].id,
          legalName: organizations[0].legal_name,
        },
        members,
        selectedMember,
        permissions,
        summary: {
          allowed: permissions.filter((permission) => permission.allowed).length,
          denied: permissions.filter((permission) => !permission.allowed).length,
          sensitiveAllowed: permissions.filter(
            (permission) => permission.allowed && permission.isSensitive,
          ).length,
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
