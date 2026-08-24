import "server-only";

import type { TransactionSql } from "postgres";

import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export function legalPermissionScope(
  context: CurrentPermissionContext,
  permissionKey: string,
): string {
  return context.permissionScopes.get(permissionKey) ?? "own";
}

export async function validateLegalOwnerAssignment(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  ownerMembershipId: string,
  permissionKey: string,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select exists (
      select 1 from public.memberships membership
      where membership.id = ${ownerMembershipId}::uuid
        and membership.organization_id = ${context.membership.organizationId}::uuid
        and membership.status = 'active'
        and private.crm_scope_allows_membership(
          ${context.membership.id}::uuid, ${legalPermissionScope(context, permissionKey)},
          membership.id, membership.id
        )
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new Error("owner-outside-scope");
}
