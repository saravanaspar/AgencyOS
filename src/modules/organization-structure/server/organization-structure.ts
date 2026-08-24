import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const organizationStructurePermissionKeys = {
  departmentView: "settings.department.view",
  departmentCreate: "settings.department.create",
  departmentUpdate: "settings.department.update",
  departmentDelete: "settings.department.delete",
  teamView: "settings.team.view",
  teamCreate: "settings.team.create",
  teamUpdate: "settings.team.update",
  teamDelete: "settings.team.delete",
  teamAssign: "settings.team.assign",
  userView: "settings.user.view",
  userUpdate: "settings.user.update",
} as const;

export interface StructureDepartment {
  id: string;
  name: string;
  code: string | null;
  status: "active" | "inactive";
  activeMemberCount: number;
  updatedAt: string;
}

export interface StructureTeamMember {
  membershipId: string;
  displayName: string;
  email: string;
  isLead: boolean;
}

export interface StructureTeam {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  activeMemberCount: number;
  members: StructureTeamMember[];
  updatedAt: string;
}

export interface StructureMember {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  status: "active" | "invited" | "suspended" | "deactivated";
  departmentId: string | null;
  managerMembershipId: string | null;
  teamIds: string[];
  leadTeamIds: string[];
}

export interface OrganizationStructureData {
  organizationId: string;
  departments: StructureDepartment[];
  teams: StructureTeam[];
  members: StructureMember[];
  capabilities: {
    canViewDepartments: boolean;
    canCreateDepartments: boolean;
    canUpdateDepartments: boolean;
    canDeactivateDepartments: boolean;
    canViewTeams: boolean;
    canCreateTeams: boolean;
    canUpdateTeams: boolean;
    canDeactivateTeams: boolean;
    canAssignTeams: boolean;
    canViewMembers: boolean;
    canManageMemberStructure: boolean;
  };
}

export type OrganizationStructureResult =
  | { allowed: true; data: OrganizationStructureData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface DepartmentRow {
  id: string;
  name: string;
  code: string | null;
  status: "active" | "inactive";
  active_member_count: number;
  updated_at: Date;
}

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  active_member_count: number;
  updated_at: Date;
}

interface TeamMemberRow {
  team_id: string;
  membership_id: string;
  display_name: string;
  email: string;
  is_lead: boolean;
}

interface MemberRow {
  membership_id: string;
  user_id: string;
  display_name: string;
  email: string;
  status: "active" | "invited" | "suspended" | "deactivated";
  department_id: string | null;
  manager_membership_id: string | null;
  team_ids: string[];
  lead_team_ids: string[];
}

export async function getOrganizationStructureData(): Promise<OrganizationStructureResult> {
  const permissionContext = await getCurrentPermissionContext();

  if (!permissionContext.allowed) return permissionContext;

  const { membership, permissions } = permissionContext.context;
  const canViewDepartments = permissions.has(organizationStructurePermissionKeys.departmentView);
  const canViewTeams = permissions.has(organizationStructurePermissionKeys.teamView);

  if (!canViewDepartments && !canViewTeams) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const canViewMembers = permissions.has(organizationStructurePermissionKeys.userView);
  const database = getDatabaseClient();
  const organizationId = membership.organizationId;

  try {
    const [departmentRows, teamRows, teamMemberRows, memberRows] = await Promise.all([
      canViewDepartments
        ? database<DepartmentRow[]>`
            select
              department.id,
              department.name,
              department.code,
              department.status,
              count(member.id) filter (where member.status = 'active')::integer as active_member_count,
              department.updated_at
            from public.departments as department
            left join public.memberships as member
              on member.department_id = department.id
             and member.organization_id = department.organization_id
            where department.organization_id = ${organizationId}::uuid
            group by department.id
            order by
              case department.status when 'active' then 1 else 2 end,
              lower(department.name)
          `
        : Promise.resolve([] as DepartmentRow[]),
      canViewTeams
        ? database<TeamRow[]>`
            select
              team.id,
              team.name,
              team.description,
              team.status,
              count(team_member.membership_id)
                filter (where member.status = 'active')::integer as active_member_count,
              team.updated_at
            from public.teams as team
            left join public.team_members as team_member on team_member.team_id = team.id
            left join public.memberships as member
              on member.id = team_member.membership_id
             and member.organization_id = team.organization_id
            where team.organization_id = ${organizationId}::uuid
            group by team.id
            order by case team.status when 'active' then 1 else 2 end, lower(team.name)
          `
        : Promise.resolve([] as TeamRow[]),
      canViewTeams && canViewMembers
        ? database<TeamMemberRow[]>`
            select
              team_member.team_id,
              membership.id as membership_id,
              coalesce(
                profile.display_name,
                nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(auth_user.email, ''), '@', 1),
                'AgencyOS user'
              ) as display_name,
              coalesce(auth_user.email, '') as email,
              team_member.is_lead
            from public.team_members as team_member
            join public.teams as team
              on team.id = team_member.team_id
             and team.organization_id = ${organizationId}::uuid
            join public.memberships as membership
              on membership.id = team_member.membership_id
             and membership.organization_id = team.organization_id
            join public.identity_accounts as auth_user on auth_user.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            order by team_member.is_lead desc, lower(coalesce(profile.display_name, auth_user.email, ''))
          `
        : Promise.resolve([] as TeamMemberRow[]),
      canViewMembers
        ? database<MemberRow[]>`
            select
              membership.id as membership_id,
              membership.user_id,
              coalesce(
                profile.display_name,
                nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
                split_part(coalesce(auth_user.email, ''), '@', 1),
                'AgencyOS user'
              ) as display_name,
              coalesce(auth_user.email, '') as email,
              membership.status,
              membership.department_id,
              membership.manager_membership_id,
              coalesce(
                array_agg(distinct team_member.team_id::text)
                  filter (where team_member.team_id is not null),
                '{}'::text[]
              ) as team_ids,
              coalesce(
                array_agg(distinct team_member.team_id::text)
                  filter (where team_member.team_id is not null and team_member.is_lead),
                '{}'::text[]
              ) as lead_team_ids
            from public.memberships as membership
            join public.identity_accounts as auth_user on auth_user.id = membership.user_id
            left join public.profiles as profile on profile.id = membership.user_id
            left join public.team_members as team_member on team_member.membership_id = membership.id
            where membership.organization_id = ${organizationId}::uuid
            group by membership.id, auth_user.email, auth_user.raw_user_meta_data, profile.display_name
            order by
              case membership.status when 'active' then 1 when 'invited' then 2 else 3 end,
              lower(coalesce(profile.display_name, auth_user.email, ''))
          `
        : Promise.resolve([] as MemberRow[]),
    ]);

    const teamMembers = new Map<string, StructureTeamMember[]>();
    for (const row of teamMemberRows) {
      const current = teamMembers.get(row.team_id) ?? [];
      current.push({
        membershipId: row.membership_id,
        displayName: row.display_name,
        email: row.email,
        isLead: row.is_lead,
      });
      teamMembers.set(row.team_id, current);
    }

    return {
      allowed: true,
      data: {
        organizationId,
        departments: departmentRows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          status: row.status,
          activeMemberCount: row.active_member_count,
          updatedAt: row.updated_at.toISOString(),
        })),
        teams: teamRows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          status: row.status,
          activeMemberCount: row.active_member_count,
          members: teamMembers.get(row.id) ?? [],
          updatedAt: row.updated_at.toISOString(),
        })),
        members: memberRows.map((row) => ({
          membershipId: row.membership_id,
          userId: row.user_id,
          displayName: row.display_name,
          email: row.email,
          status: row.status,
          departmentId: row.department_id,
          managerMembershipId: row.manager_membership_id,
          teamIds: row.team_ids,
          leadTeamIds: row.lead_team_ids,
        })),
        capabilities: {
          canViewDepartments,
          canCreateDepartments: permissions.has(
            organizationStructurePermissionKeys.departmentCreate,
          ),
          canUpdateDepartments: permissions.has(
            organizationStructurePermissionKeys.departmentUpdate,
          ),
          canDeactivateDepartments: permissions.has(
            organizationStructurePermissionKeys.departmentDelete,
          ),
          canViewTeams,
          canCreateTeams: permissions.has(organizationStructurePermissionKeys.teamCreate),
          canUpdateTeams: permissions.has(organizationStructurePermissionKeys.teamUpdate),
          canDeactivateTeams: permissions.has(organizationStructurePermissionKeys.teamDelete),
          canAssignTeams: permissions.has(organizationStructurePermissionKeys.teamAssign),
          canViewMembers,
          canManageMemberStructure:
            canViewMembers &&
            permissions.has(organizationStructurePermissionKeys.departmentUpdate) &&
            permissions.has(organizationStructurePermissionKeys.userUpdate),
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
