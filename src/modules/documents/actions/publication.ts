"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  createApprovalDefinition,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { documentPermissionKeys } from "@/modules/documents/documents";
import {
  documentPublicationSchema,
  documentPublicationWithdrawSchema,
  documentReviewSubmitSchema,
  type DocumentActionState,
} from "@/modules/documents/schemas/documents";
import {
  DocumentAccessError,
  recordDocumentEvent,
  requireDocumentAccess,
} from "@/modules/documents/server/documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const success = (message: string): DocumentActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): DocumentActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/documents");

async function ensureDocumentApprovalPolicy(context: CurrentPermissionContext): Promise<string> {
  const database = getDatabaseClient();
  const existing = await database<Array<{ id: string }>>`
    select id from public.approval_definitions
    where organization_id = ${context.membership.organizationId}::uuid
      and key = 'document_review_default'
      and source_module = 'documents' and entity_type = 'document_review'
      and status = 'active'
    limit 1
  `;
  if (existing[0]) return existing[0].id;

  try {
    return await createApprovalDefinition(context, {
      key: "document_review_default",
      name: "Document publication review",
      description:
        "Default Owner review for controlled document publication. Customize this policy in Approvals when separation of duties is required.",
      sourceModule: "documents",
      entityType: "document_review",
      allowSelfApproval: true,
      allowReassignment: true,
      steps: [
        {
          name: "Document review",
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
          expiresAfterHours: null,
        },
      ],
    });
  } catch (error) {
    const raced = await database<Array<{ id: string }>>`
      select id from public.approval_definitions
      where organization_id = ${context.membership.organizationId}::uuid
        and key = 'document_review_default'
        and source_module = 'documents' and entity_type = 'document_review'
        and status = 'active'
      limit 1
    `;
    if (!raced[0]) throw error;
    return raced[0].id;
  }
}

interface ReviewCandidate {
  id: string;
  title: string;
  current_version_id: string;
  version_number: number;
  sha256: string;
}

async function getReviewCandidate(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  documentId: string,
  lock = false,
): Promise<ReviewCandidate | null> {
  const rows = await sql<ReviewCandidate[]>`
    select document.id, document.title, document.current_version_id,
      version.version_number, file.sha256
    from public.documents as document
    join public.document_versions as version on version.id = document.current_version_id
    join public.private_files as file on file.id = version.private_file_id
    where document.id = ${documentId}::uuid
      and document.organization_id = ${context.membership.organizationId}::uuid
      and document.status = 'active' and file.status = 'available'
    ${lock ? sql`for update of document` : sql``}
  `;
  return rows[0] ?? null;
}

export async function submitDocumentReviewAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentReviewSubmitSchema.safeParse({
    documentId: value(formData, "documentId"),
  });
  if (!parsed.success) return failure("Document review could not be started.");
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.submitApproval,
  ]);
  if (!authorization.allowed) return failure("You cannot submit documents for approval.");
  const context = authorization.context;

  try {
    const database = getDatabaseClient();
    const candidate = await database.begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "submit_approval", sql);
      return getReviewCandidate(sql, context, parsed.data.documentId);
    });
    if (!candidate) return failure("Upload a clean document version before requesting review.");

    await ensureDocumentApprovalPolicy(context);
    const reviewId = randomUUID();
    await submitApprovalForRecordAtomically(
      context,
      {
        definitionKey: "document_review_default",
        sourceModule: "documents",
        entityType: "document_review",
        title: `Document review: ${candidate.title}`,
        entityId: reviewId,
        deepLink: "/documents",
        departmentId: null,
        amount: null,
        currency: null,
        snapshot: {
          documentId: candidate.id,
          title: candidate.title,
          versionId: candidate.current_version_id,
          versionNumber: candidate.version_number,
          sha256: candidate.sha256,
        },
        dueAt: null,
      },
      async (sql, requestId) => {
        await requireDocumentAccess(context, parsed.data.documentId, "submit_approval", sql);
        const locked = await getReviewCandidate(sql, context, parsed.data.documentId, true);
        if (!locked || locked.current_version_id !== candidate.current_version_id) {
          throw new Error("document-version-changed");
        }
        await sql`
          insert into public.document_review_requests (
            id, organization_id, document_id, version_id, approval_request_id,
            submitted_by_membership_id
          ) values (
            ${reviewId}::uuid, ${context.membership.organizationId}::uuid,
            ${candidate.id}::uuid, ${candidate.current_version_id}::uuid,
            ${requestId}::uuid, ${context.membership.id}::uuid
          )
        `;
        await recordDocumentEvent(sql, context, {
          documentId: candidate.id,
          versionId: candidate.current_version_id,
          eventType: "document.review_submitted",
          details: { reviewRequestId: reviewId, approvalRequestId: requestId },
        });
        await writeAuditEvent(sql, context, {
          action: "document.review.submitted",
          entityType: "document",
          entityId: candidate.id,
          metadata: {
            reviewRequestId: reviewId,
            approvalRequestId: requestId,
            versionNumber: candidate.version_number,
          },
        });
      },
    );
    refresh();
    return success("Document version submitted for approval.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError
        ? error.message
        : error instanceof Error && error.message === "document-version-changed"
          ? "The current version changed. Review the latest version and submit again."
          : error &&
              typeof error === "object" &&
              "code" in error &&
              Reflect.get(error, "code") === "23505"
            ? "This document already has a pending review."
            : "Document review could not be started.",
    );
  }
}

async function validateAudienceTargets(
  sql: TransactionSql,
  organizationId: string,
  input: {
    departmentIds: string[];
    teamIds: string[];
    membershipIds: string[];
  },
): Promise<void> {
  const departments = input.departmentIds.length
    ? await sql<Array<{ count: number }>>`
        select count(*)::int as count from public.departments
        where organization_id = ${organizationId}::uuid
          and status = 'active' and id = any(${input.departmentIds}::uuid[])
      `
    : [{ count: 0 }];
  const teams = input.teamIds.length
    ? await sql<Array<{ count: number }>>`
        select count(*)::int as count from public.teams
        where organization_id = ${organizationId}::uuid
          and status = 'active' and id = any(${input.teamIds}::uuid[])
      `
    : [{ count: 0 }];
  const memberships = input.membershipIds.length
    ? await sql<Array<{ count: number }>>`
        select count(*)::int as count from public.memberships
        where organization_id = ${organizationId}::uuid
          and status = 'active' and id = any(${input.membershipIds}::uuid[])
      `
    : [{ count: 0 }];
  if (
    departments[0]?.count !== new Set(input.departmentIds).size ||
    teams[0]?.count !== new Set(input.teamIds).size ||
    memberships[0]?.count !== new Set(input.membershipIds).size
  ) {
    throw new Error("publication-audience-invalid");
  }
}

export async function publishDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentPublicationSchema.safeParse({
    documentId: value(formData, "documentId"),
    effectiveAt: value(formData, "effectiveAt"),
    expiresAt: value(formData, "expiresAt"),
    releaseNote: value(formData, "releaseNote"),
    organizationWide: value(formData, "organizationWide"),
    departmentIds: formData.getAll("departmentIds"),
    teamIds: formData.getAll("teamIds"),
    membershipIds: formData.getAll("membershipIds"),
  });
  if (!parsed.success) {
    return failure("Check the publication settings.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.publish,
  ]);
  if (!authorization.allowed) return failure("You cannot publish documents.");
  const context = authorization.context;

  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "publish", sql);
      await sql`select pg_advisory_xact_lock(hashtextextended(${"document-publication:" + parsed.data.documentId}, 0))`;
      const documents = await sql<
        Array<{ id: string; title: string; current_version_id: string | null; status: string }>
      >`
        select id, title, current_version_id, status from public.documents
        where id = ${parsed.data.documentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const document = documents[0];
      if (!document || document.status !== "active" || !document.current_version_id) {
        throw new Error("publication-document-invalid");
      }
      const approved = await sql<Array<{ id: string; version_number: number }>>`
        select review.id, version.version_number
        from public.document_review_requests as review
        join public.document_versions as version on version.id = review.version_id
        join public.private_files as file on file.id = version.private_file_id
        where review.document_id = ${document.id}::uuid
          and review.version_id = ${document.current_version_id}::uuid
          and review.status = 'approved' and file.status = 'available'
        order by review.completed_at desc limit 1
      `;
      if (!approved[0]) throw new Error("publication-version-not-approved");
      await validateAudienceTargets(sql, context.membership.organizationId, parsed.data);

      const previous = await sql<Array<{ id: string; publication_number: number }>>`
        select id, publication_number from public.document_publications
        where document_id = ${document.id}::uuid and status = 'active'
        for update
      `;
      const prior = previous[0] ?? null;
      const sequence = await sql<Array<{ publication_number: number }>>`
        select coalesce(max(publication_number), 0)::integer + 1 as publication_number
        from public.document_publications where document_id = ${document.id}::uuid
      `;
      if (prior) {
        await sql`
          update public.document_publications set status = 'superseded',
            superseded_at = now(), superseded_by_membership_id = ${context.membership.id}::uuid
          where id = ${prior.id}::uuid and status = 'active'
        `;
      }
      const publicationNumber = sequence[0]?.publication_number ?? 1;
      const rows = await sql<Array<{ id: string }>>`
        insert into public.document_publications (
          organization_id, document_id, version_id, publication_number,
          effective_at, expires_at, release_note, supersedes_publication_id,
          published_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${document.id}::uuid,
          ${document.current_version_id}::uuid, ${publicationNumber},
          ${parsed.data.effectiveAt}::timestamptz, ${parsed.data.expiresAt}::timestamptz,
          ${parsed.data.releaseNote}, ${prior?.id ?? null}::uuid,
          ${context.membership.id}::uuid
        ) returning id
      `;
      const publicationId = rows[0]?.id;
      if (!publicationId) throw new Error("publication-create-failed");
      if (prior) {
        await sql`
          update public.document_publications
          set superseded_by_publication_id = ${publicationId}::uuid
          where id = ${prior.id}::uuid and status = 'superseded'
        `;
      }
      if (parsed.data.organizationWide) {
        await sql`
          insert into public.document_publication_audiences (
            organization_id, publication_id, audience_type
          ) values (
            ${context.membership.organizationId}::uuid, ${publicationId}::uuid, 'organization'
          )
        `;
      }
      if (parsed.data.departmentIds.length) {
        await sql`
          insert into public.document_publication_audiences (
            organization_id, publication_id, audience_type, audience_id
          ) select ${context.membership.organizationId}::uuid, ${publicationId}::uuid,
            'department', audience_id
          from unnest(${[...new Set(parsed.data.departmentIds)]}::uuid[]) as audience_id
        `;
      }
      if (parsed.data.teamIds.length) {
        await sql`
          insert into public.document_publication_audiences (
            organization_id, publication_id, audience_type, audience_id
          ) select ${context.membership.organizationId}::uuid, ${publicationId}::uuid,
            'team', audience_id
          from unnest(${[...new Set(parsed.data.teamIds)]}::uuid[]) as audience_id
        `;
      }
      if (parsed.data.membershipIds.length) {
        await sql`
          insert into public.document_publication_audiences (
            organization_id, publication_id, audience_type, audience_id
          ) select ${context.membership.organizationId}::uuid, ${publicationId}::uuid,
            'membership', audience_id
          from unnest(${[...new Set(parsed.data.membershipIds)]}::uuid[]) as audience_id
        `;
      }
      if (prior) {
        await recordDocumentEvent(sql, context, {
          documentId: document.id,
          versionId: document.current_version_id,
          eventType: "document.publication_superseded",
          details: { publicationId: prior.id, supersededByPublicationId: publicationId },
        });
      }
      await recordDocumentEvent(sql, context, {
        documentId: document.id,
        versionId: document.current_version_id,
        eventType: "document.published",
        details: {
          publicationId,
          publicationNumber,
          effectiveAt: parsed.data.effectiveAt,
          expiresAt: parsed.data.expiresAt,
          audienceCounts: {
            organization: parsed.data.organizationWide ? 1 : 0,
            departments: parsed.data.departmentIds.length,
            teams: parsed.data.teamIds.length,
            memberships: parsed.data.membershipIds.length,
          },
        },
      });
      await writeAuditEvent(sql, context, {
        action: "document.published",
        entityType: "document",
        entityId: document.id,
        afterState: {
          publicationId,
          publicationNumber,
          versionNumber: approved[0].version_number,
          effectiveAt: parsed.data.effectiveAt,
          expiresAt: parsed.data.expiresAt,
        },
        changedFields: ["publication"],
      });
    });
    refresh();
    return success("Approved document version published.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError
        ? error.message
        : error instanceof Error && error.message === "publication-version-not-approved"
          ? "The current document version must be approved before publication."
          : error instanceof Error && error.message === "publication-audience-invalid"
            ? "One or more publication audiences are invalid or inactive."
            : "Document could not be published.",
    );
  }
}

export async function withdrawDocumentPublicationAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentPublicationWithdrawSchema.safeParse({
    documentId: value(formData, "documentId"),
    publicationId: value(formData, "publicationId"),
    reason: value(formData, "reason"),
  });
  if (!parsed.success) {
    return failure("Add a withdrawal reason.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.withdraw,
  ]);
  if (!authorization.allowed) return failure("You cannot withdraw publications.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "withdraw", sql);
      const rows = await sql<Array<{ version_id: string; publication_number: number }>>`
        update public.document_publications set status = 'withdrawn',
          withdrawn_at = now(), withdrawn_by_membership_id = ${context.membership.id}::uuid,
          withdrawal_reason = ${parsed.data.reason}
        where id = ${parsed.data.publicationId}::uuid
          and document_id = ${parsed.data.documentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
        returning version_id, publication_number
      `;
      if (!rows[0]) throw new Error("publication-not-active");
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        versionId: rows[0].version_id,
        eventType: "document.publication_withdrawn",
        details: {
          publicationId: parsed.data.publicationId,
          publicationNumber: rows[0].publication_number,
          reason: parsed.data.reason,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "document.publication.withdrawn",
        entityType: "document",
        entityId: parsed.data.documentId,
        metadata: {
          publicationId: parsed.data.publicationId,
          publicationNumber: rows[0].publication_number,
          reason: parsed.data.reason,
        },
      });
    });
    refresh();
    return success("Document publication withdrawn.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError
        ? error.message
        : error instanceof Error && error.message === "publication-not-active"
          ? "This publication is no longer active."
          : "Publication could not be withdrawn.",
    );
  }
}
