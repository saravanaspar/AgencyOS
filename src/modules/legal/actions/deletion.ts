"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import {
  createApprovalDefinition,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import {
  legalDeletionPermissionKeys,
  legalDeletionPurgeClaimStale,
  legalDeletionPurgeClaimTimeoutMinutes,
  type LegalDeletionTargetType,
} from "@/modules/legal/deletion";
import { legalPermissionKeys } from "@/modules/legal/legal";
import {
  legalDeletionExecuteSchema,
  legalDeletionPolicySchema,
  legalDeletionRequestSchema,
  type LegalDeletionActionState,
} from "@/modules/legal/schemas/deletion";
import {
  loadLegalDeletionTargetSnapshot,
  requireLegalDeletionRequestAccess,
  type LegalDeletionTargetSnapshot,
} from "@/modules/legal/server/deletion";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  purgePrivateFileObjects,
  softDeletePrivateFile,
} from "@/modules/private-files/server/private-files";

const DELETION_POLICY_KEY = "legal_controlled_deletion";
const success = (message: string): LegalDeletionActionState => ({ status: "success", message });
const failure = (
  message: string,
  fieldErrors?: Record<string, string[]>,
): LegalDeletionActionState => ({ status: "error", message, fieldErrors });
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/legal");

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

async function ensureLegalDeletionApprovalPolicy(context: CurrentPermissionContext): Promise<void> {
  const database = getDatabaseClient();
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = ${DELETION_POLICY_KEY}
      and source_module = 'legal'
      and entity_type = 'legal_deletion'
      and status = 'active'
    limit 1
  `;
  if (existing[0]) return;
  try {
    await createApprovalDefinition(context, {
      key: DELETION_POLICY_KEY,
      name: "Controlled legal deletion",
      description:
        "Requires an authorized Owner other than the requester to approve permanent legal-content deletion.",
      sourceModule: "legal",
      entityType: "legal_deletion",
      allowSelfApproval: false,
      allowReassignment: true,
      steps: [
        {
          name: "Second-person deletion approval",
          stageOrder: 1,
          sortOrder: 1,
          selectorType: "role",
          selectorRoleKey: "owner",
          selectorMembershipId: null,
          decisionMode: "any",
          conditions: {},
          commentRequired: true,
          reminderAfterHours: 24,
          escalationAfterHours: 72,
          expiresAfterHours: 168,
        },
      ],
    });
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = ${DELETION_POLICY_KEY}
        and source_module = 'legal'
        and entity_type = 'legal_deletion'
        and status = 'active'
      limit 1
    `;
    if (!raced[0]) throw error;
  }
}

async function requireDeletionTargetAccess(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  targetType: LegalDeletionTargetType,
  targetId: string,
): Promise<void> {
  const rows =
    targetType === "contract"
      ? await sql<Array<{ allowed: boolean }>>`
          select private.legal_contract_membership_access_allowed(
            ${targetId}::uuid, ${context.membership.id}::uuid,
            ${legalDeletionPermissionKeys.request}
          ) as allowed
        `
      : await sql<Array<{ allowed: boolean }>>`
          select private.legal_compliance_record_membership_access_allowed(
            ${targetId}::uuid, ${context.membership.id}::uuid,
            ${legalDeletionPermissionKeys.request}
          ) as allowed
        `;
  if (!rows[0]?.allowed) throw new Error("deletion-target-outside-scope");
}

async function insertDeletionRequest(
  sql: TransactionSql,
  input: {
    context: CurrentPermissionContext;
    requestId: string;
    snapshot: LegalDeletionTargetSnapshot;
    reason: string;
    secondApprovalRequired: boolean;
    approvalRequestId: string | null;
  },
): Promise<void> {
  const status = input.secondApprovalRequired ? "pending_approval" : "approved";
  await sql`
    insert into public.legal_deletion_requests (
      id, organization_id, target_type, target_id, target_reference, target_title,
      target_status, target_owner_membership_id, target_created_by_membership_id,
      requested_by_membership_id, reason, status, second_approval_required,
      approval_request_id, eligibility_snapshot, object_count, approved_at
    ) values (
      ${input.requestId}::uuid, ${input.context.membership.organizationId}::uuid,
      ${input.snapshot.targetType}, ${input.snapshot.targetId}::uuid,
      ${input.snapshot.targetReference}, ${input.snapshot.targetTitle},
      ${input.snapshot.targetStatus}, ${input.snapshot.targetOwnerMembershipId}::uuid,
      ${input.snapshot.targetCreatedByMembershipId}::uuid,
      ${input.context.membership.id}::uuid, ${input.reason}, ${status},
      ${input.secondApprovalRequired}, ${input.approvalRequestId}::uuid,
      ${sql.json(
        toJsonValue({
          targetStatus: input.snapshot.targetStatus,
          documentCount: input.snapshot.documentIds.length,
          objectCount: input.snapshot.objects.length,
          legalHoldChecked: true,
          retentionCheckedOn: new Date().toISOString().slice(0, 10),
          sharingChecked: true,
        }),
      )},
      ${input.snapshot.objects.length},
      ${input.secondApprovalRequired ? null : new Date()}
    )
  `;
  await Promise.all(
    input.snapshot.objects.map(
      (object) => sql`
        insert into public.legal_deletion_objects (
          organization_id, request_id, document_id, document_version_id,
          private_file_id, sha256, size_bytes
        ) values (
          ${input.context.membership.organizationId}::uuid, ${input.requestId}::uuid,
          ${object.documentId}::uuid, ${object.documentVersionId}::uuid,
          ${object.privateFileId}::uuid, ${object.sha256}, ${object.sizeBytes}
        )
      `,
    ),
  );
  await sql`
    insert into public.legal_deletion_events (
      organization_id, request_id, event_type, actor_membership_id, details
    ) values (
      ${input.context.membership.organizationId}::uuid, ${input.requestId}::uuid,
      'deletion.requested', ${input.context.membership.id}::uuid,
      ${sql.json(
        toJsonValue({
          targetType: input.snapshot.targetType,
          targetStatus: input.snapshot.targetStatus,
          secondApprovalRequired: input.secondApprovalRequired,
          objectCount: input.snapshot.objects.length,
        }),
      )}
    )
  `;
  await writeAuditEvent(sql, input.context, {
    action: "legal.deletion.requested",
    entityType: "legal_deletion_request",
    entityId: input.requestId,
    afterState: {
      targetType: input.snapshot.targetType,
      targetId: input.snapshot.targetId,
      targetStatus: input.snapshot.targetStatus,
      secondApprovalRequired: input.secondApprovalRequired,
      objectCount: input.snapshot.objects.length,
    },
    changedFields: ["status", "eligibility", "objects"],
  });
}

export async function updateLegalDeletionPolicyAction(
  _previous: LegalDeletionActionState,
  formData: FormData,
): Promise<LegalDeletionActionState> {
  const parsed = legalDeletionPolicySchema.safeParse({
    secondApprovalRequired: value(formData, "secondApprovalRequired"),
  });
  if (!parsed.success) return failure("Check the deletion-policy settings.");
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalDeletionPermissionKeys.configure,
  ]);
  if (!authorization.allowed) return failure("You cannot configure legal deletion.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const previous = await sql<Array<{ second_approval_required: boolean }>>`
        select second_approval_required from public.legal_deletion_policies
        where organization_id = ${context.membership.organizationId}::uuid
      `;
      await sql`
        insert into public.legal_deletion_policies (
          organization_id, second_approval_required, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid,
          ${parsed.data.secondApprovalRequired}, ${context.membership.id}::uuid
        )
        on conflict (organization_id) do update set
          second_approval_required = excluded.second_approval_required,
          updated_by_membership_id = excluded.updated_by_membership_id,
          updated_at = now()
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.deletion.policy_updated",
        entityType: "legal_deletion_policy",
        entityId: context.membership.organizationId,
        beforeState: {
          secondApprovalRequired: previous[0]?.second_approval_required ?? true,
        },
        afterState: { secondApprovalRequired: parsed.data.secondApprovalRequired },
        changedFields: ["secondApprovalRequired"],
      });
    });
    refresh();
    return success("Legal deletion policy updated.");
  } catch {
    return failure("The legal deletion policy could not be updated.");
  }
}

export async function requestLegalDeletionAction(
  _previous: LegalDeletionActionState,
  formData: FormData,
): Promise<LegalDeletionActionState> {
  const parsed = legalDeletionRequestSchema.safeParse({
    targetType: value(formData, "targetType"),
    targetId: value(formData, "targetId"),
    reason: value(formData, "reason"),
  });
  if (!parsed.success) {
    return failure("Check the deletion request.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalDeletionPermissionKeys.request,
  ]);
  if (!authorization.allowed) return failure("You cannot request legal deletion.");
  const context = authorization.context;
  const database = getDatabaseClient();
  const requestId = randomUUID();

  try {
    const policyRows = await database<Array<{ second_approval_required: boolean }>>`
      select second_approval_required from public.legal_deletion_policies
      where organization_id = ${context.membership.organizationId}::uuid
    `;
    const secondApprovalRequired = policyRows[0]?.second_approval_required ?? true;
    if (secondApprovalRequired) await ensureLegalDeletionApprovalPolicy(context);

    const prepare = async (sql: TransactionSql, approvalRequestId: string | null) => {
      await requireDeletionTargetAccess(sql, context, parsed.data.targetType, parsed.data.targetId);
      const snapshot = await loadLegalDeletionTargetSnapshot(sql, {
        organizationId: context.membership.organizationId,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        lock: true,
      });
      if (!snapshot) throw new Error("deletion-target-not-found");
      if (snapshot.blockers.length) {
        throw new Error(`deletion-blocked:${snapshot.blockerMessages.join(" ")}`);
      }
      await insertDeletionRequest(sql, {
        context,
        requestId,
        snapshot,
        reason: parsed.data.reason,
        secondApprovalRequired,
        approvalRequestId,
      });
      return snapshot;
    };

    if (secondApprovalRequired) {
      const snapshot = await database.begin(async (sql) => {
        await requireDeletionTargetAccess(
          sql,
          context,
          parsed.data.targetType,
          parsed.data.targetId,
        );
        const result = await loadLegalDeletionTargetSnapshot(sql, {
          organizationId: context.membership.organizationId,
          targetType: parsed.data.targetType,
          targetId: parsed.data.targetId,
          lock: true,
        });
        if (!result) throw new Error("deletion-target-not-found");
        if (result.blockers.length) {
          throw new Error(`deletion-blocked:${result.blockerMessages.join(" ")}`);
        }
        return result;
      });
      await submitApprovalForRecordAtomically(
        context,
        {
          definitionKey: DELETION_POLICY_KEY,
          sourceModule: "legal",
          entityType: "legal_deletion",
          title: `Legal deletion: ${snapshot.targetReference}`,
          entityId: requestId,
          deepLink: "/legal",
          departmentId: null,
          amount: null,
          currency: null,
          snapshot: {
            targetType: snapshot.targetType,
            targetId: snapshot.targetId,
            targetReference: snapshot.targetReference,
            targetStatus: snapshot.targetStatus,
            objectCount: snapshot.objects.length,
          },
          dueAt: null,
        },
        async (sql, approvalRequestId) => prepare(sql, approvalRequestId),
      );
    } else {
      await database.begin(async (sql) => prepare(sql, null));
    }

    refresh();
    return success(
      secondApprovalRequired
        ? "Deletion request submitted for second-person approval."
        : "Deletion request approved by policy and ready to execute.",
    );
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith("deletion-blocked:")) {
      return failure(message.slice("deletion-blocked:".length));
    }
    if (errorCode(error) === "23505") {
      return failure("An active deletion request already exists for this legal record.");
    }
    if (message.includes("No eligible approvers")) {
      return failure("A second active Owner is required by the current deletion policy.");
    }
    return failure("The legal deletion request could not be created.");
  }
}

type ExecutionObject = {
  id: string;
  document_id: string;
  document_version_id: string;
  private_file_id: string;
  sha256: string;
  size_bytes: string | number;
  purge_status: string;
  file_status: string;
  quarantine_bucket: string | null;
  quarantine_path: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

function deletionDigest(input: {
  requestId: string;
  targetType: string;
  targetId: string;
  objects: Array<{ private_file_id: string; sha256: string }>;
}): string {
  const evidence = {
    requestId: input.requestId,
    targetType: input.targetType,
    targetId: input.targetId,
    objects: [...input.objects]
      .map((object) => ({ id: object.private_file_id, sha256: object.sha256 }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export async function executeLegalDeletionAction(
  _previous: LegalDeletionActionState,
  formData: FormData,
): Promise<LegalDeletionActionState> {
  const parsed = legalDeletionExecuteSchema.safeParse({ requestId: value(formData, "requestId") });
  if (!parsed.success) return failure("The deletion request is invalid.");
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalDeletionPermissionKeys.execute,
  ]);
  if (!authorization.allowed) return failure("You cannot execute legal deletion.");
  const context = authorization.context;
  const database = getDatabaseClient();

  try {
    const prepared = await database.begin(async (sql) => {
      await requireLegalDeletionRequestAccess(
        context,
        parsed.data.requestId,
        legalDeletionPermissionKeys.execute,
        sql,
      );
      const requests = await sql<
        Array<{
          id: string;
          target_type: LegalDeletionTargetType;
          target_id: string;
          target_reference: string;
          status: string;
          purge_claimed_at: Date | null;
        }>
      >`
        select id, target_type, target_id, target_reference, status, purge_claimed_at
        from public.legal_deletion_requests
        where id = ${parsed.data.requestId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const request = requests[0];
      const stalePurgeClaim =
        request?.status === "purging" && legalDeletionPurgeClaimStale(request.purge_claimed_at);
      if (
        !request ||
        (!["approved", "purge_failed"].includes(request.status) && !stalePurgeClaim)
      ) {
        throw new Error(
          request?.status === "purging" ? "deletion-claim-active" : "deletion-not-executable",
        );
      }
      const claimToken = randomUUID();
      const objects = await sql<ExecutionObject[]>`
        select object.id, object.document_id, object.document_version_id,
          object.private_file_id, object.sha256, object.size_bytes, object.purge_status,
          private_file.status as file_status, private_file.quarantine_bucket,
          private_file.quarantine_path, private_file.storage_bucket, private_file.storage_path
        from public.legal_deletion_objects object
        join public.private_files private_file on private_file.id = object.private_file_id
        where object.request_id = ${request.id}::uuid
        order by object.id
        for update of object, private_file
      `;
      if (!objects.length) throw new Error("deletion-objects-missing");

      if (request.status === "approved") {
        const snapshot = await loadLegalDeletionTargetSnapshot(sql, {
          organizationId: context.membership.organizationId,
          targetType: request.target_type,
          targetId: request.target_id,
          lock: true,
        });
        if (!snapshot) throw new Error("deletion-target-not-found");
        if (snapshot.blockers.length) {
          throw new Error(`deletion-blocked:${snapshot.blockerMessages.join(" ")}`);
        }
        const currentObjectIds = snapshot.objects.map((object) => object.privateFileId).sort();
        const requestedObjectIds = objects.map((object) => object.private_file_id).sort();
        if (JSON.stringify(currentObjectIds) !== JSON.stringify(requestedObjectIds)) {
          throw new Error("deletion-eligibility-changed");
        }
        if (objects.some((object) => object.file_status !== "available")) {
          throw new Error("deletion-file-state-changed");
        }
        await Promise.all(
          objects.map((object) =>
            softDeletePrivateFile(sql, {
              fileId: object.private_file_id,
              organizationId: context.membership.organizationId,
              actorMembershipId: context.membership.id,
            }),
          ),
        );
      }

      await sql`
        update public.legal_deletion_requests
        set status = 'purging', execution_started_at = coalesce(execution_started_at, now()),
          purge_claim_token = ${claimToken}::uuid, purge_claimed_at = now(),
          failure_code = null, updated_at = now()
        where id = ${request.id}::uuid
      `;
      await sql`
        insert into public.legal_deletion_events (
          organization_id, request_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${request.id}::uuid,
          ${
            request.status === "purge_failed"
              ? "deletion.purge_retried"
              : request.status === "purging"
                ? "deletion.purge_recovered"
                : "deletion.execution_started"
          },
          ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ objectCount: objects.length }))}
        )
      `;
      return { request, objects, claimToken };
    });

    const results = await Promise.all(
      prepared.objects.map(async (object) => ({
        id: object.id,
        purged:
          object.purge_status === "purged"
            ? true
            : await purgePrivateFileObjects({
                fileId: object.private_file_id,
                organizationId: context.membership.organizationId,
                quarantineBucket: object.quarantine_bucket,
                quarantinePath: object.quarantine_path,
                storageBucket: object.storage_bucket,
                storagePath: object.storage_path,
              }),
      })),
    );

    const failedIds = results.reduce<string[]>((ids, result) => {
      if (!result.purged) ids.push(result.id);
      return ids;
    }, []);
    if (failedIds.length) {
      await database.begin(async (sql) => {
        const claims = await sql<Array<{ id: string }>>`
          select id from public.legal_deletion_requests
          where id = ${prepared.request.id}::uuid and status = 'purging'
            and purge_claim_token = ${prepared.claimToken}::uuid
          for update
        `;
        if (!claims[0]) throw new Error("deletion-claim-lost");
        await Promise.all(
          results.map(
            (result) => sql`
              update public.legal_deletion_objects set
                purge_status = ${result.purged ? "purged" : "failed"},
                purge_attempt_count = purge_attempt_count + 1,
                purged_at = ${result.purged ? new Date() : null},
                last_error_code = ${result.purged ? null : "object-purge-failed"},
                updated_at = now()
              where id = ${result.id}::uuid
            `,
          ),
        );
        await sql`
          update public.legal_deletion_requests
          set status = 'purge_failed', failure_code = 'object-purge-failed',
            purge_claim_token = null, purge_claimed_at = null, updated_at = now()
          where id = ${prepared.request.id}::uuid and status = 'purging'
            and purge_claim_token = ${prepared.claimToken}::uuid
        `;
        await sql`
          insert into public.legal_deletion_events (
            organization_id, request_id, event_type, actor_membership_id, details
          ) values (
            ${context.membership.organizationId}::uuid, ${prepared.request.id}::uuid,
            'deletion.purge_failed', ${context.membership.id}::uuid,
            ${sql.json(toJsonValue({ failedObjectCount: failedIds.length }))}
          )
        `;
        await writeAuditEvent(sql, context, {
          action: "legal.deletion.purge_failed",
          entityType: "legal_deletion_request",
          entityId: prepared.request.id,
          afterState: { failedObjectCount: failedIds.length },
          changedFields: ["status", "objectPurge"],
        });
      });
      refresh();
      return failure("Some private objects could not be removed. Retry the approved deletion.");
    }

    await database.begin(async (sql) => {
      await requireLegalDeletionRequestAccess(
        context,
        prepared.request.id,
        legalDeletionPermissionKeys.execute,
        sql,
      );
      const claims = await sql<Array<{ id: string }>>`
        select id from public.legal_deletion_requests
        where id = ${prepared.request.id}::uuid and status = 'purging'
          and purge_claim_token = ${prepared.claimToken}::uuid
        for update
      `;
      if (!claims[0]) throw new Error("deletion-claim-lost");
      const digest = deletionDigest({
        requestId: prepared.request.id,
        targetType: prepared.request.target_type,
        targetId: prepared.request.target_id,
        objects: prepared.objects,
      });
      await Promise.all(
        results.map(
          (result) => sql`
            update public.legal_deletion_objects set
              purge_status = 'purged', purge_attempt_count = purge_attempt_count + 1,
              purged_at = coalesce(purged_at, now()), last_error_code = null, updated_at = now()
            where id = ${result.id}::uuid
          `,
        ),
      );
      const documentIds = [...new Set(prepared.objects.map((object) => object.document_id))];
      await sql`
        update public.documents set
          title = concat('Deleted legal document ', left(id::text, 8)),
          description = null, current_version_id = null,
          expiry_date = null, review_date = null, retention_until = null,
          status = 'archived', archived_at = coalesce(archived_at, now()),
          archived_by_membership_id = coalesce(archived_by_membership_id, ${context.membership.id}::uuid),
          updated_at = now()
        where organization_id = ${context.membership.organizationId}::uuid
          and id in ${sql(documentIds)}
      `;
      if (prepared.request.target_type === "contract") {
        await sql`
          update public.legal_contracts set
            title = '[Deleted contract]', counterparty_name = '[Deleted]',
            counterparty_company_id = null, jurisdiction = null, governing_law = null,
            contract_value_minor = null, currency = null,
            termination_reason = case when status = 'terminated'
              then 'Deleted under approved retention process.' else termination_reason end,
            deleted_at = now(), deleted_by_membership_id = ${context.membership.id}::uuid,
            deletion_request_id = ${prepared.request.id}::uuid, updated_at = now()
          where id = ${prepared.request.target_id}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and deleted_at is null
        `;
        await sql`
          update public.legal_contract_reminders set status = 'cancelled',
            acknowledged_by_membership_id = null, acknowledged_at = null, updated_at = now()
          where contract_id = ${prepared.request.target_id}::uuid and status = 'pending'
        `;
        await sql`
          insert into public.legal_contract_events (
            organization_id, contract_id, event_type, actor_membership_id, details
          ) values (
            ${context.membership.organizationId}::uuid, ${prepared.request.target_id}::uuid,
            'contract.deleted', ${context.membership.id}::uuid,
            ${sql.json(toJsonValue({ deletionRequestId: prepared.request.id, auditDigest: digest }))}
          )
        `;
      } else {
        await sql`
          update public.legal_compliance_records set
            title = '[Deleted compliance record]', issuing_authority = null,
            jurisdiction = null, identifier_last_four = null, summary = null,
            closure_reason = 'Deleted under approved retention process.',
            deleted_at = now(), deleted_by_membership_id = ${context.membership.id}::uuid,
            deletion_request_id = ${prepared.request.id}::uuid, updated_at = now()
          where id = ${prepared.request.target_id}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and deleted_at is null
        `;
        await sql`
          update public.legal_compliance_record_reminders set status = 'cancelled',
            acknowledged_by_membership_id = null, acknowledged_at = null, updated_at = now()
          where record_id = ${prepared.request.target_id}::uuid and status = 'pending'
        `;
        await sql`
          insert into public.legal_compliance_record_events (
            organization_id, record_id, event_type, actor_membership_id, details
          ) values (
            ${context.membership.organizationId}::uuid, ${prepared.request.target_id}::uuid,
            'compliance.record_deleted', ${context.membership.id}::uuid,
            ${sql.json(toJsonValue({ deletionRequestId: prepared.request.id, auditDigest: digest }))}
          )
        `;
      }
      await sql`
        update public.legal_deletion_requests set
          status = 'completed', audit_digest = ${digest}, completed_at = now(),
          completed_by_membership_id = ${context.membership.id}::uuid,
          purge_claim_token = null, purge_claimed_at = null,
          failure_code = null, updated_at = now()
        where id = ${prepared.request.id}::uuid and status = 'purging'
          and purge_claim_token = ${prepared.claimToken}::uuid
      `;
      await sql`
        insert into public.legal_deletion_events (
          organization_id, request_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${prepared.request.id}::uuid,
          'deletion.completed', ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ auditDigest: digest, objectCount: prepared.objects.length }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.deletion.completed",
        entityType: "legal_deletion_request",
        entityId: prepared.request.id,
        beforeState: {
          targetType: prepared.request.target_type,
          targetId: prepared.request.target_id,
          status: "purging",
        },
        afterState: {
          status: "completed",
          objectCount: prepared.objects.length,
          auditDigest: digest,
        },
        changedFields: ["status", "objects", "targetTombstone"],
      });
    });

    refresh();
    return success("Legal record content was securely removed and permanently audited.");
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith("deletion-blocked:")) {
      return failure(message.slice("deletion-blocked:".length));
    }
    if (message === "deletion-eligibility-changed") {
      return failure(
        "The linked document set changed after approval. Create a new deletion request.",
      );
    }
    if (message === "deletion-not-executable") {
      return failure("This deletion request is not approved or retryable.");
    }
    if (message === "deletion-claim-active") {
      return failure(
        `A secure deletion attempt is already active. Recovery becomes available after ${legalDeletionPurgeClaimTimeoutMinutes} minutes.`,
      );
    }
    if (message === "deletion-claim-lost") {
      return failure(
        "This deletion attempt was superseded by a newer recovery attempt. Refresh the workspace.",
      );
    }
    return failure("The approved legal deletion could not be executed.");
  }
}
