import "server-only";

import { cache } from "react";
import type { Sql } from "postgres";

import { withInfrastructureRetry } from "@/lib/server/retry";
import {
  getCurrentAccessContext,
  type AccessDenialReason,
  type AccessPermissionRow,
  type CurrentAccessContext,
} from "@/modules/identity/server/get-current-access-context";
import type { PermissionScope } from "@/modules/permissions/permission-scopes";

export interface EffectivePermissionGrant {
  key: string;
  scope: PermissionScope;
}

export interface CurrentPermissionContext extends CurrentAccessContext {
  permissions: ReadonlySet<string>;
  permissionScopes: ReadonlyMap<string, PermissionScope>;
}

export type CurrentPermissionResult =
  | { allowed: true; context: CurrentPermissionContext }
  | { allowed: false; reason: AccessDenialReason };

const scopeRank: Record<PermissionScope, number> = {
  own: 1,
  assigned: 2,
  assigned_or_created: 3,
  team: 4,
  department: 5,
  managed_employees: 6,
  selected_projects: 7,
  organization: 8,
};

function broaderScope(left: PermissionScope | undefined, right: PermissionScope): PermissionScope {
  if (!left) return right;
  return scopeRank[right] > scopeRank[left] ? right : left;
}

export function resolveEffectivePermissionRows(
  rows: readonly AccessPermissionRow[],
): Map<string, PermissionScope> {
  const roleScopes = new Map<string, PermissionScope>();
  const allowOverrides = new Map<string, PermissionScope | null>();
  const denied = new Set<string>();

  for (const row of rows) {
    if (row.source === "override") {
      if (row.effect === "deny") denied.add(row.key);
      else allowOverrides.set(row.key, row.scope);
      continue;
    }

    if (row.scope) {
      roleScopes.set(row.key, broaderScope(roleScopes.get(row.key), row.scope));
    }
  }

  const grants = new Map<string, PermissionScope>();
  const keys = new Set([...roleScopes.keys(), ...allowOverrides.keys()]);

  for (const key of keys) {
    if (denied.has(key)) continue;
    const overrideScope = allowOverrides.get(key);
    const resolvedScope =
      overrideScope ??
      roleScopes.get(key) ??
      (allowOverrides.has(key) ? "organization" : undefined);
    if (resolvedScope) grants.set(key, resolvedScope);
  }

  return grants;
}

export async function getEffectivePermissionGrants(
  sql: Sql,
  membershipId: string,
  organizationId: string,
): Promise<Map<string, PermissionScope>> {
  const rows = await withInfrastructureRetry(
    () => sql<AccessPermissionRow[]>`
      with role_grants as (
        select permission.key, role_permission.scope, 'allow'::text as effect, 'role'::text as source
        from public.membership_roles as assignment
        join public.roles as role
          on role.id = assignment.role_id
         and role.organization_id = ${organizationId}::uuid
         and role.status = 'active'
        join public.role_permissions as role_permission
          on role_permission.role_id = role.id
        join public.permissions as permission
          on permission.id = role_permission.permission_id
        where assignment.membership_id = ${membershipId}::uuid
      ),
      active_overrides as (
        select permission.key, override_grant.scope, override_grant.effect, 'override'::text as source
        from public.membership_permission_overrides as override_grant
        join public.permissions as permission
          on permission.id = override_grant.permission_id
        where override_grant.membership_id = ${membershipId}::uuid
          and (override_grant.expires_at is null or override_grant.expires_at > now())
      )
      select key, scope, effect, source from role_grants
      union all
      select key, scope, effect, source from active_overrides
    `,
    { attempts: 2, operationName: "Effective permission lookup" },
  );

  return resolveEffectivePermissionRows(rows);
}

export async function getEffectivePermissionKeys(
  sql: Sql,
  membershipId: string,
  organizationId: string,
): Promise<Set<string>> {
  const grants = await getEffectivePermissionGrants(sql, membershipId, organizationId);
  return new Set(grants.keys());
}

export function hasEveryPermission(
  permissions: ReadonlySet<string>,
  required: readonly string[],
): boolean {
  return required.every((permission) => permissions.has(permission));
}

async function resolveCurrentPermissionContext(): Promise<CurrentPermissionResult> {
  const access = await getCurrentAccessContext();

  if (!access.allowed) {
    return access;
  }

  try {
    const permissionScopes = resolveEffectivePermissionRows(access.context.permissionRows);

    return {
      allowed: true,
      context: {
        ...access.context,
        permissions: new Set(permissionScopes.keys()),
        permissionScopes,
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}

export const getCurrentPermissionContext = cache(resolveCurrentPermissionContext);
