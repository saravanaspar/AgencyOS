import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { withInfrastructureRetry } from "@/lib/server/retry";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const roleEditorPermissionKeys = {
  view: "settings.role.view",
  create: "settings.role.create",
  update: "settings.role.update",
  delete: "settings.role.delete",
  manageRoleAccess: "settings.role.manage_access",
  viewPermissions: "settings.permission.view",
  manageOverrides: "settings.permission.manage_access",
  viewUsers: "settings.user.view",
} as const;

export interface RolePermissionGrant {
  permissionId: string;
  scope: PermissionScope;
}

export interface EditableRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isPrivileged: boolean;
  status: "active" | "inactive";
  assignmentCount: number;
  permissionCount: number;
  grants: RolePermissionGrant[];
}

export interface RoleEditorPermission {
  id: string;
  key: string;
  module: string;
  description: string;
  isSensitive: boolean;
}

export interface RoleEditorMember {
  membershipId: string;
  displayName: string;
  email: string;
  status: "active" | "deactivated" | "invited" | "suspended";
}

export interface MemberPermissionOverride {
  membershipId: string;
  memberName: string;
  memberEmail: string;
  permissionId: string;
  permissionKey: string;
  effect: "allow" | "deny";
  scope: PermissionScope | null;
  reason: string;
  expiresAt: string | null;
}

export interface RoleEditorData {
  organization: { id: string; legalName: string };
  roles: EditableRole[];
  permissions: RoleEditorPermission[];
  members: RoleEditorMember[];
  overrides: MemberPermissionOverride[];
  capabilities: {
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canManageRoleAccess: boolean;
    canManageOverrides: boolean;
  };
}

export type RoleEditorResult =
  { allowed: true; data: RoleEditorData } | { allowed: false; reason: AuthorizationFailureReason };

interface OrganizationRow {
  id: string;
  legal_name: string;
}

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_privileged: boolean;
  status: "active" | "inactive";
  assignment_count: number;
  permission_count: number;
}

interface GrantRow {
  role_id: string;
  permission_id: string;
  scope: PermissionScope;
}

interface PermissionRow {
  id: string;
  key: string;
  module: string;
  description: string;
  is_sensitive: boolean;
}

interface MemberRow {
  membership_id: string;
  display_name: string;
  email: string;
  status: RoleEditorMember["status"];
}

interface OverrideRow {
  membership_id: string;
  member_name: string;
  member_email: string;
  permission_id: string;
  permission_key: string;
  effect: "allow" | "deny";
  scope: PermissionScope | null;
  reason: string;
  expires_at: string | null;
}

interface RoleEditorPayloadRow {
  organization: OrganizationRow | null;
  roles: RoleRow[];
  grants: GrantRow[];
  permissions: PermissionRow[];
  members: MemberRow[];
  overrides: OverrideRow[];
}

export async function getRoleEditorData(): Promise<RoleEditorResult> {
  const permissionContext = await getCurrentPermissionContext();
  if (!permissionContext.allowed) return permissionContext;

  const { membership, permissions } = permissionContext.context;
  if (!permissions.has(roleEditorPermissionKeys.view)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const organizationId = membership.organizationId;
  const canViewPermissions = permissions.has(roleEditorPermissionKeys.viewPermissions);
  const canViewUsers = permissions.has(roleEditorPermissionKeys.viewUsers);

  try {
    const database = getDatabaseClient();
    const rows = await withInfrastructureRetry(
      () => database<RoleEditorPayloadRow[]>`
        select
          (
            select jsonb_build_object(
              'id', organization.id,
              'legal_name', organization.legal_name
            )
            from public.organizations as organization
            where organization.id = ${organizationId}::uuid
              and organization.status = 'active'
            limit 1
          ) as organization,
          coalesce((
            select jsonb_agg(role_row.payload order by role_row.is_system desc, role_row.is_privileged desc, role_row.name)
            from (
              select
                role.is_system,
                role.is_privileged,
                lower(role.name) as name,
                jsonb_build_object(
                  'id', role.id,
                  'key', role.key,
                  'name', role.name,
                  'description', role.description,
                  'is_system', role.is_system,
                  'is_privileged', role.is_privileged,
                  'status', role.status,
                  'assignment_count', count(distinct assignment.membership_id)::integer,
                  'permission_count', count(distinct role_permission.permission_id)::integer
                ) as payload
              from public.roles as role
              left join public.membership_roles as assignment
                on assignment.role_id = role.id
              left join public.role_permissions as role_permission
                on role_permission.role_id = role.id
              where role.organization_id = ${organizationId}::uuid
              group by role.id
            ) as role_row
          ), '[]'::jsonb) as roles,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'role_id', role_permission.role_id,
                'permission_id', role_permission.permission_id,
                'scope', role_permission.scope
              )
              order by role_permission.role_id, role_permission.permission_id
            )
            from public.role_permissions as role_permission
            join public.roles as role
              on role.id = role_permission.role_id
            where ${canViewPermissions}::boolean
              and role.organization_id = ${organizationId}::uuid
          ), '[]'::jsonb) as grants,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', permission.id,
                'key', permission.key,
                'module', permission.module,
                'description', permission.description,
                'is_sensitive', permission.is_sensitive
              )
              order by permission.module, permission.key
            )
            from public.permissions as permission
            where ${canViewPermissions}::boolean
          ), '[]'::jsonb) as permissions,
          coalesce((
            select jsonb_agg(member_row.payload order by member_row.name_sort)
            from (
              select
                lower(coalesce(profile.display_name, auth_user.email, '')) as name_sort,
                jsonb_build_object(
                  'membership_id', membership_record.id,
                  'display_name', coalesce(
                    profile.display_name,
                    nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                    auth_user.email,
                    'AgencyOS user'
                  ),
                  'email', coalesce(auth_user.email, ''),
                  'status', membership_record.status
                ) as payload
              from public.memberships as membership_record
              join public.identity_accounts as auth_user
                on auth_user.id = membership_record.user_id
              left join public.profiles as profile
                on profile.id = membership_record.user_id
              where ${canViewUsers}::boolean
                and membership_record.organization_id = ${organizationId}::uuid
            ) as member_row
          ), '[]'::jsonb) as members,
          coalesce((
            select jsonb_agg(override_row.payload order by override_row.member_sort, override_row.permission_key)
            from (
              select
                lower(coalesce(profile.display_name, auth_user.email, '')) as member_sort,
                permission.key as permission_key,
                jsonb_build_object(
                  'membership_id', override_grant.membership_id,
                  'member_name', coalesce(
                    profile.display_name,
                    nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                    auth_user.email,
                    'AgencyOS user'
                  ),
                  'member_email', coalesce(auth_user.email, ''),
                  'permission_id', override_grant.permission_id,
                  'permission_key', permission.key,
                  'effect', override_grant.effect,
                  'scope', override_grant.scope,
                  'reason', override_grant.reason,
                  'expires_at', override_grant.expires_at::text
                ) as payload
              from public.membership_permission_overrides as override_grant
              join public.memberships as membership_record
                on membership_record.id = override_grant.membership_id
               and membership_record.organization_id = ${organizationId}::uuid
              join public.identity_accounts as auth_user
                on auth_user.id = membership_record.user_id
              left join public.profiles as profile
                on profile.id = membership_record.user_id
              join public.permissions as permission
                on permission.id = override_grant.permission_id
              where ${canViewPermissions && canViewUsers}::boolean
                and (override_grant.expires_at is null or override_grant.expires_at > now())
            ) as override_row
          ), '[]'::jsonb) as overrides
      `,
      { attempts: 2, operationName: "Role editor workspace lookup" },
    );

    const payload = rows[0];
    const organization = payload?.organization;
    if (!organization) return { allowed: false, reason: "access-check-failed" };

    const grantsByRole = new Map<string, RolePermissionGrant[]>();
    for (const grant of payload.grants ?? []) {
      const current = grantsByRole.get(grant.role_id) ?? [];
      current.push({ permissionId: grant.permission_id, scope: grant.scope });
      grantsByRole.set(grant.role_id, current);
    }

    return {
      allowed: true,
      data: {
        organization: { id: organization.id, legalName: organization.legal_name },
        roles: (payload.roles ?? []).map((role) => ({
          id: role.id,
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: role.is_system,
          isPrivileged: role.is_privileged,
          status: role.status,
          assignmentCount: role.assignment_count,
          permissionCount: role.permission_count,
          grants: grantsByRole.get(role.id) ?? [],
        })),
        permissions: (payload.permissions ?? []).map((permission) => ({
          id: permission.id,
          key: permission.key,
          module: permission.module,
          description: permission.description,
          isSensitive: permission.is_sensitive,
        })),
        members: (payload.members ?? []).map((member) => ({
          membershipId: member.membership_id,
          displayName: member.display_name,
          email: member.email,
          status: member.status,
        })),
        overrides: (payload.overrides ?? []).map((override) => ({
          membershipId: override.membership_id,
          memberName: override.member_name,
          memberEmail: override.member_email,
          permissionId: override.permission_id,
          permissionKey: override.permission_key,
          effect: override.effect,
          scope: override.scope,
          reason: override.reason,
          expiresAt: override.expires_at ? new Date(override.expires_at).toISOString() : null,
        })),
        capabilities: {
          canCreate: permissions.has(roleEditorPermissionKeys.create),
          canUpdate: permissions.has(roleEditorPermissionKeys.update),
          canDelete: permissions.has(roleEditorPermissionKeys.delete),
          canManageRoleAccess: permissions.has(roleEditorPermissionKeys.manageRoleAccess),
          canManageOverrides:
            permissions.has(roleEditorPermissionKeys.manageOverrides) && canViewUsers,
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
