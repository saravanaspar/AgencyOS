import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { validateMultipartContentLength } from "@/lib/server/multipart-content-length";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { documentPermissionKeys } from "@/modules/documents/documents";
import { documentUploadMetadataSchema } from "@/modules/documents/schemas/documents";
import {
  DocumentAccessError,
  recordDocumentEvent,
  requireDocumentAccess,
  requireDocumentEntityAccess,
  requireDocumentMembershipScope,
} from "@/modules/documents/server/documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  SHARED_PRIVATE_FILE_MAX_BYTES,
  type PrivateFilePolicy,
} from "@/modules/private-files/server/file-policy";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

const DOCUMENT_POLICY: PrivateFilePolicy = {
  maxBytes: SHARED_PRIVATE_FILE_MAX_BYTES,
  allowedMimeTypes: new Map([
    ["application/pdf", new Set([".pdf"])],
    ["image/jpeg", new Set([".jpg", ".jpeg"])],
    ["image/png", new Set([".png"])],
    ["text/plain", new Set([".txt"])],
    ["text/csv", new Set([".csv"])],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Set([".docx"])],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Set([".xlsx"])],
  ]),
  description: "Documents must be PDF, JPEG, PNG, TXT, CSV, DOCX, or XLSX files.",
};

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.create,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading documents."
        : "You cannot upload documents.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const boundedLength = validateMultipartContentLength(
    request,
    SHARED_PRIVATE_FILE_MAX_BYTES,
    2 * 1024 * 1024,
  );
  if (!boundedLength.ok && boundedLength.status === 411) {
    return jsonError("A bounded Content-Length header is required.", 411);
  }
  if (!boundedLength.ok) {
    return jsonError("Documents are limited to 25 MB.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("The upload form could not be read.");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("Choose a document file.");
  if (file.size > SHARED_PRIVATE_FILE_MAX_BYTES)
    return jsonError("Documents are limited to 25 MB.", 413);

  const entityTypeValue = formData.get("entityType");
  const parsed = documentUploadMetadataSchema.safeParse({
    documentId: formData.get("documentId"),
    title: formData.get("title"),
    description: formData.get("description"),
    documentDate: formData.get("documentDate"),
    referenceCode: formData.get("referenceCode"),
    folderId: formData.get("folderId"),
    categoryId: formData.get("categoryId"),
    classification: formData.get("classification"),
    ownerMembershipId: formData.get("ownerMembershipId"),
    expiryDate: formData.get("expiryDate"),
    reviewDate: formData.get("reviewDate"),
    retentionUntil: formData.get("retentionUntil"),
    versionNote: formData.get("versionNote"),
    tagIds: formData.getAll("tagIds"),
    entityType: typeof entityTypeValue === "string" && entityTypeValue ? entityTypeValue : null,
    entityId: formData.get("entityId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Check the document details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const context = authorization.context;
  const createScope = context.permissionScopes.get(documentPermissionKeys.create) ?? "own";
  const documentId = parsed.data.documentId ?? randomUUID();
  let effectiveTitle = parsed.data.title;
  let effectiveClassification = parsed.data.classification;

  try {
    if (parsed.data.documentId) {
      if (!context.permissions.has(documentPermissionKeys.update)) {
        return jsonError("You cannot upload a new version of this document.", 403);
      }
      await requireDocumentAccess(context, documentId, "edit");
      const rows = await getDatabaseClient()<
        Array<{ title: string; classification: typeof effectiveClassification }>
      >`
        select title, classification from public.documents
        where id = ${documentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      if (!rows[0]) return jsonError("The document was not found.", 404);
      const pendingReview = await getDatabaseClient()<Array<{ exists: boolean }>>`
        select exists (
          select 1 from public.document_review_requests
          where document_id = ${documentId}::uuid and status = 'pending'
        ) as exists
      `;
      if (pendingReview[0]?.exists) {
        return jsonError("A new version cannot be uploaded while review is pending.", 409);
      }
      effectiveTitle = rows[0].title;
      effectiveClassification = rows[0].classification;
    } else {
      await requireDocumentMembershipScope(
        context,
        documentPermissionKeys.create,
        parsed.data.ownerMembershipId,
      );
      if (
        parsed.data.classification === "restricted" &&
        !context.permissions.has(documentPermissionKeys.manageAccess)
      ) {
        return jsonError("Restricted documents require access-management permission.", 403);
      }
      if (parsed.data.classification === "confidential" && createScope === "own") {
        return jsonError("Own-scope uploads must use Internal classification.", 403);
      }
      if (parsed.data.entityType && parsed.data.entityId) {
        await requireDocumentEntityAccess(context, parsed.data.entityType, parsed.data.entityId);
      }
    }
  } catch (error) {
    if (error instanceof DocumentAccessError) return jsonError(error.message, 403);
    return jsonError("The document details could not be authorized.", 403);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const result = await createQuarantinedPrivateFile({
      organizationId: context.membership.organizationId,
      uploadedByMembershipId: context.membership.id,
      moduleKey: "documents",
      entityType: "document",
      entityId: documentId,
      classification: effectiveClassification,
      file,
      buffer,
      policy: DOCUMENT_POLICY,
      accessRules: {
        viewPermission: documentPermissionKeys.view,
        downloadPermission: documentPermissionKeys.download,
        documentId,
      },
      metadata: {
        documentId,
        title: effectiveTitle,
        classification: effectiveClassification,
      },
      link: async (sql, privateFile) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`documents:${documentId}`}, 0))`;
        if (parsed.data.documentId) {
          await requireDocumentAccess(context, documentId, "edit", sql);
          const versions = await sql<Array<{ version_number: number }>>`
            select coalesce(max(version_number), 0)::integer + 1 as version_number
            from public.document_versions where document_id = ${documentId}::uuid
          `;
          const versionNumber = versions[0]?.version_number ?? 1;
          const inserted = await sql<Array<{ id: string }>>`
            insert into public.document_versions (
              organization_id, document_id, version_number, private_file_id,
              version_note, uploaded_by_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${documentId}::uuid, ${versionNumber},
              ${privateFile.id}::uuid, ${parsed.data.versionNote}, ${context.membership.id}::uuid
            ) returning id
          `;
          const versionId = inserted[0]?.id;
          await sql`
            update public.documents set current_version_id = ${versionId}::uuid
            where id = ${documentId}::uuid and organization_id = ${context.membership.organizationId}::uuid
          `;
          await recordDocumentEvent(sql, context, {
            documentId,
            versionId,
            eventType: "document.version_uploaded",
            details: { versionNumber, sha256: privateFile.sha256, fileName: privateFile.fileName },
          });
          await writeAuditEvent(sql, context, {
            action: "document.version.uploaded",
            entityType: "document",
            entityId: documentId,
            metadata: { versionId, versionNumber, sha256: privateFile.sha256 },
          });
          return;
        }

        const ownerRows = await sql<Array<{ id: string }>>`
          select id from public.memberships
          where id = ${parsed.data.ownerMembershipId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status = 'active'
        `;
        if (!ownerRows[0])
          throw new DocumentAccessError("Choose an active owner in this organization.");
        await sql`
          insert into public.documents (
            id, organization_id, folder_id, category_id, title, description, classification,
            owner_membership_id, created_by_membership_id, document_date, reference_code,
            expiry_date, review_date, retention_until
          ) values (
            ${documentId}::uuid, ${context.membership.organizationId}::uuid,
            ${parsed.data.folderId}::uuid, ${parsed.data.categoryId}::uuid,
            ${parsed.data.title}, ${parsed.data.description}, ${parsed.data.classification},
            ${parsed.data.ownerMembershipId}::uuid, ${context.membership.id}::uuid,
            ${parsed.data.documentDate}::date, ${parsed.data.referenceCode},
            ${parsed.data.expiryDate}::date, ${parsed.data.reviewDate}::date,
            ${parsed.data.retentionUntil}::date
          )
        `;
        const versions = await sql<Array<{ id: string }>>`
          insert into public.document_versions (
            organization_id, document_id, version_number, private_file_id,
            version_note, uploaded_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${documentId}::uuid, 1,
            ${privateFile.id}::uuid, ${parsed.data.versionNote}, ${context.membership.id}::uuid
          ) returning id
        `;
        const versionId = versions[0]?.id;
        await sql`update public.documents set current_version_id = ${versionId}::uuid where id = ${documentId}::uuid`;
        await sql`
          insert into public.document_access_grants (
            organization_id, document_id, membership_id, access_level, granted_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${documentId}::uuid,
            ${context.membership.id}::uuid, 'editor', ${context.membership.id}::uuid
          ) on conflict do nothing
        `;
        if (parsed.data.tagIds.length > 0) {
          await sql`
            insert into public.document_tag_links (
              document_id, tag_id, organization_id, created_by_membership_id
            )
            select ${documentId}::uuid, tag_id, ${context.membership.organizationId}::uuid,
              ${context.membership.id}::uuid
            from unnest(${parsed.data.tagIds}::uuid[]) as tag_id
            on conflict do nothing
          `;
        }
        if (parsed.data.entityType && parsed.data.entityId) {
          await sql`
            insert into public.document_entity_links (
              organization_id, document_id, entity_type, entity_id, created_by_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${documentId}::uuid,
              ${parsed.data.entityType}, ${parsed.data.entityId}::uuid, ${context.membership.id}::uuid
            )
          `;
        }
        await recordDocumentEvent(sql, context, {
          documentId,
          versionId,
          eventType: "document.created",
          details: { versionNumber: 1, sha256: privateFile.sha256, fileName: privateFile.fileName },
        });
        await writeAuditEvent(sql, context, {
          action: "document.created",
          entityType: "document",
          entityId: documentId,
          afterState: {
            title: parsed.data.title,
            classification: parsed.data.classification,
            ownerMembershipId: parsed.data.ownerMembershipId,
            documentDate: parsed.data.documentDate,
            referenceCode: parsed.data.referenceCode,
            folderId: parsed.data.folderId,
            categoryId: parsed.data.categoryId,
          },
          metadata: { versionId, sha256: privateFile.sha256 },
        });
      },
    });
    if (!result.created)
      return jsonError("This exact file is already attached to the document.", 409);
    return NextResponse.json(
      {
        ok: true,
        documentId,
        message: parsed.data.documentId
          ? "New version queued for scanning."
          : "Document queued for scanning.",
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DocumentAccessError) return jsonError(error.message, 403);
    return jsonError("The document could not be uploaded.", 500);
  }
}
