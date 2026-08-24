import "server-only";

import type { Sql, TransactionSql } from "postgres";

import { toJsonValue } from "@/lib/server/json-value";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

type QuerySql = Sql | TransactionSql;

export async function writeAuditEvent(
  sql: QuerySql,
  context: CurrentPermissionContext,
  input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    source?: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    changedFields?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into public.audit_events (
      organization_id, actor_user_id, action, entity_type, entity_id, source,
      before_state, after_state, changed_fields, metadata
    ) values (
      ${context.membership.organizationId}::uuid,
      ${context.user.id}::uuid,
      ${input.action},
      ${input.entityType},
      ${input.entityId ?? null},
      ${input.source ?? "web"},
      ${input.beforeState ? sql.json(toJsonValue(input.beforeState)) : null},
      ${input.afterState ? sql.json(toJsonValue(input.afterState)) : null},
      ${input.changedFields ?? []},
      ${sql.json(
        toJsonValue({ actorMembershipId: context.membership.id, ...(input.metadata ?? {}) }),
      )}
    )
  `;
}
