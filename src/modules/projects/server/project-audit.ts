import "server-only";

import type { Sql, TransactionSql } from "postgres";

import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

type QuerySql = Sql | TransactionSql;

export async function writeProjectAuditEvent(
  sql: QuerySql,
  context: CurrentPermissionContext,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    changedFields?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditEvent(sql, context, input);
}
