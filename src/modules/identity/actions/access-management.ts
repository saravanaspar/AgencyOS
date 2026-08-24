"use server";

import { revalidatePath } from "next/cache";
import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  changeMemberRoleSchema,
  changeMemberStatusSchema,
  grantUserAccessSchema,
  type AccessManagementActionState,
} from "@/modules/identity/schemas/access-management";
import {
  accessManagementPermissionKeys,
  type AccessManagementPermissionKey,
} from "@/modules/identity/server/access-management";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { requireRecentReauthentication } from "@/modules/security/server/security";
import {
  ensureActiveOwnerContinuity,
  MembershipStatusError,
  updateMembershipStatusInTransaction,
} from "@/modules/identity/server/membership-status";

class AccessManagementError extends Error {}

interface ActionContext {
  actorUserId: string;
  membershipId: string;
  organizationId: string;
}

interface AuthUserRow {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  raw_user_meta_data: Record<string, unknown> | null;
}

interface RoleRow {
  id: string;
  key: string;
  name: string;
}

interface MembershipRow {
  id: string;
  user_id: string;
  status: "active" | "deactivated" | "invited" | "suspended";
  email: string;
}

interface CurrentRoleRow {
  id: string;
  key: string;
  name: string;
}

function getDisplayName(user: AuthUserRow): string {
  const metadata = user.raw_user_meta_data ?? {};
  const candidates = [metadata.display_name, metadata.full_name, metadata.name];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return user.email.split("@", 1)[0] || "AgencyOS user";
}

function actionError(message: string): AccessManagementActionState {
  return { status: "error", message };
}

async function requireActionPermissions(
  requiredPermissions: readonly AccessManagementPermissionKey[],
): Promise<ActionContext> {
  const authorization = await authorizeCurrentUser(requiredPermissions);

  if (!authorization.allowed) {
    throw new AccessManagementError(
      authorization.reason === "insufficient-permission"
        ? "You do not have permission to manage user access."
        : "Your session or organization access is no longer active.",
    );
  }

  await requireRecentReauthentication(authorization.context);

  return {
    actorUserId: authorization.context.user.id,
    membershipId: authorization.context.membership.id,
    organizationId: authorization.context.membership.organizationId,
  };
}

export async function grantUserAccessAction(
  _previousState: AccessManagementActionState,
  formData: FormData,
): Promise<AccessManagementActionState> {
  const parsed = grantUserAccessSchema.safeParse({
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        email: fieldErrors.email,
        roleId: fieldErrors.roleId,
      },
    };
  }

  try {
    const context = await requireActionPermissions([
      accessManagementPermissionKeys.createUser,
      accessManagementPermissionKeys.manageRoleAccess,
    ]);
    const database = getDatabaseClient();

    const result = await database.begin(async (sql) => {
      const users = await sql<AuthUserRow[]>`
        select id, coalesce(email, '') as email, email_confirmed_at, raw_user_meta_data
        from public.identity_accounts
        where lower(email) = ${parsed.data.email}
        limit 1
        for update
      `;
      const user = users[0];

      if (!user) {
        throw new AccessManagementError(
          "No confirmed AgencyOS account was found for that email. Ask the user to sign up first.",
        );
      }

      if (!user.email_confirmed_at) {
        throw new AccessManagementError(
          "The account exists, but its email address has not been confirmed yet.",
        );
      }

      const roles = await sql<RoleRow[]>`
        select id, key, name
        from public.roles
        where id = ${parsed.data.roleId}::uuid
          and organization_id = ${context.organizationId}::uuid
          and status = 'active'
        limit 1
      `;
      const role = roles[0];

      if (!role) {
        throw new AccessManagementError("The selected role is unavailable.");
      }

      const existingMemberships = await sql<MembershipRow[]>`
        select
          membership.id,
          membership.user_id,
          membership.status,
          coalesce(auth_user.email, '') as email
        from public.memberships as membership
        join public.identity_accounts as auth_user
          on auth_user.id = membership.user_id
        where membership.organization_id = ${context.organizationId}::uuid
          and membership.user_id = ${user.id}::uuid
        limit 1
        for update of membership
      `;
      const existingMembership = existingMemberships[0];

      if (existingMembership) {
        throw new AccessManagementError(
          "This account is already an organization member. Use the member controls below to change its role or status.",
        );
      }

      await sql`
        insert into public.profiles (id, display_name)
        values (${user.id}::uuid, ${getDisplayName(user)})
        on conflict (id) do update
        set display_name = coalesce(public.profiles.display_name, excluded.display_name)
      `;

      const memberships = await sql<{ id: string }[]>`
        insert into public.memberships (
          organization_id,
          user_id,
          status,
          invitation_accepted_at,
          activated_at,
          invited_by
        )
        values (
          ${context.organizationId}::uuid,
          ${user.id}::uuid,
          'active',
          now(),
          now(),
          ${context.actorUserId}::uuid
        )
        on conflict (organization_id, user_id) do update
        set
          status = 'active',
          invitation_accepted_at = coalesce(
            public.memberships.invitation_accepted_at,
            now()
          ),
          activated_at = coalesce(public.memberships.activated_at, now()),
          suspended_at = null,
          deactivated_at = null
        returning id
      `;
      const membershipId = memberships[0]?.id;

      if (!membershipId) {
        throw new Error("Membership was not returned after granting access.");
      }

      await sql`
        insert into public.user_preferences (membership_id)
        values (${membershipId}::uuid)
        on conflict (membership_id) do nothing
      `;

      await sql`
        delete from public.membership_roles
        where membership_id = ${membershipId}::uuid
      `;

      await sql`
        insert into public.membership_roles (membership_id, role_id, assigned_by)
        values (
          ${membershipId}::uuid,
          ${role.id}::uuid,
          ${context.actorUserId}::uuid
        )
      `;

      await sql`
        insert into public.audit_events (
          organization_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          source,
          before_state,
          after_state,
          changed_fields,
          metadata
        )
        values (
          ${context.organizationId}::uuid,
          ${context.actorUserId}::uuid,
          'membership.access_granted',
          'membership',
          ${membershipId},
          'web',
          null,
          ${sql.json({ status: "active", roleId: role.id, roleKey: role.key })},
          array['status', 'roles']::text[],
          ${sql.json({ targetEmail: user.email })}
        )
      `;

      return { email: user.email, roleName: role.name };
    });

    revalidatePath("/settings/users");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: `${result.email} now has active ${result.roleName} access.`,
    };
  } catch (error) {
    return actionError(
      error instanceof AccessManagementError || error instanceof MembershipStatusError
        ? error.message
        : "Access could not be granted. Review the server logs and try again.",
    );
  }
}

export async function changeMemberRoleAction(
  _previousState: AccessManagementActionState,
  formData: FormData,
): Promise<AccessManagementActionState> {
  const parsed = changeMemberRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a valid role and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const context = await requireActionPermissions([
      accessManagementPermissionKeys.manageRoleAccess,
    ]);
    const database = getDatabaseClient();

    const result = await database.begin(async (sql) => {
      const memberships = await sql<MembershipRow[]>`
        select
          membership.id,
          membership.user_id,
          membership.status,
          coalesce(auth_user.email, '') as email
        from public.memberships as membership
        join public.identity_accounts as auth_user
          on auth_user.id = membership.user_id
        where membership.id = ${parsed.data.membershipId}::uuid
          and membership.organization_id = ${context.organizationId}::uuid
        limit 1
        for update of membership
      `;
      const membership = memberships[0];

      if (!membership) {
        throw new AccessManagementError("The selected membership no longer exists.");
      }

      const roles = await sql<RoleRow[]>`
        select id, key, name
        from public.roles
        where id = ${parsed.data.roleId}::uuid
          and organization_id = ${context.organizationId}::uuid
          and status = 'active'
        limit 1
      `;
      const nextRole = roles[0];

      if (!nextRole) {
        throw new AccessManagementError("The selected role is unavailable.");
      }

      const currentRoles = await sql<CurrentRoleRow[]>`
        select role.id, role.key, role.name
        from public.membership_roles as assignment
        join public.roles as role
          on role.id = assignment.role_id
        where assignment.membership_id = ${membership.id}::uuid
        order by role.name
      `;

      await ensureActiveOwnerContinuity(sql, {
        organizationId: context.organizationId,
        currentRoles,
        currentStatus: membership.status,
        nextRoleKey: nextRole.key,
      });

      await sql`
        delete from public.membership_roles
        where membership_id = ${membership.id}::uuid
      `;

      await sql`
        insert into public.membership_roles (membership_id, role_id, assigned_by)
        values (
          ${membership.id}::uuid,
          ${nextRole.id}::uuid,
          ${context.actorUserId}::uuid
        )
      `;

      await sql`
        insert into public.audit_events (
          organization_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          source,
          before_state,
          after_state,
          changed_fields,
          metadata
        )
        values (
          ${context.organizationId}::uuid,
          ${context.actorUserId}::uuid,
          'membership.role_changed',
          'membership',
          ${membership.id},
          'web',
          ${sql.json({ roles: currentRoles.map((role) => role.key) })},
          ${sql.json({ roles: [nextRole.key] })},
          array['roles']::text[],
          ${sql.json({ targetEmail: membership.email })}
        )
      `;

      return { email: membership.email, roleName: nextRole.name };
    });

    revalidatePath("/settings/users");

    return {
      status: "success",
      message: `${result.email} now has the ${result.roleName} role.`,
    };
  } catch (error) {
    return actionError(
      error instanceof AccessManagementError || error instanceof MembershipStatusError
        ? error.message
        : "The role could not be updated. Try again.",
    );
  }
}

export async function changeMemberStatusAction(
  _previousState: AccessManagementActionState,
  formData: FormData,
): Promise<AccessManagementActionState> {
  const parsed = changeMemberStatusSchema.safeParse({
    membershipId: formData.get("membershipId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a valid access status and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const context = await requireActionPermissions([
      accessManagementPermissionKeys.updateUser,
      accessManagementPermissionKeys.manageUserAccess,
    ]);
    const database = getDatabaseClient();

    const result = await database.begin((sql) =>
      updateMembershipStatusInTransaction(sql, {
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        actorMembershipId: context.membershipId,
        targetMembershipId: parsed.data.membershipId,
        status: parsed.data.status,
      }),
    );

    revalidatePath("/settings/users");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: `${result.email} is now ${result.status}.`,
    };
  } catch (error) {
    return actionError(
      error instanceof AccessManagementError || error instanceof MembershipStatusError
        ? error.message
        : "The access status could not be updated. Try again.",
    );
  }
}
