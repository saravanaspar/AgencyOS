import "server-only";

import type { Sql, TransactionSql } from "postgres";

type QuerySql = Sql | TransactionSql;

export interface MemberStructureAssignment {
  organizationId: string;
  membershipId: string;
  departmentId: string | null;
  managerMembershipId: string | null;
}

export async function getMemberStructureAssignmentError(
  sql: QuerySql,
  assignment: MemberStructureAssignment,
): Promise<string | null> {
  if (assignment.departmentId) {
    const departments = await sql<{ id: string }[]>`
      select id from public.departments
      where id = ${assignment.departmentId}::uuid
        and organization_id = ${assignment.organizationId}::uuid
        and status = 'active'
    `;
    if (!departments[0]) return "Choose an active department in this organization.";
  }

  if (!assignment.managerMembershipId) return null;
  if (assignment.managerMembershipId === assignment.membershipId) {
    return "An employee cannot manage themselves.";
  }

  const managers = await sql<{ id: string }[]>`
    select id from public.memberships
    where id = ${assignment.managerMembershipId}::uuid
      and organization_id = ${assignment.organizationId}::uuid
      and status = 'active'
  `;
  if (!managers[0]) return "Choose an active manager in this organization.";

  const cycles = await sql<{ creates_cycle: boolean }[]>`
    with recursive manager_chain as (
      select id, manager_membership_id
      from public.memberships
      where id = ${assignment.managerMembershipId}::uuid
        and organization_id = ${assignment.organizationId}::uuid
      union all
      select membership.id, membership.manager_membership_id
      from public.memberships as membership
      join manager_chain on membership.id = manager_chain.manager_membership_id
      where membership.organization_id = ${assignment.organizationId}::uuid
    )
    select exists(
      select 1 from manager_chain where id = ${assignment.membershipId}::uuid
    ) as creates_cycle
  `;
  return cycles[0]?.creates_cycle ? "That reporting line would create a manager cycle." : null;
}
