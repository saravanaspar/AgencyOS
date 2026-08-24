import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";

interface AuditCanaryRow {
  id: string;
}

export interface AuditPipelineHealthWorkerResult {
  canariesWritten: number;
}

/**
 * Proves that the real append-only audit sink can accept and commit a system event.
 * The canary is intentionally platform-scoped so it does not appear in a tenant's
 * audit history or depend on any tenant record remaining available.
 */
export async function runAuditPipelineHealthWorker(): Promise<AuditPipelineHealthWorkerResult> {
  const database = getDatabaseClient();
  const rows = await database<AuditCanaryRow[]>`
    insert into public.audit_events (
      organization_id,
      actor_user_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      source,
      metadata
    ) values (
      null,
      null,
      'system',
      'audit.pipeline.canary_written',
      'audit_pipeline',
      null,
      'audit_pipeline_health',
      '{"canary": true}'::jsonb
    )
    returning id::text
  `;

  if (rows.length !== 1) throw new Error("audit_pipeline_canary_not_committed");
  return { canariesWritten: 1 };
}
