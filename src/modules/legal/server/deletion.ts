import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  legalDeletionBlockerLabels,
  legalDeletionLifecycleEligible,
  legalDeletionPermissionKeys,
  legalDeletionPurgeClaimStale,
  legalDeletionRetentionEligible,
  legalDeletionStatusLabels,
  legalDeletionTargetTypeLabels,
  type LegalDeletionBlockerCode,
  type LegalDeletionStatus,
  type LegalDeletionTargetType,
} from "@/modules/legal/deletion";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";

export type LegalDeletionObjectCandidate = {
  documentId: string;
  documentVersionId: string;
  privateFileId: string;
  sha256: string;
  sizeBytes: number;
  fileStatus: string;
  quarantineBucket: string | null;
  quarantinePath: string | null;
  storageBucket: string | null;
  storagePath: string | null;
};

export type LegalDeletionTargetSnapshot = {
  targetType: LegalDeletionTargetType;
  targetId: string;
  targetReference: string;
  targetTitle: string;
  targetStatus: string;
  targetOwnerMembershipId: string;
  targetCreatedByMembershipId: string;
  documentIds: string[];
  objects: LegalDeletionObjectCandidate[];
  blockers: LegalDeletionBlockerCode[];
  blockerMessages: string[];
};

export interface LegalDeletionCandidateSummary {
  targetType: LegalDeletionTargetType;
  targetId: string;
  reference: string;
  title: string;
  status: string;
  ownerName: string;
}

export interface LegalDeletionRequestSummary {
  id: string;
  targetType: LegalDeletionTargetType;
  targetTypeLabel: string;
  targetReference: string;
  targetTitle: string;
  targetStatus: string;
  reason: string;
  status: LegalDeletionStatus;
  statusLabel: string;
  secondApprovalRequired: boolean;
  approvalRequestId: string | null;
  objectCount: number;
  requestedByName: string;
  requestedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  canExecute: boolean;
}

export interface LegalDeletionWorkspaceData {
  policy: { secondApprovalRequired: boolean; updatedAt: string | null };
  candidates: LegalDeletionCandidateSummary[];
  requests: LegalDeletionRequestSummary[];
  capabilities: {
    canRequest: boolean;
    canExecute: boolean;
    canConfigure: boolean;
  };
}

export type LegalDeletionWorkspaceResult =
  | { allowed: true; data: LegalDeletionWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export class LegalDeletionAccessError extends Error {}

export async function requireLegalDeletionRequestAccess(
  context: CurrentPermissionContext,
  requestId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.legal_deletion_request_membership_access_allowed(
      ${requestId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new LegalDeletionAccessError("Deletion request is outside your permission scope.");
  }
}

function pushBlocker(blockers: LegalDeletionBlockerCode[], blocker: LegalDeletionBlockerCode) {
  if (!blockers.includes(blocker)) blockers.push(blocker);
}

export async function loadLegalDeletionTargetSnapshot(
  sql: TransactionSql,
  input: {
    organizationId: string;
    targetType: LegalDeletionTargetType;
    targetId: string;
    lock?: boolean;
  },
): Promise<LegalDeletionTargetSnapshot | null> {
  const targetRows =
    input.targetType === "contract"
      ? await sql<
          Array<{
            id: string;
            internal_reference: string;
            title: string;
            status: string;
            owner_id: string;
            creator_id: string;
          }>
        >`
          select id, internal_reference, title, status,
            responsible_owner_membership_id as owner_id,
            created_by_membership_id as creator_id
          from public.legal_contracts
          where id = ${input.targetId}::uuid
            and organization_id = ${input.organizationId}::uuid
            and deleted_at is null
          ${input.lock ? sql`for update` : sql``}
        `
      : await sql<
          Array<{
            id: string;
            internal_reference: string;
            title: string;
            status: string;
            owner_id: string;
            creator_id: string;
          }>
        >`
          select id, internal_reference, title, status,
            responsible_owner_membership_id as owner_id,
            created_by_membership_id as creator_id
          from public.legal_compliance_records
          where id = ${input.targetId}::uuid
            and organization_id = ${input.organizationId}::uuid
            and deleted_at is null
          ${input.lock ? sql`for update` : sql``}
        `;
  const target = targetRows[0];
  if (!target) return null;

  const documentRows =
    input.targetType === "contract"
      ? await sql<Array<{ document_id: string }>>`
          select distinct document_id
          from public.legal_contract_versions
          where contract_id = ${input.targetId}::uuid
            and organization_id = ${input.organizationId}::uuid
        `
      : await sql<Array<{ document_id: string }>>`
          select document_id
          from public.legal_compliance_records
          where id = ${input.targetId}::uuid
            and organization_id = ${input.organizationId}::uuid
        `;
  const documentIds = documentRows.map((row) => row.document_id);
  const blockers: LegalDeletionBlockerCode[] = [];
  if (
    !legalDeletionLifecycleEligible({ targetType: input.targetType, targetStatus: target.status })
  ) {
    pushBlocker(blockers, "active-target");
  }
  if (documentIds.length === 0) pushBlocker(blockers, "missing-document");

  const documents = documentIds.length
    ? await sql<
        Array<{
          id: string;
          legal_hold: boolean;
          retention_until: string | null;
          active_publications: number;
          pending_reviews: number;
          template_uses: number;
          entity_links: number;
          other_contract_uses: number;
          other_compliance_uses: number;
        }>
      >`
        select document.id, document.legal_hold, document.retention_until::text,
          (select count(*)::integer from public.document_publications publication
            where publication.document_id = document.id and publication.status = 'active') as active_publications,
          (select count(*)::integer from public.document_review_requests review
            where review.document_id = document.id and review.status = 'pending') as pending_reviews,
          (select count(*)::integer from public.legal_contract_templates template
            where template.source_document_id = document.id and template.status = 'active') as template_uses,
          (select count(*)::integer from public.document_entity_links link
            where link.document_id = document.id) as entity_links,
          (select count(*)::integer from public.legal_contract_versions version
            join public.legal_contracts contract on contract.id = version.contract_id
            where version.document_id = document.id and contract.deleted_at is null
              and (${input.targetType} <> 'contract' or contract.id <> ${input.targetId}::uuid)) as other_contract_uses,
          (select count(*)::integer from public.legal_compliance_records record
            where record.document_id = document.id and record.deleted_at is null
              and (${input.targetType} <> 'compliance_record' or record.id <> ${input.targetId}::uuid)) as other_compliance_uses
        from public.documents document
        where document.organization_id = ${input.organizationId}::uuid
          and document.id in ${sql(documentIds)}
      `
    : [];

  for (const document of documents) {
    if (document.legal_hold) pushBlocker(blockers, "legal-hold");
    if (!legalDeletionRetentionEligible(document.retention_until)) {
      pushBlocker(blockers, "retention-active");
    }
    if (document.active_publications > 0) pushBlocker(blockers, "active-publication");
    if (document.pending_reviews > 0) pushBlocker(blockers, "pending-review");
    if (document.template_uses > 0) pushBlocker(blockers, "template-source");
    if (
      document.entity_links > 0 ||
      document.other_contract_uses > 0 ||
      document.other_compliance_uses > 0
    ) {
      pushBlocker(blockers, "shared-document");
    }
  }

  if (documents.length !== documentIds.length) pushBlocker(blockers, "missing-document");

  const objects = documentIds.length
    ? await sql<
        Array<{
          document_id: string;
          document_version_id: string;
          private_file_id: string;
          sha256: string;
          size_bytes: string | number;
          file_status: string;
          quarantine_bucket: string | null;
          quarantine_path: string | null;
          storage_bucket: string | null;
          storage_path: string | null;
        }>
      >`
        select version.document_id, version.id as document_version_id,
          private_file.id as private_file_id, private_file.sha256, private_file.size_bytes,
          private_file.status as file_status, private_file.quarantine_bucket,
          private_file.quarantine_path, private_file.storage_bucket, private_file.storage_path
        from public.document_versions version
        join public.private_files private_file on private_file.id = version.private_file_id
        where version.organization_id = ${input.organizationId}::uuid
          and version.document_id in ${sql(documentIds)}
        order by version.document_id, version.version_number
      `
    : [];

  if (objects.length === 0) pushBlocker(blockers, "missing-document");
  if (objects.some((object) => object.file_status !== "available")) {
    pushBlocker(blockers, "file-unavailable");
  }

  return {
    targetType: input.targetType,
    targetId: target.id,
    targetReference: target.internal_reference,
    targetTitle: target.title,
    targetStatus: target.status,
    targetOwnerMembershipId: target.owner_id,
    targetCreatedByMembershipId: target.creator_id,
    documentIds,
    objects: objects.map((object) => ({
      documentId: object.document_id,
      documentVersionId: object.document_version_id,
      privateFileId: object.private_file_id,
      sha256: object.sha256,
      sizeBytes: Number(object.size_bytes),
      fileStatus: object.file_status,
      quarantineBucket: object.quarantine_bucket,
      quarantinePath: object.quarantine_path,
      storageBucket: object.storage_bucket,
      storagePath: object.storage_path,
    })),
    blockers,
    blockerMessages: blockers.map((blocker) => legalDeletionBlockerLabels[blocker]),
  };
}

export async function getLegalDeletionWorkspaceData(): Promise<LegalDeletionWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(legalPermissionKeys.workspace) ||
    !context.permissions.has(legalDeletionPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  try {
    const [policyRows, contractCandidates, complianceCandidates, requestRows] = await Promise.all([
      database<Array<{ second_approval_required: boolean; updated_at: Date }>>`
        select second_approval_required, updated_at
        from public.legal_deletion_policies
        where organization_id = ${organizationId}::uuid
      `,
      database<
        Array<{
          id: string;
          internal_reference: string;
          title: string;
          status: string;
          owner_name: string;
        }>
      >`
        select contract.id, contract.internal_reference, contract.title, contract.status,
          coalesce(profile.display_name, account.email) as owner_name
        from public.legal_contracts contract
        join public.memberships owner on owner.id = contract.responsible_owner_membership_id
        join public.identity_accounts account on account.id = owner.user_id
        left join public.profiles profile on profile.id = owner.user_id
        where contract.organization_id = ${organizationId}::uuid
          and contract.deleted_at is null
          and contract.status in ('terminated', 'expired', 'cancelled')
          and private.legal_contract_membership_access_allowed(
            contract.id, ${membershipId}::uuid, ${legalDeletionPermissionKeys.request}
          )
        order by contract.updated_at desc
      `,
      database<
        Array<{
          id: string;
          internal_reference: string;
          title: string;
          status: string;
          owner_name: string;
        }>
      >`
        select record.id, record.internal_reference, record.title, record.status,
          coalesce(profile.display_name, account.email) as owner_name
        from public.legal_compliance_records record
        join public.memberships owner on owner.id = record.responsible_owner_membership_id
        join public.identity_accounts account on account.id = owner.user_id
        left join public.profiles profile on profile.id = owner.user_id
        where record.organization_id = ${organizationId}::uuid
          and record.deleted_at is null
          and record.status in ('closed', 'archived')
          and private.legal_compliance_record_membership_access_allowed(
            record.id, ${membershipId}::uuid, ${legalDeletionPermissionKeys.request}
          )
        order by record.updated_at desc
      `,
      database<
        Array<{
          id: string;
          target_type: LegalDeletionTargetType;
          target_reference: string;
          target_title: string;
          target_status: string;
          reason: string;
          status: LegalDeletionStatus;
          second_approval_required: boolean;
          approval_request_id: string | null;
          object_count: number;
          requester_name: string;
          requested_at: Date;
          approved_at: Date | null;
          purge_claimed_at: Date | null;
          completed_at: Date | null;
          completed_by_name: string | null;
          can_execute: boolean;
        }>
      >`
        select request.id, request.target_type, request.target_reference,
          request.target_title, request.target_status, request.reason, request.status,
          request.second_approval_required, request.approval_request_id, request.object_count,
          coalesce(requester_profile.display_name, requester_account.email) as requester_name,
          request.requested_at, request.approved_at, request.purge_claimed_at,
          request.completed_at,
          coalesce(completer_profile.display_name, completer_account.email) as completed_by_name,
          private.legal_deletion_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${legalDeletionPermissionKeys.execute}
          ) as can_execute
        from public.legal_deletion_requests request
        join public.memberships requester on requester.id = request.requested_by_membership_id
        join public.identity_accounts requester_account on requester_account.id = requester.user_id
        left join public.profiles requester_profile on requester_profile.id = requester.user_id
        left join public.memberships completer on completer.id = request.completed_by_membership_id
        left join public.identity_accounts completer_account on completer_account.id = completer.user_id
        left join public.profiles completer_profile on completer_profile.id = completer.user_id
        where request.organization_id = ${organizationId}::uuid
          and private.legal_deletion_request_membership_access_allowed(
            request.id, ${membershipId}::uuid, ${legalDeletionPermissionKeys.view}
          )
        order by request.requested_at desc, request.id desc
        limit 100
      `,
    ]);

    const candidates: LegalDeletionCandidateSummary[] = [
      ...contractCandidates.map((candidate) => ({
        targetType: "contract" as const,
        targetId: candidate.id,
        reference: candidate.internal_reference,
        title: candidate.title,
        status: candidate.status,
        ownerName: candidate.owner_name,
      })),
      ...complianceCandidates.map((candidate) => ({
        targetType: "compliance_record" as const,
        targetId: candidate.id,
        reference: candidate.internal_reference,
        title: candidate.title,
        status: candidate.status,
        ownerName: candidate.owner_name,
      })),
    ];

    return {
      allowed: true,
      data: {
        policy: {
          secondApprovalRequired: policyRows[0]?.second_approval_required ?? true,
          updatedAt: policyRows[0]?.updated_at.toISOString() ?? null,
        },
        candidates,
        requests: requestRows.map((request) => ({
          id: request.id,
          targetType: request.target_type,
          targetTypeLabel: legalDeletionTargetTypeLabels[request.target_type],
          targetReference: request.target_reference,
          targetTitle: request.target_title,
          targetStatus: request.target_status,
          reason: request.reason,
          status: request.status,
          statusLabel: legalDeletionStatusLabels[request.status],
          secondApprovalRequired: request.second_approval_required,
          approvalRequestId: request.approval_request_id,
          objectCount: request.object_count,
          requestedByName: request.requester_name,
          requestedAt: request.requested_at.toISOString(),
          approvedAt: request.approved_at?.toISOString() ?? null,
          completedAt: request.completed_at?.toISOString() ?? null,
          completedByName: request.completed_by_name,
          canExecute:
            request.can_execute &&
            (["approved", "purge_failed"].includes(request.status) ||
              (request.status === "purging" &&
                legalDeletionPurgeClaimStale(request.purge_claimed_at))),
        })),
        capabilities: {
          canRequest: context.permissions.has(legalDeletionPermissionKeys.request),
          canExecute: context.permissions.has(legalDeletionPermissionKeys.execute),
          canConfigure: context.permissions.has(legalDeletionPermissionKeys.configure),
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
