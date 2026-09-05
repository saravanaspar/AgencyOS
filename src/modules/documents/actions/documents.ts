"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { documentPermissionKeys } from "@/modules/documents/documents";
import {
  documentAccessGrantSchema,
  documentAccessRevokeSchema,
  documentArchiveSchema,
  documentCategorySchema,
  documentCommentSchema,
  documentEntityLinkSchema,
  documentEntityUnlinkSchema,
  documentFolderSchema,
  documentIdSchema,
  documentLegalHoldSchema,
  documentMetadataSchema,
  documentStarterStructureSchema,
  documentTagSchema,
  type DocumentActionState,
} from "@/modules/documents/schemas/documents";
import {
  DocumentAccessError,
  recordDocumentEvent,
  requireDocumentAccess,
  requireDocumentEntityAccess,
  requireDocumentMembershipScope,
} from "@/modules/documents/server/documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const success = (message: string): DocumentActionState => ({ status: "success", message });
const failure = (message: string, fieldErrors?: Record<string, string[]>): DocumentActionState => ({
  status: "error",
  message,
  fieldErrors,
});
const text = (formData: FormData, key: string) => formData.get(key);
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );
const isFolderHierarchyViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23514",
  );

function refreshDocuments() {
  revalidatePath("/documents");
}

export async function saveDocumentFolderAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentFolderSchema.safeParse({
    folderId: text(formData, "folderId"),
    parentFolderId: text(formData, "parentFolderId"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    classification: text(formData, "classification"),
  });
  if (!parsed.success)
    return failure("Check the folder fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.folderManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage document folders.");
  const context = authorization.context;
  try {
    const folderId = parsed.data.folderId;
    await getDatabaseClient().begin(async (sql) => {
      if (folderId) {
        const rows = await sql<Array<{ name: string }>>`
          update public.document_folders
          set parent_folder_id = ${parsed.data.parentFolderId}::uuid,
              name = ${parsed.data.name}, description = ${parsed.data.description},
              classification = ${parsed.data.classification}
          where id = ${folderId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
          returning name
        `;
        if (!rows[0]) throw new Error("folder-not-found");
        await writeAuditEvent(sql, context, {
          action: "document.folder.updated",
          entityType: "document_folder",
          entityId: folderId,
          afterState: parsed.data,
        });
      } else {
        const rows = await sql<Array<{ id: string }>>`
          insert into public.document_folders (
            organization_id, parent_folder_id, name, description, classification,
            created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${parsed.data.parentFolderId}::uuid,
            ${parsed.data.name}, ${parsed.data.description}, ${parsed.data.classification},
            ${context.membership.id}::uuid
          ) returning id
        `;
        await writeAuditEvent(sql, context, {
          action: "document.folder.created",
          entityType: "document_folder",
          entityId: rows[0]?.id,
          afterState: parsed.data,
        });
      }
    });
    refreshDocuments();
    return success(folderId ? "Folder updated." : "Folder created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A folder with this name already exists here."
        : isFolderHierarchyViolation(error)
          ? "Choose a valid parent folder outside this folder's descendants."
          : "Folder could not be saved.",
    );
  }
}

export async function createDocumentStarterStructureAction(
  _previous: DocumentActionState,
  _formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentStarterStructureSchema.safeParse({
    intent: _formData.get("intent"),
  });
  if (!parsed.success) return failure("The starter-folder request is invalid.");
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.folderManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage document folders.");
  const context = authorization.context;
  const today = new Date();
  const startYear = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const fiscalYear = `FY ${startYear}-${String(startYear + 1).slice(-2)}`;
  const definitions = [
    { key: "legal", parent: null, name: "Legal", classification: "confidential" },
    { key: "legal_fy", parent: "legal", name: fiscalYear, classification: "confidential" },
    {
      key: "board_meetings",
      parent: "legal_fy",
      name: "Board meetings",
      classification: "confidential",
    },
    { key: "contracts", parent: "legal_fy", name: "Contracts", classification: "confidential" },
    { key: "finance", parent: null, name: "Finance & Tax", classification: "confidential" },
    { key: "finance_fy", parent: "finance", name: fiscalYear, classification: "confidential" },
    { key: "itr", parent: "finance_fy", name: "ITR", classification: "confidential" },
    { key: "gst", parent: "finance_fy", name: "GST", classification: "confidential" },
    { key: "accounts", parent: "finance_fy", name: "Accounts", classification: "confidential" },
    { key: "corporate", parent: null, name: "Corporate", classification: "confidential" },
    {
      key: "registrations",
      parent: "corporate",
      name: "Registrations",
      classification: "confidential",
    },
    {
      key: "resolutions",
      parent: "corporate",
      name: "Board resolutions",
      classification: "confidential",
    },
    { key: "insurance", parent: "corporate", name: "Insurance", classification: "confidential" },
    { key: "hr", parent: null, name: "HR", classification: "restricted" },
    {
      key: "employee_records",
      parent: "hr",
      name: "Employee records",
      classification: "restricted",
    },
    { key: "vendors", parent: null, name: "Vendors", classification: "internal" },
    {
      key: "vendor_bills",
      parent: "vendors",
      name: "Bills & supporting documents",
      classification: "confidential",
    },
    { key: "projects", parent: null, name: "Projects", classification: "internal" },
    {
      key: "project_records",
      parent: "projects",
      name: "Project records",
      classification: "internal",
    },
  ] as const;

  try {
    let createdCount = 0;
    await getDatabaseClient().begin(async (sql) => {
      const folderIds = new Map<string, string>();
      for (const definition of definitions) {
        const parentId = definition.parent ? folderIds.get(definition.parent) : null;
        const existing = await sql<Array<{ id: string }>>`
          select id from public.document_folders
          where organization_id = ${context.membership.organizationId}::uuid
            and parent_folder_id is not distinct from ${parentId ?? null}::uuid
            and lower(btrim(name)) = lower(${definition.name})
            and archived_at is null
          limit 1
        `;
        let folderId = existing[0]?.id;
        if (!folderId) {
          const inserted = await sql<Array<{ id: string }>>`
            insert into public.document_folders (
              organization_id, parent_folder_id, name, description, classification,
              created_by_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${parentId ?? null}::uuid,
              ${definition.name}, ${`Suggested AgencyOS filing structure: ${definition.name}.`},
              ${definition.classification}, ${context.membership.id}::uuid
            ) returning id
          `;
          folderId = inserted[0]?.id;
          createdCount += 1;
        }
        if (!folderId) throw new Error("folder-create-failed");
        folderIds.set(definition.key, folderId);
      }
      await writeAuditEvent(sql, context, {
        action: "document.folder_structure.created",
        entityType: "document_folder",
        afterState: { fiscalYear, createdCount, template: "agency_operations" },
      });
    });
    refreshDocuments();
    return success(
      createdCount
        ? `Created ${createdCount} folders for ${fiscalYear}.`
        : `The suggested ${fiscalYear} folder structure already exists.`,
    );
  } catch {
    return failure("The suggested folder structure could not be created.");
  }
}

export async function archiveDocumentFolderAction(formData: FormData): Promise<void> {
  const parsed = documentIdSchema.safeParse(text(formData, "folderId"));
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.folderManage,
  ]);
  if (!parsed.success || !authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<Array<{ id: string }>>`
      update public.document_folders
      set archived_at = case when archived_at is null then now() else null end
      where id = ${parsed.data}::uuid and organization_id = ${context.membership.organizationId}::uuid
      returning id
    `;
    if (rows[0])
      await writeAuditEvent(sql, context, {
        action: "document.folder.archive_toggled",
        entityType: "document_folder",
        entityId: parsed.data,
      });
  });
  refreshDocuments();
}

export async function saveDocumentCategoryAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentCategorySchema.safeParse({
    categoryId: text(formData, "categoryId"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    status: text(formData, "status"),
  });
  if (!parsed.success)
    return failure("Check the category fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.taxonomyManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage document categories.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.categoryId) {
        await sql`
          update public.document_categories set name = ${parsed.data.name},
            description = ${parsed.data.description}, status = ${parsed.data.status}
          where id = ${parsed.data.categoryId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
        `;
        await writeAuditEvent(sql, context, {
          action: "document.category.updated",
          entityType: "document_category",
          entityId: parsed.data.categoryId,
          afterState: parsed.data,
        });
      } else {
        const rows = await sql<Array<{ id: string }>>`
          insert into public.document_categories (
            organization_id, name, description, status, created_by_membership_id
          ) values (
            ${context.membership.organizationId}::uuid, ${parsed.data.name},
            ${parsed.data.description}, ${parsed.data.status}, ${context.membership.id}::uuid
          ) returning id
        `;
        await writeAuditEvent(sql, context, {
          action: "document.category.created",
          entityType: "document_category",
          entityId: rows[0]?.id,
          afterState: parsed.data,
        });
      }
    });
    refreshDocuments();
    return success(parsed.data.categoryId ? "Category updated." : "Category created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error)
        ? "A category with this name already exists."
        : "Category could not be saved.",
    );
  }
}

export async function createDocumentTagAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentTagSchema.safeParse({ name: text(formData, "name") });
  if (!parsed.success) return failure("Enter a tag name.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.taxonomyManage,
  ]);
  if (!authorization.allowed) return failure("You cannot manage document tags.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        insert into public.document_tags (organization_id, name, created_by_membership_id)
        values (${context.membership.organizationId}::uuid, ${parsed.data.name}, ${context.membership.id}::uuid)
        returning id
      `;
      await writeAuditEvent(sql, context, {
        action: "document.tag.created",
        entityType: "document_tag",
        entityId: rows[0]?.id,
        afterState: { name: parsed.data.name },
      });
    });
    refreshDocuments();
    return success("Tag created.");
  } catch (error) {
    return failure(
      isUniqueViolation(error) ? "That tag already exists." : "Tag could not be created.",
    );
  }
}

export async function updateDocumentMetadataAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const documentId = documentIdSchema.safeParse(text(formData, "documentId"));
  const parsed = documentMetadataSchema.safeParse({
    title: text(formData, "title"),
    description: text(formData, "description"),
    documentDate: text(formData, "documentDate"),
    referenceCode: text(formData, "referenceCode"),
    folderId: text(formData, "folderId"),
    categoryId: text(formData, "categoryId"),
    classification: text(formData, "classification"),
    ownerMembershipId: text(formData, "ownerMembershipId"),
    expiryDate: text(formData, "expiryDate"),
    reviewDate: text(formData, "reviewDate"),
    retentionUntil: text(formData, "retentionUntil"),
    tagIds: formData.getAll("tagIds"),
    entityType: null,
    entityId: null,
  });
  if (!documentId.success || !parsed.success) {
    return failure(
      "Check the document metadata.",
      parsed.success ? undefined : parsed.error.flatten().fieldErrors,
    );
  }
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.update,
  ]);
  if (!authorization.allowed) return failure("You cannot update documents.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, documentId.data, "edit", sql);
      const currentRows = await sql<Array<{ owner_membership_id: string; classification: string }>>`
        select owner_membership_id, classification from public.documents
        where id = ${documentId.data}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const current = currentRows[0];
      if (!current) throw new DocumentAccessError("Document was not found.");
      const sensitiveControlChanged =
        current.owner_membership_id !== parsed.data.ownerMembershipId ||
        current.classification !== parsed.data.classification;
      if (sensitiveControlChanged) {
        await requireDocumentAccess(context, documentId.data, "manage_access", sql);
        await requireDocumentMembershipScope(
          context,
          documentPermissionKeys.manageAccess,
          parsed.data.ownerMembershipId,
          sql,
        );
      }
      const rows = await sql<Array<{ title: string }>>`
        update public.documents set
          title = ${parsed.data.title}, description = ${parsed.data.description},
          document_date = ${parsed.data.documentDate}::date,
          reference_code = ${parsed.data.referenceCode},
          folder_id = ${parsed.data.folderId}::uuid, category_id = ${parsed.data.categoryId}::uuid,
          classification = ${parsed.data.classification},
          owner_membership_id = ${parsed.data.ownerMembershipId}::uuid,
          expiry_date = ${parsed.data.expiryDate}::date, review_date = ${parsed.data.reviewDate}::date,
          retention_until = ${parsed.data.retentionUntil}::date
        where id = ${documentId.data}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning title
      `;
      if (!rows[0]) throw new DocumentAccessError("Document was not found.");
      await sql`delete from public.document_tag_links where document_id = ${documentId.data}::uuid`;
      if (parsed.data.tagIds.length > 0) {
        await sql`
          insert into public.document_tag_links (
            document_id, tag_id, organization_id, created_by_membership_id
          )
          select ${documentId.data}::uuid, tag_id, ${context.membership.organizationId}::uuid,
            ${context.membership.id}::uuid
          from unnest(${parsed.data.tagIds}::uuid[]) as tag_id
          on conflict do nothing
        `;
      }
      await recordDocumentEvent(sql, context, {
        documentId: documentId.data,
        eventType: "document.metadata_updated",
        details: {
          fields: [
            "title",
            "description",
            "documentDate",
            "referenceCode",
            "folder",
            "category",
            "classification",
            "owner",
            "dates",
            "tags",
          ],
        },
      });
      await writeAuditEvent(sql, context, {
        action: "document.updated",
        entityType: "document",
        entityId: documentId.data,
        afterState: { ...parsed.data, tagIds: parsed.data.tagIds },
      });
    });
    refreshDocuments();
    return success("Document metadata updated.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Document could not be updated.",
    );
  }
}

export async function addDocumentCommentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentCommentSchema.safeParse({
    documentId: text(formData, "documentId"),
    body: text(formData, "body"),
  });
  if (!parsed.success) return failure("Enter a comment.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.comment,
  ]);
  if (!authorization.allowed) return failure("You cannot comment on documents.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "comment", sql);
      const rows = await sql<Array<{ id: string }>>`
        insert into public.document_comments (
          organization_id, document_id, body, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          ${parsed.data.body}, ${context.membership.id}::uuid
        ) returning id
      `;
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        eventType: "document.commented",
        details: { commentId: rows[0]?.id },
      });
      await writeAuditEvent(sql, context, {
        action: "document.comment.created",
        entityType: "document",
        entityId: parsed.data.documentId,
        metadata: { commentId: rows[0]?.id },
      });
    });
    refreshDocuments();
    return success("Comment added.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Comment could not be added.",
    );
  }
}

export async function saveDocumentAccessGrantAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentAccessGrantSchema.safeParse({
    documentId: text(formData, "documentId"),
    membershipId: text(formData, "membershipId"),
    accessLevel: text(formData, "accessLevel"),
    expiresAt: text(formData, "expiresAt"),
  });
  if (!parsed.success)
    return failure("Check the access grant.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.manageAccess,
  ]);
  if (!authorization.allowed) return failure("You cannot manage document access.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "manage_access", sql);
      await sql`
        insert into public.document_access_grants (
          organization_id, document_id, membership_id, access_level,
          granted_by_membership_id, expires_at
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          ${parsed.data.membershipId}::uuid, ${parsed.data.accessLevel},
          ${context.membership.id}::uuid, ${parsed.data.expiresAt}::timestamptz
        ) on conflict (document_id, membership_id) do update set
          access_level = excluded.access_level, granted_by_membership_id = excluded.granted_by_membership_id,
          expires_at = excluded.expires_at
      `;
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        eventType: "document.access_granted",
        details: {
          membershipId: parsed.data.membershipId,
          accessLevel: parsed.data.accessLevel,
          expiresAt: parsed.data.expiresAt,
        },
      });
      await writeAuditEvent(sql, context, {
        action: "document.access.granted",
        entityType: "document",
        entityId: parsed.data.documentId,
        metadata: { membershipId: parsed.data.membershipId, accessLevel: parsed.data.accessLevel },
      });
    });
    refreshDocuments();
    return success("Document access updated.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Access could not be updated.",
    );
  }
}

export async function revokeDocumentAccessAction(formData: FormData): Promise<void> {
  const parsed = documentAccessRevokeSchema.safeParse({
    documentId: text(formData, "documentId"),
    membershipId: text(formData, "membershipId"),
  });
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.manageAccess,
  ]);
  if (!parsed.success || !authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    await requireDocumentAccess(context, parsed.data.documentId, "manage_access", sql);
    await sql`
      delete from public.document_access_grants
      where document_id = ${parsed.data.documentId}::uuid
        and membership_id = ${parsed.data.membershipId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
    `;
    await recordDocumentEvent(sql, context, {
      documentId: parsed.data.documentId,
      eventType: "document.access_revoked",
      details: { membershipId: parsed.data.membershipId },
    });
    await writeAuditEvent(sql, context, {
      action: "document.access.revoked",
      entityType: "document",
      entityId: parsed.data.documentId,
      metadata: { membershipId: parsed.data.membershipId },
    });
  });
  refreshDocuments();
}

export async function setDocumentLegalHoldAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentLegalHoldSchema.safeParse({
    documentId: text(formData, "documentId"),
    legalHold: text(formData, "legalHold"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success)
    return failure("Check the legal-hold details.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.legalHold,
  ]);
  if (!authorization.allowed) return failure("You cannot manage legal holds.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "legal_hold", sql);
      await sql`
        update public.documents set legal_hold = ${parsed.data.legalHold},
          legal_hold_reason = ${parsed.data.legalHold ? parsed.data.reason : null},
          legal_hold_applied_at = ${parsed.data.legalHold ? new Date() : null},
          legal_hold_applied_by_membership_id = ${parsed.data.legalHold ? context.membership.id : null}::uuid
        where id = ${parsed.data.documentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        eventType: parsed.data.legalHold
          ? "document.legal_hold_applied"
          : "document.legal_hold_released",
        details: parsed.data.legalHold ? { reason: parsed.data.reason } : {},
      });
      await writeAuditEvent(sql, context, {
        action: parsed.data.legalHold
          ? "document.legal_hold.applied"
          : "document.legal_hold.released",
        entityType: "document",
        entityId: parsed.data.documentId,
        metadata: parsed.data.legalHold ? { reason: parsed.data.reason } : {},
      });
    });
    refreshDocuments();
    return success(parsed.data.legalHold ? "Legal hold applied." : "Legal hold released.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Legal hold could not be changed.",
    );
  }
}

export async function archiveDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentArchiveSchema.safeParse({
    documentId: text(formData, "documentId"),
    archive: text(formData, "archive"),
  });
  if (!parsed.success) return failure("Document state was invalid.");
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.archive,
  ]);
  if (!authorization.allowed) return failure("You cannot archive documents.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "archive", sql);
      await sql`
        update public.documents set status = ${parsed.data.archive ? "archived" : "active"},
          archived_at = ${parsed.data.archive ? new Date() : null},
          archived_by_membership_id = ${parsed.data.archive ? context.membership.id : null}::uuid
        where id = ${parsed.data.documentId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
      `;
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        eventType: parsed.data.archive ? "document.archived" : "document.restored",
      });
      await writeAuditEvent(sql, context, {
        action: parsed.data.archive ? "document.archived" : "document.restored",
        entityType: "document",
        entityId: parsed.data.documentId,
      });
    });
    refreshDocuments();
    return success(parsed.data.archive ? "Document archived." : "Document restored.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Document state could not be changed.",
    );
  }
}

export async function addDocumentEntityLinkAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = documentEntityLinkSchema.safeParse({
    documentId: text(formData, "documentId"),
    entityType: text(formData, "entityType"),
    entityId: text(formData, "entityId"),
  });
  if (!parsed.success)
    return failure("Choose a related record.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.update,
  ]);
  if (!authorization.allowed) return failure("You cannot link documents.");
  const context = authorization.context;
  try {
    await getDatabaseClient().begin(async (sql) => {
      await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
      await requireDocumentEntityAccess(context, parsed.data.entityType, parsed.data.entityId, sql);
      await sql`
        insert into public.document_entity_links (
          organization_id, document_id, entity_type, entity_id, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.documentId}::uuid,
          ${parsed.data.entityType}, ${parsed.data.entityId}::uuid, ${context.membership.id}::uuid
        ) on conflict do nothing
      `;
      await recordDocumentEvent(sql, context, {
        documentId: parsed.data.documentId,
        eventType: "document.entity_linked",
        details: { entityType: parsed.data.entityType, entityId: parsed.data.entityId },
      });
    });
    refreshDocuments();
    return success("Related record linked.");
  } catch (error) {
    return failure(
      error instanceof DocumentAccessError ? error.message : "Related record could not be linked.",
    );
  }
}

export async function removeDocumentEntityLinkAction(formData: FormData): Promise<void> {
  const parsed = documentEntityUnlinkSchema.safeParse({
    linkId: text(formData, "linkId"),
    documentId: text(formData, "documentId"),
  });
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.update,
  ]);
  if (!parsed.success || !authorization.allowed) return;
  const context = authorization.context;
  await getDatabaseClient().begin(async (sql) => {
    await requireDocumentAccess(context, parsed.data.documentId, "edit", sql);
    await sql`
      delete from public.document_entity_links where id = ${parsed.data.linkId}::uuid
        and document_id = ${parsed.data.documentId}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
    `;
    await recordDocumentEvent(sql, context, {
      documentId: parsed.data.documentId,
      eventType: "document.entity_unlinked",
      details: { linkId: parsed.data.linkId },
    });
  });
  refreshDocuments();
}
