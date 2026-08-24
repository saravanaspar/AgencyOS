import "server-only";

import type { TransactionSql } from "postgres";

import type { ManagedMembershipStatus } from "@/modules/identity/schemas/access-management";

export class MembershipStatusError extends Error {}

interface MembershipRoleSnapshot {
  key: string;
}

interface MembershipStatusRow {
  id: string;
  user_id: string;
  status: "active" | "deactivated" | "invited" | "suspended";
  email: string;
}

export async function ensureActiveOwnerContinuity(
  sql: TransactionSql,
  input: {
    organizationId: string;
    currentRoles: readonly MembershipRoleSnapshot[];
    currentStatus: MembershipStatusRow["status"];
    nextRoleKey?: string;
    nextStatus?: ManagedMembershipStatus;
  },
): Promise<void> {
  const removesOwnerRole =
    input.currentStatus === "active" &&
    input.currentRoles.some((role) => role.key === "owner") &&
    ((input.nextRoleKey !== undefined && input.nextRoleKey !== "owner") ||
      (input.nextStatus !== undefined && input.nextStatus !== "active"));

  if (!removesOwnerRole) return;

  const rows = await sql<Array<{ count: string }>>`
    select count(distinct membership.id)::text as count
    from public.memberships as membership
    join public.membership_roles as assignment on assignment.membership_id = membership.id
    join public.roles as role
      on role.id = assignment.role_id
     and role.organization_id = membership.organization_id
     and role.key = 'owner'
     and role.status = 'active'
    where membership.organization_id = ${input.organizationId}::uuid
      and membership.status = 'active'
  `;

  if (Number(rows[0]?.count ?? 0) <= 1) {
    throw new MembershipStatusError(
      "Assign another active Owner before removing or suspending the last Owner.",
    );
  }
}

export async function updateMembershipStatusInTransaction(
  sql: TransactionSql,
  input: {
    organizationId: string;
    actorUserId: string;
    actorMembershipId: string;
    targetMembershipId: string;
    status: ManagedMembershipStatus;
    allowSelf?: boolean;
    auditSource?: string;
    auditMetadata?: Record<string, unknown>;
  },
): Promise<{
  email: string;
  previousStatus: MembershipStatusRow["status"];
  status: ManagedMembershipStatus;
}> {
  const rows = await sql<MembershipStatusRow[]>`
    select membership.id, membership.user_id, membership.status,
      coalesce(auth_user.email, '') as email
    from public.memberships as membership
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    where membership.id = ${input.targetMembershipId}::uuid
      and membership.organization_id = ${input.organizationId}::uuid
    limit 1
    for update of membership
  `;
  const membership = rows[0];
  if (!membership) throw new MembershipStatusError("The selected membership no longer exists.");
  if (!input.allowSelf && membership.id === input.actorMembershipId && input.status !== "active") {
    throw new MembershipStatusError("You cannot suspend or deactivate your own membership.");
  }

  const roles = await sql<Array<{ key: string }>>`
    select role.key
    from public.membership_roles as assignment
    join public.roles as role on role.id = assignment.role_id
    where assignment.membership_id = ${membership.id}::uuid
  `;
  await ensureActiveOwnerContinuity(sql, {
    organizationId: input.organizationId,
    currentRoles: roles,
    currentStatus: membership.status,
    nextStatus: input.status,
  });

  await sql`
    update public.memberships
    set status = ${input.status},
      activated_at = case
        when ${input.status} = 'active' then coalesce(activated_at, now()) else activated_at end,
      suspended_at = case
        when ${input.status} = 'suspended' then now()
        when ${input.status} = 'active' then null
        else suspended_at end,
      deactivated_at = case
        when ${input.status} = 'deactivated' then now()
        when ${input.status} = 'active' then null
        else deactivated_at end
    where id = ${membership.id}::uuid
  `;

  await sql`
    insert into public.audit_events (
      organization_id, actor_user_id, action, entity_type, entity_id, source,
      before_state, after_state, changed_fields, metadata
    ) values (
      ${input.organizationId}::uuid, ${input.actorUserId}::uuid,
      'membership.status_changed', 'membership', ${membership.id},
      ${input.auditSource ?? "web"},
      ${sql.json({ status: membership.status })},
      ${sql.json({ status: input.status })}, array['status']::text[],
      ${sql.json({
        actorMembershipId: input.actorMembershipId,
        targetEmail: membership.email,
        ...(input.auditMetadata ?? {}),
      })}
    )
  `;

  return { email: membership.email, previousStatus: membership.status, status: input.status };
}
