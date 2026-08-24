import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  hasEveryPermission,
} from "@/modules/permissions/server/effective-permissions";

export const accessManagementPermissionKeys = {
  createUser: "settings.user.create",
  manageRoleAccess: "settings.role.manage_access",
  manageUserAccess: "settings.user.manage_access",
  updateUser: "settings.user.update",
  viewUsers: "settings.user.view",
} as const;

export type AccessManagementPermissionKey =
  (typeof accessManagementPermissionKeys)[keyof typeof accessManagementPermissionKeys];

export interface AccessManagementRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isPrivileged: boolean;
}

export interface AccessManagementMember {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  status: "active" | "deactivated" | "invited" | "suspended";
  roleIds: string[];
  roleNames: string[];
  createdAt: string;
  activatedAt: string | null;
}

export interface AccessManagementData {
  actorUserId: string;
  organization: {
    id: string;
    legalName: string;
    slug: string;
  };
  roles: AccessManagementRole[];
  members: AccessManagementMember[];
  capabilities: {
    canGrantAccess: boolean;
    canManageRoles: boolean;
    canManageStatus: boolean;
  };
}

export type AccessManagementResult =
  | { allowed: true; data: AccessManagementData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  id: string;
  legal_name: string;
  slug: string;
}

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_privileged: boolean;
}

interface MemberRow {
  membership_id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: "active" | "deactivated" | "invited" | "suspended";
  role_ids: string[];
  role_names: string[];
  created_at: string;
  activated_at: string | null;
}

interface AccessManagementPayloadRow {
  organization: OrganizationRow | null;
  roles: RoleRow[];
  members: MemberRow[];
}

export async function getAccessManagementData(): Promise<AccessManagementResult> {
  const permissionContext = await getCurrentPermissionContext();

  if (!permissionContext.allowed) {
    return { allowed: false, reason: permissionContext.reason };
  }

  const { membership, permissions, user } = permissionContext.context;

  try {
    if (!permissions.has(accessManagementPermissionKeys.viewUsers)) {
      return { allowed: false, reason: "insufficient-permission" };
    }

    const database = getDatabaseClient();
    const rows = await withInfrastructureRetry(
      () => database<AccessManagementPayloadRow[]>`
        select
          (
            select jsonb_build_object(
              'id', organization.id,
              'legal_name', organization.legal_name,
              'slug', organization.slug
            )
            from public.organizations as organization
            where organization.id = ${membership.organizationId}::uuid
              and organization.status = 'active'
            limit 1
          ) as organization,
          coalesce((
            select jsonb_agg(role_row.payload order by role_row.is_privileged desc, role_row.name)
            from (
              select
                role.is_privileged,
                lower(role.name) as name,
                jsonb_build_object(
                  'id', role.id,
                  'key', role.key,
                  'name', role.name,
                  'description', role.description,
                  'is_privileged', role.is_privileged
                ) as payload
              from public.roles as role
              where role.organization_id = ${membership.organizationId}::uuid
                and role.status = 'active'
            ) as role_row
          ), '[]'::jsonb) as roles,
          coalesce((
            select jsonb_agg(member_row.payload order by member_row.status_rank, member_row.email_sort)
            from (
              select
                case membership_record.status
                  when 'active' then 1
                  when 'invited' then 2
                  when 'suspended' then 3
                  else 4
                end as status_rank,
                lower(coalesce(auth_user.email, '')) as email_sort,
                jsonb_build_object(
                  'membership_id', membership_record.id,
                  'user_id', membership_record.user_id,
                  'email', coalesce(auth_user.email, ''),
                  'display_name', coalesce(
                    profile.display_name,
                    nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                    split_part(coalesce(auth_user.email, ''), '@', 1),
                    'AgencyOS user'
                  ),
                  'status', membership_record.status,
                  'role_ids', coalesce(
                    array_agg(distinct role.id::text order by role.id::text)
                      filter (where role.id is not null),
                    '{}'::text[]
                  ),
                  'role_names', coalesce(
                    array_agg(distinct role.name order by role.name)
                      filter (where role.id is not null),
                    '{}'::text[]
                  ),
                  'created_at', membership_record.created_at::text,
                  'activated_at', membership_record.activated_at::text
                ) as payload
              from public.memberships as membership_record
              join public.identity_accounts as auth_user
                on auth_user.id = membership_record.user_id
              left join public.profiles as profile
                on profile.id = membership_record.user_id
              left join public.membership_roles as assignment
                on assignment.membership_id = membership_record.id
              left join public.roles as role
                on role.id = assignment.role_id
               and role.organization_id = membership_record.organization_id
              where membership_record.organization_id = ${membership.organizationId}::uuid
              group by
                membership_record.id,
                auth_user.email,
                auth_user.raw_user_meta_data,
                profile.display_name
            ) as member_row
          ), '[]'::jsonb) as members
      `,
      { attempts: 2, operationName: "User access workspace lookup" },
    );

    const payload = rows[0];
    const organization = payload?.organization;

    if (!organization) {
      return { allowed: false, reason: "access-check-failed" };
    }

    return {
      allowed: true,
      data: {
        actorUserId: user.id,
        organization: {
          id: organization.id,
          legalName: organization.legal_name,
          slug: organization.slug,
        },
        roles: (payload.roles ?? []).map((role) => ({
          id: role.id,
          key: role.key,
          name: role.name,
          description: role.description,
          isPrivileged: role.is_privileged,
        })),
        members: (payload.members ?? []).map((member) => ({
          membershipId: member.membership_id,
          userId: member.user_id,
          email: member.email,
          displayName: member.display_name,
          status: member.status,
          roleIds: member.role_ids ?? [],
          roleNames: member.role_names ?? [],
          createdAt: new Date(member.created_at).toISOString(),
          activatedAt: member.activated_at ? new Date(member.activated_at).toISOString() : null,
        })),
        capabilities: {
          canGrantAccess: hasEveryPermission(permissions, [
            accessManagementPermissionKeys.createUser,
            accessManagementPermissionKeys.manageRoleAccess,
          ]),
          canManageRoles: permissions.has(accessManagementPermissionKeys.manageRoleAccess),
          canManageStatus: hasEveryPermission(permissions, [
            accessManagementPermissionKeys.updateUser,
            accessManagementPermissionKeys.manageUserAccess,
          ]),
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
