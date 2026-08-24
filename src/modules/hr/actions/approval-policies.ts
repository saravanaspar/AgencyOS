import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { createApprovalDefinition } from "@/modules/approvals/server/approvals";
import type { CreateApprovalDefinitionInput } from "@/modules/approvals/schemas/approvals";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export async function ensureHrApprovalPolicy(
  context: CurrentPermissionContext,
  input: CreateApprovalDefinitionInput,
): Promise<void> {
  const database = getDatabaseClient();
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${input.key}
      and source_module = ${input.sourceModule}
      and entity_type = ${input.entityType}
      and status = 'active'
    limit 1
  `;
  if (existing[0]) return;

  try {
    await createApprovalDefinition(context, input);
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${input.key}
        and source_module = ${input.sourceModule}
        and entity_type = ${input.entityType}
        and status = 'active'
      limit 1
    `;
    if (!raced[0]) throw error;
  }
}
