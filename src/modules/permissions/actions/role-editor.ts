"use server";

import { revalidatePath } from "next/cache";
import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { normalizeRoleKey, normalizeRoleName } from "@/modules/permissions/role-editor-utils";
import {
  memberOverrideDeleteSchema,
  memberOverrideSchema,
  roleCreateSchema,
  roleDeleteSchema,
  type RoleEditorActionState,
  rolePermissionUpdateSchema,
  roleStatusSchema,
  roleUpdateSchema,
} from "@/modules/permissions/schemas/role-editor";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { roleEditorPermissionKeys } from "@/modules/permissions/server/role-editor";
import { requireRecentReauthentication } from "@/modules/security/server/security";

class RoleEditorActionError extends Error {}

const criticalAdministratorPermissions = [
  "settings.user.manage_access",
  "settings.role.manage_access",
  "settings.permission.manage_access",
] as const;

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_privileged: boolean;
  status: "active" | "inactive";
}

interface RoleGrantRow {
  permission_id: string;
  permission_key: string;
  scope: string;
}

interface OverrideRow {
  effect: "allow" | "deny";
  scope: string | null;
  reason: string;
  expires_at: Date | null;
}

function errorState(message: string, fieldErrors?: Record<string, string[]>) {
  return { status: "error", message, fieldErrors } satisfies RoleEditorActionState;
}

function successState(message: string) {
  return { status: "success", message } satisfies RoleEditorActionState;
}

function values(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function refreshRoleEditor() {
  revalidatePath("/settings/roles");
  revalidatePath("/settings/permissions");
  revalidatePath("/settings/users");
}

function grantSnapshot(rows: readonly RoleGrantRow[]) {
  return rows.map((row) => ({
    permissionId: row.permission_id,
    permissionKey: row.permission_key,
    scope: row.scope,
  }));
}

function overrideSnapshot(row: OverrideRow) {
  return {
    effect: row.effect,
    scope: row.scope,
    reason: row.reason,
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

async function authorize(requiredPermissions: readonly string[]) {
  const result = await authorizeCurrentUser(requiredPermissions);
  if (!result.allowed) {
    throw new RoleEditorActionError(
      result.reason === "insufficient-permission"
        ? "You do not have permission to perform this action."
        : "Your session or organization access is no longer active.",
    );
  }
  await requireRecentReauthentication(result.context);
  return result.context;
}

type QuerySql = Sql | TransactionSql;

async function getCustomRoleForUpdate(sql: QuerySql, roleId: string, organizationId: string) {
  const rows = await sql<RoleRow[]>`
    select id, key, name, description, is_system, is_privileged, status
    from public.roles
    where id = ${roleId}::uuid
      and organization_id = ${organizationId}::uuid
    for update
  `;
  const role = rows[0];
  if (!role) throw new RoleEditorActionError("Role not found.");
  if (role.is_system) throw new RoleEditorActionError("System roles are protected and read-only.");
  return role;
}

async function ensureAdministratorCoverage(sql: QuerySql, organizationId: string) {
  const rows = await sql<{ key: string; holder_count: number }[]>`
    select
      permission.key,
      count(*) filter (
        where (
          exists (
            select 1
            from public.membership_roles as assignment
            join public.roles as role
              on role.id = assignment.role_id
             and role.organization_id = membership.organization_id
             and role.status = 'active'
            join public.role_permissions as role_permission
              on role_permission.role_id = role.id
             and role_permission.permission_id = permission.id
            where assignment.membership_id = membership.id
          )
          or exists (
            select 1
            from public.membership_permission_overrides as override_grant
            where override_grant.membership_id = membership.id
              and override_grant.permission_id = permission.id
              and override_grant.effect = 'allow'
              and (override_grant.expires_at is null or override_grant.expires_at > now())
          )
        )
        and not exists (
          select 1
          from public.membership_permission_overrides as override_grant
          where override_grant.membership_id = membership.id
            and override_grant.permission_id = permission.id
            and override_grant.effect = 'deny'
            and (override_grant.expires_at is null or override_grant.expires_at > now())
        )
      )::integer as holder_count
    from public.permissions as permission
    cross join public.memberships as membership
    where permission.key = any(${[...criticalAdministratorPermissions]}::text[])
      and membership.organization_id = ${organizationId}::uuid
      and membership.status = 'active'
    group by permission.key
  `;

  const counts = new Map(rows.map((row) => [row.key, row.holder_count]));
  const missing = criticalAdministratorPermissions.filter((key) => (counts.get(key) ?? 0) < 1);
  if (missing.length > 0) {
    throw new RoleEditorActionError(
      "This change would remove the organization’s last access administrator.",
    );
  }
}

export async function createRoleAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = roleCreateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the role fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([roleEditorPermissionKeys.create]);
    const database = getDatabaseClient();
    const name = normalizeRoleName(parsed.data.name);
    const key = normalizeRoleKey(name);

    await database.begin(async (sql) => {
      const rows = await sql<RoleRow[]>`
        insert into public.roles (
          organization_id, key, name, description, is_system, is_privileged, created_by
        ) values (
          ${context.membership.organizationId}::uuid,
          ${key},
          ${name},
          ${parsed.data.description},
          false,
          false,
          ${context.user.id}::uuid
        )
        returning id, key, name, description, is_system, is_privileged, status
      `;
      const role = rows[0];
      if (!role) throw new RoleEditorActionError("The role could not be created.");

      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'role.created', 'role', ${role.id}, 'web',
          ${sql.json({ key: role.key, name: role.name, description: role.description, status: role.status })},
          ${["key", "name", "description", "status"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Custom role created.");
  } catch (error) {
    if (isUniqueViolation(error)) return errorState("A role with that name already exists.");
    return errorState(
      error instanceof RoleEditorActionError ? error.message : "The role could not be created.",
    );
  }
}

export async function updateRoleAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = roleUpdateSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState("Check the role fields and try again.", parsed.error.flatten().fieldErrors);
  }

  try {
    const context = await authorize([roleEditorPermissionKeys.update]);
    const database = getDatabaseClient();
    const name = normalizeRoleName(parsed.data.name);

    await database.begin(async (sql) => {
      const role = await getCustomRoleForUpdate(
        sql,
        parsed.data.roleId,
        context.membership.organizationId,
      );
      if (role.name === name && role.description === parsed.data.description) return;

      const changedFields = [
        role.name !== name ? "name" : null,
        role.description !== parsed.data.description ? "description" : null,
      ].filter((field): field is string => Boolean(field));

      await sql`
        update public.roles
        set name = ${name}, description = ${parsed.data.description}
        where id = ${role.id}::uuid
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'role.updated', 'role', ${role.id}, 'web',
          ${sql.json({ name: role.name, description: role.description })},
          ${sql.json({ name, description: parsed.data.description })},
          ${changedFields}::text[], ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Role details updated.");
  } catch (error) {
    if (isUniqueViolation(error)) return errorState("A role with that name already exists.");
    return errorState(
      error instanceof RoleEditorActionError ? error.message : "The role could not be updated.",
    );
  }
}

export async function changeRoleStatusAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = roleStatusSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Invalid role status request.");

  try {
    const context = await authorize([roleEditorPermissionKeys.update]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const role = await getCustomRoleForUpdate(
        sql,
        parsed.data.roleId,
        context.membership.organizationId,
      );
      if (role.status === parsed.data.status) return;

      if (parsed.data.status === "inactive") {
        const assignments = await sql<{ count: number }[]>`
          select count(*)::integer as count
          from public.membership_roles as assignment
          join public.memberships as membership on membership.id = assignment.membership_id
          where assignment.role_id = ${role.id}::uuid
            and membership.status = 'active'
        `;
        if ((assignments[0]?.count ?? 0) > 0) {
          throw new RoleEditorActionError("Reassign active members before deactivating this role.");
        }
      }

      await sql`update public.roles set status = ${parsed.data.status} where id = ${role.id}::uuid`;
      await ensureAdministratorCoverage(sql, context.membership.organizationId);
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'role.status_changed', 'role', ${role.id}, 'web',
          ${sql.json({ status: role.status })}, ${sql.json({ status: parsed.data.status })},
          ${["status"]}::text[], ${sql.json({ name: role.name, actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState(`Role ${parsed.data.status === "active" ? "activated" : "deactivated"}.`);
  } catch (error) {
    return errorState(
      error instanceof RoleEditorActionError
        ? error.message
        : "The role status could not be changed.",
    );
  }
}

export async function deleteRoleAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = roleDeleteSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Invalid role delete request.");

  try {
    const context = await authorize([roleEditorPermissionKeys.delete]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const role = await getCustomRoleForUpdate(
        sql,
        parsed.data.roleId,
        context.membership.organizationId,
      );
      if (role.status !== "inactive") {
        throw new RoleEditorActionError("Deactivate the role before deleting it.");
      }

      const assignments = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.membership_roles
        where role_id = ${role.id}::uuid
      `;
      if ((assignments[0]?.count ?? 0) > 0) {
        throw new RoleEditorActionError(
          "Remove every member assignment before deleting this role.",
        );
      }

      const grants = await sql<RoleGrantRow[]>`
        select role_permission.permission_id, permission.key as permission_key, role_permission.scope
        from public.role_permissions as role_permission
        join public.permissions as permission on permission.id = role_permission.permission_id
        where role_permission.role_id = ${role.id}::uuid
      `;
      await sql`delete from public.roles where id = ${role.id}::uuid`;
      await ensureAdministratorCoverage(sql, context.membership.organizationId);
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'role.deleted', 'role', ${role.id}, 'web',
          ${sql.json({ name: role.name, key: role.key, grants: grantSnapshot(grants) })}, ${["deleted"]}::text[],
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Custom role permanently deleted.");
  } catch (error) {
    return errorState(
      error instanceof RoleEditorActionError ? error.message : "The role could not be deleted.",
    );
  }
}

export async function saveRolePermissionsAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = rolePermissionUpdateSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("The permission selection is invalid.");

  try {
    const context = await authorize([
      roleEditorPermissionKeys.manageRoleAccess,
      roleEditorPermissionKeys.viewPermissions,
    ]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const role = await getCustomRoleForUpdate(
        sql,
        parsed.data.roleId,
        context.membership.organizationId,
      );
      const uniqueGrants = new Map(
        parsed.data.grants.map((grant) => [grant.permissionId, grant] as const),
      );
      const permissionIds = [...uniqueGrants.keys()];

      if (permissionIds.length > 0) {
        const valid = await sql<{ id: string }[]>`
          select id from public.permissions where id = any(${permissionIds}::uuid[])
        `;
        if (valid.length !== permissionIds.length) {
          throw new RoleEditorActionError("One or more permissions no longer exist.");
        }
      }

      const before = await sql<RoleGrantRow[]>`
        select role_permission.permission_id, permission.key as permission_key, role_permission.scope
        from public.role_permissions as role_permission
        join public.permissions as permission on permission.id = role_permission.permission_id
        where role_permission.role_id = ${role.id}::uuid
        order by permission.key
      `;

      await sql`delete from public.role_permissions where role_id = ${role.id}::uuid`;
      const grantRows = [...uniqueGrants.values()].map((grant) => ({
        role_id: role.id,
        permission_id: grant.permissionId,
        scope: grant.scope,
        granted_by: context.user.id,
      }));
      if (grantRows.length > 0) {
        await sql`
          insert into public.role_permissions ${sql(
            grantRows,
            "role_id",
            "permission_id",
            "scope",
            "granted_by",
          )}
        `;
      }

      await ensureAdministratorCoverage(sql, context.membership.organizationId);
      const after = await sql<RoleGrantRow[]>`
        select role_permission.permission_id, permission.key as permission_key, role_permission.scope
        from public.role_permissions as role_permission
        join public.permissions as permission on permission.id = role_permission.permission_id
        where role_permission.role_id = ${role.id}::uuid
        order by permission.key
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'role.permissions_updated', 'role', ${role.id}, 'web',
          ${sql.json({ grants: grantSnapshot(before) })}, ${sql.json({ grants: grantSnapshot(after) })},
          ${["permissions"]}::text[],
          ${sql.json({ roleName: role.name, actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Role permissions saved.");
  } catch (error) {
    return errorState(
      error instanceof RoleEditorActionError
        ? error.message
        : "The role permissions could not be saved.",
    );
  }
}

export async function saveMemberOverrideAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = memberOverrideSchema.safeParse(values(formData));
  if (!parsed.success) {
    return errorState(
      "Check the override fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  try {
    const context = await authorize([
      roleEditorPermissionKeys.manageOverrides,
      roleEditorPermissionKeys.viewUsers,
      roleEditorPermissionKeys.viewPermissions,
    ]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const targets = await sql<{ membership_id: string; permission_id: string }[]>`
        select membership.id as membership_id, permission.id as permission_id
        from public.memberships as membership
        cross join public.permissions as permission
        where membership.id = ${parsed.data.membershipId}::uuid
          and membership.organization_id = ${context.membership.organizationId}::uuid
          and permission.id = ${parsed.data.permissionId}::uuid
      `;
      if (!targets[0]) throw new RoleEditorActionError("Choose a valid member and permission.");

      const beforeRows = await sql<OverrideRow[]>`
        select effect, scope, reason, expires_at
        from public.membership_permission_overrides
        where membership_id = ${parsed.data.membershipId}::uuid
          and permission_id = ${parsed.data.permissionId}::uuid
        for update
      `;
      const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

      await sql`
        insert into public.membership_permission_overrides (
          membership_id, permission_id, effect, scope, reason, expires_at, granted_by
        ) values (
          ${parsed.data.membershipId}::uuid,
          ${parsed.data.permissionId}::uuid,
          ${parsed.data.effect},
          ${parsed.data.scope},
          ${parsed.data.reason},
          ${expiresAt},
          ${context.user.id}::uuid
        )
        on conflict (membership_id, permission_id) do update
        set effect = excluded.effect,
            scope = excluded.scope,
            reason = excluded.reason,
            expires_at = excluded.expires_at,
            granted_by = excluded.granted_by
      `;

      await ensureAdministratorCoverage(sql, context.membership.organizationId);
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, after_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'membership.permission_override_saved', 'membership_permission_override',
          ${`${parsed.data.membershipId}:${parsed.data.permissionId}`}, 'web',
          ${beforeRows[0] ? sql.json(overrideSnapshot(beforeRows[0])) : null},
          ${sql.json({ effect: parsed.data.effect, scope: parsed.data.scope, reason: parsed.data.reason, expiresAt: expiresAt?.toISOString() ?? null })},
          ${["effect", "scope", "reason", "expiresAt"]}::text[],
          ${sql.json({ membershipId: parsed.data.membershipId, permissionId: parsed.data.permissionId, actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Member permission override saved.");
  } catch (error) {
    return errorState(
      error instanceof RoleEditorActionError
        ? error.message
        : "The permission override could not be saved.",
    );
  }
}

export async function deleteMemberOverrideAction(
  _previous: RoleEditorActionState,
  formData: FormData,
): Promise<RoleEditorActionState> {
  const parsed = memberOverrideDeleteSchema.safeParse(values(formData));
  if (!parsed.success) return errorState("Invalid permission override request.");

  try {
    const context = await authorize([roleEditorPermissionKeys.manageOverrides]);
    const database = getDatabaseClient();

    await database.begin(async (sql) => {
      const beforeRows = await sql<OverrideRow[]>`
        select override_grant.effect, override_grant.scope, override_grant.reason, override_grant.expires_at
        from public.membership_permission_overrides as override_grant
        join public.memberships as membership on membership.id = override_grant.membership_id
        where override_grant.membership_id = ${parsed.data.membershipId}::uuid
          and override_grant.permission_id = ${parsed.data.permissionId}::uuid
          and membership.organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      if (!beforeRows[0]) throw new RoleEditorActionError("Permission override not found.");

      await sql`
        delete from public.membership_permission_overrides
        where membership_id = ${parsed.data.membershipId}::uuid
          and permission_id = ${parsed.data.permissionId}::uuid
      `;
      await ensureAdministratorCoverage(sql, context.membership.organizationId);
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id,
          source, before_state, changed_fields, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'membership.permission_override_removed', 'membership_permission_override',
          ${`${parsed.data.membershipId}:${parsed.data.permissionId}`}, 'web',
          ${sql.json(overrideSnapshot(beforeRows[0]))}, ${["removed"]}::text[],
          ${sql.json({ membershipId: parsed.data.membershipId, permissionId: parsed.data.permissionId, actorMembershipId: context.membership.id })}
        )
      `;
    });

    refreshRoleEditor();
    return successState("Member permission override removed.");
  } catch (error) {
    return errorState(
      error instanceof RoleEditorActionError
        ? error.message
        : "The permission override could not be removed.",
    );
  }
}
