"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { normalizeStructureName } from "@/modules/organization-structure/organization-structure";
import {
  departmentCreateSchema,
  departmentDeleteSchema,
  departmentStatusSchema,
  departmentUpdateSchema,
  memberStructureSchema,
  type OrganizationStructureActionState,
  teamCreateSchema,
  teamDeleteSchema,
  teamMemberAssignmentSchema,
  teamMemberRemovalSchema,
  teamStatusSchema,
  teamUpdateSchema,
} from "@/modules/organization-structure/schemas/organization-structure";
import { getMemberStructureAssignmentError } from "@/modules/organization-structure/server/member-structure-validation";
import { organizationStructurePermissionKeys } from "@/modules/organization-structure/server/organization-structure";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

class StructureActionError extends Error {}

interface EntityRow {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  status: "active" | "inactive";
}

interface MembershipRow {
  id: string;
  department_id: string | null;
  manager_membership_id: string | null;
  status: string;
}

function errorState(message: string, fieldErrors?: Record<string, string[]>) {
  return { status: "error", message, fieldErrors } satisfies OrganizationStructureActionState;
}

function successState(message: string) {
  return { status: "success", message } satisfies OrganizationStructureActionState;
}

function formValues(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function refreshStructure() {
  revalidatePath("/settings/structure");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

async function authorizeAction(requiredPermissions: readonly string[]) {
  const authorization = await authorizeCurrentUser(requiredPermissions);
  if (!authorization.allowed) {
    throw new StructureActionError(
      authorization.reason === "insufficient-permission"
        ? "You do not have permission to perform this action."
        : "Your session or organization access is no longer active.",
    );
  }
  return authorization.context;
}

export async function createDepartmentAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = departmentCreateSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return errorState(
      "Check the department fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.departmentCreate]);
    const database = getDatabaseClient();
    const name = normalizeStructureName(parsed.data.name);

    await database.begin(async (sql) => {
      const rows = await sql<EntityRow[]>`
        insert into public.departments (organization_id, name, code, created_by)
        values (
          ${context.membership.organizationId}::uuid,
          ${name},
          ${parsed.data.code},
          ${context.user.id}::uuid
        )
        returning id, name, code, status
      `;
      const department = rows[0];
      if (!department) throw new StructureActionError("The department could not be created.");

      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid,
          ${context.user.id}::uuid,
          'department.created', 'department', ${department.id}, 'web',
          ${sql.json({ name: department.name, code: department.code, status: department.status })},
          ${["name", "code", "status"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshStructure();
    return successState("Department created.");
  } catch (error) {
    if (isUniqueViolation(error))
      return errorState("That department name or code is already in use.");
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The department could not be created.",
    );
  }
}

export async function updateDepartmentAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = departmentUpdateSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return errorState(
      "Check the department fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.departmentUpdate]);
    const database = getDatabaseClient();
    const name = normalizeStructureName(parsed.data.name);

    const changed = await database.begin(async (sql) => {
      const currentRows = await sql<EntityRow[]>`
        select id, name, code, status
        from public.departments
        where id = ${parsed.data.departmentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new StructureActionError("Department not found.");

      const changedFields = [
        current.name !== name ? "name" : null,
        current.code !== parsed.data.code ? "code" : null,
      ].filter((field): field is string => Boolean(field));
      if (changedFields.length === 0) return false;

      const updatedRows = await sql<EntityRow[]>`
        update public.departments
        set name = ${name}, code = ${parsed.data.code}
        where id = ${current.id}::uuid
        returning id, name, code, status
      `;
      const updated = updatedRows[0];
      if (!updated) throw new StructureActionError("The department could not be updated.");

      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'department.updated', 'department', ${current.id}, 'web',
          ${sql.json({ name: current.name, code: current.code, status: current.status })},
          ${sql.json({ name: updated.name, code: updated.code, status: updated.status })},
          ${changedFields}::text[], ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
      return true;
    });

    refreshStructure();
    return successState(changed ? "Department updated." : "No department changes were needed.");
  } catch (error) {
    if (isUniqueViolation(error))
      return errorState("That department name or code is already in use.");
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The department could not be updated.",
    );
  }
}

export async function changeDepartmentStatusAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = departmentStatusSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Invalid department status request.");

  try {
    const permission =
      parsed.data.status === "inactive"
        ? organizationStructurePermissionKeys.departmentDelete
        : organizationStructurePermissionKeys.departmentUpdate;
    const context = await authorizeAction([permission]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const currentRows = await sql<EntityRow[]>`
        select id, name, code, status
        from public.departments
        where id = ${parsed.data.departmentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new StructureActionError("Department not found.");
      if (current.status === parsed.data.status) return;

      if (parsed.data.status === "inactive") {
        const counts = await sql<{ count: number }[]>`
          select count(*)::integer as count
          from public.memberships
          where organization_id = ${context.membership.organizationId}::uuid
            and department_id = ${current.id}::uuid
            and status = 'active'
        `;
        if ((counts[0]?.count ?? 0) > 0) {
          throw new StructureActionError(
            "Reassign active members before deactivating this department.",
          );
        }
      }

      await sql`
        update public.departments set status = ${parsed.data.status}
        where id = ${current.id}::uuid
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'department.status_changed', 'department', ${current.id}, 'web',
          ${sql.json({ status: current.status })}, ${sql.json({ status: parsed.data.status })},
          ${["status"]}::text[], ${sql.json({ name: current.name, actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshStructure();
    return successState(
      `Department ${parsed.data.status === "active" ? "activated" : "deactivated"}.`,
    );
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The department status could not be changed.",
    );
  }
}

export async function deleteDepartmentAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = departmentDeleteSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Invalid department delete request.");

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.departmentDelete]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const currentRows = await sql<EntityRow[]>`
        select id, name, code, status
        from public.departments
        where id = ${parsed.data.departmentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new StructureActionError("Department not found.");
      if (current.status !== "inactive") {
        throw new StructureActionError("Deactivate the department before deleting it.");
      }

      const assignments = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.memberships
        where organization_id = ${context.membership.organizationId}::uuid
          and department_id = ${current.id}::uuid
      `;
      if ((assignments[0]?.count ?? 0) > 0) {
        throw new StructureActionError(
          "Remove every member assignment before deleting this department.",
        );
      }

      await sql`delete from public.departments where id = ${current.id}::uuid`;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'department.deleted', 'department', ${current.id}, 'web',
          ${sql.json({ name: current.name, code: current.code, status: current.status })},
          ${["deleted"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshStructure();
    return successState("Department permanently deleted.");
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The department could not be deleted.",
    );
  }
}

export async function createTeamAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamCreateSchema.safeParse(formValues(formData));
  if (!parsed.success)
    return errorState("Check the team fields and try again.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.teamCreate]);
    const database = getDatabaseClient();
    const name = normalizeStructureName(parsed.data.name);

    await database.begin(async (sql) => {
      const rows = await sql<EntityRow[]>`
        insert into public.teams (organization_id, name, description, created_by)
        values (${context.membership.organizationId}::uuid, ${name}, ${parsed.data.description}, ${context.user.id}::uuid)
        returning id, name, description, status
      `;
      const team = rows[0];
      if (!team) throw new StructureActionError("The team could not be created.");
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'team.created', 'team', ${team.id}, 'web',
          ${sql.json({ name: team.name, description: team.description, status: team.status })},
          ${["name", "description", "status"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });
    refreshStructure();
    return successState("Team created.");
  } catch (error) {
    if (isUniqueViolation(error)) return errorState("That team name is already in use.");
    return errorState(
      error instanceof StructureActionError ? error.message : "The team could not be created.",
    );
  }
}

export async function updateTeamAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamUpdateSchema.safeParse(formValues(formData));
  if (!parsed.success)
    return errorState("Check the team fields and try again.", parsed.error.flatten().fieldErrors);

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.teamUpdate]);
    const database = getDatabaseClient();
    const name = normalizeStructureName(parsed.data.name);
    const changed = await database.begin(async (sql) => {
      const rows = await sql<EntityRow[]>`
        select id, name, description, status from public.teams
        where id = ${parsed.data.teamId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = rows[0];
      if (!current) throw new StructureActionError("Team not found.");
      const changedFields = [
        current.name !== name ? "name" : null,
        current.description !== parsed.data.description ? "description" : null,
      ].filter((field): field is string => Boolean(field));
      if (changedFields.length === 0) return false;

      const updatedRows = await sql<EntityRow[]>`
        update public.teams set name = ${name}, description = ${parsed.data.description}
        where id = ${current.id}::uuid
        returning id, name, description, status
      `;
      const updated = updatedRows[0];
      if (!updated) throw new StructureActionError("The team could not be updated.");
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'team.updated', 'team', ${current.id}, 'web',
          ${sql.json({ name: current.name, description: current.description, status: current.status })},
          ${sql.json({ name: updated.name, description: updated.description, status: updated.status })},
          ${changedFields}::text[], ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
      return true;
    });
    refreshStructure();
    return successState(changed ? "Team updated." : "No team changes were needed.");
  } catch (error) {
    if (isUniqueViolation(error)) return errorState("That team name is already in use.");
    return errorState(
      error instanceof StructureActionError ? error.message : "The team could not be updated.",
    );
  }
}

export async function changeTeamStatusAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamStatusSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Invalid team status request.");

  try {
    const permission =
      parsed.data.status === "inactive"
        ? organizationStructurePermissionKeys.teamDelete
        : organizationStructurePermissionKeys.teamUpdate;
    const context = await authorizeAction([permission]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const rows = await sql<EntityRow[]>`
        select id, name, description, status from public.teams
        where id = ${parsed.data.teamId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = rows[0];
      if (!current) throw new StructureActionError("Team not found.");
      if (current.status === parsed.data.status) return;
      if (parsed.data.status === "inactive") {
        const counts = await sql<{ count: number }[]>`
          select count(*)::integer as count
          from public.team_members as assignment
          join public.memberships as membership on membership.id = assignment.membership_id
          where assignment.team_id = ${current.id}::uuid and membership.status = 'active'
        `;
        if ((counts[0]?.count ?? 0) > 0) {
          throw new StructureActionError("Remove active members before deactivating this team.");
        }
      }
      await sql`update public.teams set status = ${parsed.data.status} where id = ${current.id}::uuid`;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'team.status_changed', 'team', ${current.id}, 'web',
          ${sql.json({ status: current.status })}, ${sql.json({ status: parsed.data.status })},
          ${["status"]}::text[], ${sql.json({ name: current.name, actorMembershipId: context.membership.id })}
        )
      `;
    });
    refreshStructure();
    return successState(`Team ${parsed.data.status === "active" ? "activated" : "deactivated"}.`);
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The team status could not be changed.",
    );
  }
}

export async function deleteTeamAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamDeleteSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Invalid team delete request.");

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.teamDelete]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const currentRows = await sql<EntityRow[]>`
        select id, name, description, status
        from public.teams
        where id = ${parsed.data.teamId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new StructureActionError("Team not found.");
      if (current.status !== "inactive") {
        throw new StructureActionError("Deactivate the team before deleting it.");
      }

      const assignments = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.team_members
        where team_id = ${current.id}::uuid
      `;
      if ((assignments[0]?.count ?? 0) > 0) {
        throw new StructureActionError("Remove every team member before deleting this team.");
      }

      await sql`delete from public.teams where id = ${current.id}::uuid`;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'team.deleted', 'team', ${current.id}, 'web',
          ${sql.json({ name: current.name, description: current.description, status: current.status })},
          ${["deleted"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshStructure();
    return successState("Team permanently deleted.");
  } catch (error) {
    return errorState(
      error instanceof StructureActionError ? error.message : "The team could not be deleted.",
    );
  }
}

export async function updateMemberStructureAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = memberStructureSchema.safeParse(formValues(formData));
  if (!parsed.success)
    return errorState(
      "Check the member assignment and try again.",
      parsed.error.flatten().fieldErrors,
    );

  try {
    const context = await authorizeAction([
      organizationStructurePermissionKeys.departmentUpdate,
      organizationStructurePermissionKeys.userUpdate,
      organizationStructurePermissionKeys.userView,
    ]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const memberRows = await sql<MembershipRow[]>`
        select id, department_id, manager_membership_id, status
        from public.memberships
        where id = ${parsed.data.membershipId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const member = memberRows[0];
      if (!member) throw new StructureActionError("Member not found.");

      const assignmentError = await getMemberStructureAssignmentError(sql, {
        organizationId: context.membership.organizationId,
        membershipId: parsed.data.membershipId,
        departmentId: parsed.data.departmentId,
        managerMembershipId: parsed.data.managerMembershipId,
      });
      if (assignmentError) throw new StructureActionError(assignmentError);

      if (
        member.department_id === parsed.data.departmentId &&
        member.manager_membership_id === parsed.data.managerMembershipId
      )
        return;

      await sql`
        update public.memberships
        set department_id = ${parsed.data.departmentId},
            manager_membership_id = ${parsed.data.managerMembershipId}
        where id = ${member.id}::uuid
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'membership.structure_changed', 'membership', ${member.id}, 'web',
          ${sql.json({ departmentId: member.department_id, managerMembershipId: member.manager_membership_id })},
          ${sql.json({ departmentId: parsed.data.departmentId, managerMembershipId: parsed.data.managerMembershipId })},
          ${["departmentId", "managerMembershipId"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });
    refreshStructure();
    return successState("Member structure updated.");
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The member structure could not be updated.",
    );
  }
}

export async function assignTeamMemberAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamMemberAssignmentSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Choose a valid team member.");

  try {
    const context = await authorizeAction([
      organizationStructurePermissionKeys.teamAssign,
      organizationStructurePermissionKeys.userView,
    ]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const teams = await sql<{ id: string; name: string }[]>`
        select id, name from public.teams
        where id = ${parsed.data.teamId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
      `;
      const members = await sql<{ id: string }[]>`
        select id from public.memberships
        where id = ${parsed.data.membershipId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
      `;
      if (!teams[0] || !members[0])
        throw new StructureActionError("Choose an active team and member from this organization.");

      const existing = await sql<{ is_lead: boolean }[]>`
        select is_lead from public.team_members
        where team_id = ${parsed.data.teamId}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
      `;
      await sql`
        insert into public.team_members (team_id, membership_id, is_lead, added_by)
        values (${parsed.data.teamId}::uuid, ${parsed.data.membershipId}::uuid, ${parsed.data.isLead}, ${context.user.id}::uuid)
        on conflict (team_id, membership_id) do update
        set is_lead = excluded.is_lead, added_by = excluded.added_by
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          ${existing[0] ? "team.member_updated" : "team.member_added"},
          'team_member', ${`${parsed.data.teamId}:${parsed.data.membershipId}`}, 'web',
          ${existing[0] ? sql.json({ isLead: existing[0].is_lead }) : null},
          ${sql.json({ isLead: parsed.data.isLead })}, ${["isLead"]}::text[],
          ${sql.json({ teamId: parsed.data.teamId, membershipId: parsed.data.membershipId, actorMembershipId: context.membership.id })}
        )
      `;
    });
    refreshStructure();
    return successState(
      parsed.data.isLead ? "Team lead assignment saved." : "Team member assignment saved.",
    );
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The team assignment could not be saved.",
    );
  }
}

export async function removeTeamMemberAction(
  _previous: OrganizationStructureActionState,
  formData: FormData,
): Promise<OrganizationStructureActionState> {
  const parsed = teamMemberRemovalSchema.safeParse(formValues(formData));
  if (!parsed.success) return errorState("Invalid team member request.");

  try {
    const context = await authorizeAction([organizationStructurePermissionKeys.teamAssign]);
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const existing = await sql<{ is_lead: boolean }[]>`
        select assignment.is_lead
        from public.team_members as assignment
        join public.teams as team on team.id = assignment.team_id
        join public.memberships as membership on membership.id = assignment.membership_id
        where assignment.team_id = ${parsed.data.teamId}::uuid
          and assignment.membership_id = ${parsed.data.membershipId}::uuid
          and team.organization_id = ${context.membership.organizationId}::uuid
          and membership.organization_id = team.organization_id
        for update
      `;
      if (!existing[0]) throw new StructureActionError("Team member assignment not found.");
      await sql`
        delete from public.team_members
        where team_id = ${parsed.data.teamId}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'team.member_removed', 'team_member', ${`${parsed.data.teamId}:${parsed.data.membershipId}`}, 'web',
          ${sql.json({ isLead: existing[0].is_lead })}, ${["membership"]}::text[],
          ${sql.json({ teamId: parsed.data.teamId, membershipId: parsed.data.membershipId, actorMembershipId: context.membership.id })}
        )
      `;
    });
    refreshStructure();
    return successState("Team member removed.");
  } catch (error) {
    return errorState(
      error instanceof StructureActionError
        ? error.message
        : "The team member could not be removed.",
    );
  }
}
