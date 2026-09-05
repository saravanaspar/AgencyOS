import "server-only";

import type { Sql, TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { assetPermissionKeys } from "@/modules/assets/assets";
import { crmPermissionKeys } from "@/modules/crm/crm";
import { toJsonValue } from "@/lib/server/json-value";
import {
  documentPermissionKeys,
  documentPublicationState,
  documentRetentionState,
  documentReviewState,
  type DocumentAccessLevel,
  type DocumentClassification,
  type DocumentEntityType,
  type DocumentPublicationAudienceType,
  type DocumentPublicationStatus,
  type DocumentReviewStatus,
  type DocumentStatus,
} from "@/modules/documents/documents";
import { financePermissionKeys } from "@/modules/finance/finance";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { supportPermissionKeys } from "@/modules/support/support";
import { vendorPermissionKeys } from "@/modules/vendors/vendors";
import {
  getDocumentEntityOptions,
  type DocumentEntityOption,
} from "@/modules/documents/server/document-entity-options";

export interface DocumentFolderSummary {
  id: string;
  parentFolderId: string | null;
  name: string;
  description: string | null;
  classification: DocumentClassification;
  archivedAt: string | null;
  path: string;
}

export interface DocumentCategorySummary {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
}

export interface DocumentTagSummary {
  id: string;
  name: string;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  versionNote: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  fileStatus: string;
  uploadedByName: string;
  createdAt: string;
}

export interface DocumentCommentSummary {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface DocumentAccessGrantSummary {
  membershipId: string;
  memberName: string;
  accessLevel: DocumentAccessLevel;
  expiresAt: string | null;
}

export interface DocumentEntityLinkSummary {
  id: string;
  entityType: DocumentEntityType;
  entityId: string;
  label: string;
}

export interface DocumentEventSummary {
  id: string;
  eventType: string;
  actorName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DocumentReviewSummary {
  id: string;
  versionId: string;
  versionNumber: number;
  approvalRequestId: string;
  status: DocumentReviewStatus;
  submittedByName: string;
  submittedAt: string;
  completedAt: string | null;
}

export interface DocumentPublicationAudienceSummary {
  id: string;
  audienceType: DocumentPublicationAudienceType;
  audienceId: string | null;
  label: string;
}

export interface DocumentPublicationSummary {
  id: string;
  versionId: string;
  versionNumber: number;
  publicationNumber: number;
  effectiveAt: string;
  expiresAt: string | null;
  releaseNote: string | null;
  status: DocumentPublicationStatus;
  state: "scheduled" | "published" | "expired" | "superseded" | "withdrawn";
  supersedesPublicationId: string | null;
  supersededByPublicationId: string | null;
  supersededAt: string | null;
  withdrawnAt: string | null;
  publishedAt: string;
  publishedByName: string;
  audiences: DocumentPublicationAudienceSummary[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  description: string | null;
  documentDate: string | null;
  referenceCode: string | null;
  folderId: string | null;
  folderPath: string | null;
  categoryId: string | null;
  categoryName: string | null;
  classification: DocumentClassification;
  ownerMembershipId: string;
  ownerName: string;
  createdByMembershipId: string;
  status: DocumentStatus;
  expiryDate: string | null;
  reviewDate: string | null;
  retentionUntil: string | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  reviewState: "expired" | "review_due" | "current";
  retentionState: "hold" | "expired" | "active";
  createdAt: string;
  updatedAt: string;
  tags: DocumentTagSummary[];
  links: DocumentEntityLinkSummary[];
  versions: DocumentVersionSummary[];
  comments: DocumentCommentSummary[];
  grants: DocumentAccessGrantSummary[];
  events: DocumentEventSummary[];
  reviews: DocumentReviewSummary[];
  publications: DocumentPublicationSummary[];
  access: {
    canEdit: boolean;
    canDownload: boolean;
    canComment: boolean;
    canArchive: boolean;
    canManageAccess: boolean;
    canLegalHold: boolean;
    canSubmitApproval: boolean;
    canPublish: boolean;
    canWithdraw: boolean;
  };
}

export type { DocumentEntityOption } from "@/modules/documents/server/document-entity-options";

export interface DocumentWorkspaceData {
  documents: DocumentSummary[];
  folders: DocumentFolderSummary[];
  categories: DocumentCategorySummary[];
  tags: DocumentTagSummary[];
  members: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  entityOptions: DocumentEntityOption[];
  filters: {
    query: string;
    status: "active" | "archived" | "all";
    folderId: string | null;
  };
  summary: {
    visible: number;
    active: number;
    reviewDue: number;
    expired: number;
    legalHold: number;
  };
  capabilities: {
    canCreate: boolean;
    canManageFolders: boolean;
    canManageTaxonomy: boolean;
    canManageAccess: boolean;
    canLegalHold: boolean;
    canPublish: boolean;
  };
}

export type DocumentWorkspaceResult =
  | { allowed: true; data: DocumentWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

interface FolderRow {
  id: string;
  parent_folder_id: string | null;
  name: string;
  description: string | null;
  classification: DocumentClassification;
  archived_at: string | null;
}

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  document_date: string | null;
  reference_code: string | null;
  folder_id: string | null;
  category_id: string | null;
  category_name: string | null;
  classification: DocumentClassification;
  owner_membership_id: string;
  owner_name: string;
  created_by_membership_id: string;
  status: DocumentStatus;
  expiry_date: string | null;
  review_date: string | null;
  retention_until: string | null;
  legal_hold: boolean;
  legal_hold_reason: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_download: boolean;
  can_comment: boolean;
  can_archive: boolean;
  can_manage_access: boolean;
  can_legal_hold: boolean;
  can_submit_approval: boolean;
  can_publish: boolean;
  can_withdraw: boolean;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_number: number;
  version_note: string | null;
  original_file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  file_status: string;
  uploaded_by_name: string;
  created_at: string;
}

interface TagLinkRow {
  document_id: string;
  id: string;
  name: string;
}
interface LinkRow {
  id: string;
  document_id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  label: string;
}
interface CommentRow {
  id: string;
  document_id: string;
  body: string;
  author_name: string;
  created_at: string;
}
interface GrantRow {
  document_id: string;
  membership_id: string;
  member_name: string;
  access_level: DocumentAccessLevel;
  expires_at: string | null;
}
interface EventRow {
  id: string;
  document_id: string;
  event_type: string;
  actor_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
interface ReviewRow {
  id: string;
  document_id: string;
  version_id: string;
  version_number: number;
  approval_request_id: string;
  status: DocumentReviewStatus;
  submitted_by_name: string;
  submitted_at: string;
  completed_at: string | null;
}
interface PublicationRow {
  id: string;
  document_id: string;
  version_id: string;
  version_number: number;
  publication_number: number;
  effective_at: string;
  expires_at: string | null;
  release_note: string | null;
  status: DocumentPublicationStatus;
  supersedes_publication_id: string | null;
  superseded_by_publication_id: string | null;
  superseded_at: string | null;
  withdrawn_at: string | null;
  published_at: string;
  published_by_name: string;
}
interface PublicationAudienceRow {
  id: string;
  publication_id: string;
  audience_type: DocumentPublicationAudienceType;
  audience_id: string | null;
  label: string;
}

type QuerySql = Sql | TransactionSql;

function folderPaths(rows: FolderRow[]): DocumentFolderSummary[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pathFor = (row: FolderRow) => {
    const parts = [row.name];
    let parentId = row.parent_folder_id;
    const seen = new Set([row.id]);
    while (parentId && !seen.has(parentId) && parts.length < 25) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parent_folder_id;
    }
    return parts.join(" / ");
  };
  return rows.map((row) => ({
    id: row.id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
    description: row.description,
    classification: row.classification,
    archivedAt: row.archived_at,
    path: pathFor(row),
  }));
}

function groupBy<T extends { document_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const values = grouped.get(row.document_id) ?? [];
    values.push(row);
    grouped.set(row.document_id, values);
  }
  return grouped;
}

export async function documentAccessAllowed(
  context: CurrentPermissionContext,
  documentId: string,
  action:
    | "view"
    | "download"
    | "comment"
    | "edit"
    | "archive"
    | "manage_access"
    | "legal_hold"
    | "submit_approval"
    | "publish"
    | "withdraw",
  sql: QuerySql = getDatabaseClient(),
): Promise<boolean> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.document_membership_access_allowed(
      ${documentId}::uuid, ${context.membership.id}::uuid, ${action}
    ) as allowed
  `;
  return rows[0]?.allowed === true;
}

export class DocumentAccessError extends Error {}

export async function requireDocumentMembershipScope(
  context: CurrentPermissionContext,
  permissionKey: string,
  targetMembershipId: string,
  sql: QuerySql = getDatabaseClient(),
): Promise<void> {
  const scope = context.permissionScopes.get(permissionKey) ?? "own";
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.crm_scope_allows_membership(
      ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
    ) as allowed
    from public.memberships as membership
    where membership.id = ${targetMembershipId}::uuid
      and membership.organization_id = ${context.membership.organizationId}::uuid
      and membership.status = 'active'
    limit 1
  `;
  if (!rows[0]?.allowed) {
    throw new DocumentAccessError("The selected owner is outside your permission scope.");
  }
}

export async function requireDocumentEntityAccess(
  context: CurrentPermissionContext,
  entityType: DocumentEntityType,
  entityId: string,
  sql: QuerySql = getDatabaseClient(),
): Promise<void> {
  const membershipId = context.membership.id;
  const organizationId = context.membership.organizationId;
  let allowed = false;
  if (entityType === "client" && context.permissions.has(crmPermissionKeys.companyView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, company.account_owner_membership_id, company.created_by_membership_id
      ) as allowed
      from public.crm_companies as company
      where company.id = ${entityId}::uuid and company.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "contact" && context.permissions.has(crmPermissionKeys.contactView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.contactView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, contact.owner_membership_id, contact.created_by_membership_id
      ) as allowed
      from public.crm_contacts as contact
      where contact.id = ${entityId}::uuid and contact.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "lead" && context.permissions.has(crmPermissionKeys.leadView)) {
    const scope = context.permissionScopes.get(crmPermissionKeys.leadView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, lead.owner_membership_id, lead.created_by_membership_id
      ) as allowed
      from public.crm_leads as lead
      where lead.id = ${entityId}::uuid and lead.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (
    entityType === "project" &&
    context.permissions.has(projectPermissionKeys.projectView)
  ) {
    const scope = context.permissionScopes.get(projectPermissionKeys.projectView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.project_is_visible(${entityId}::uuid, ${membershipId}::uuid, ${scope}) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "task" && context.permissions.has(projectPermissionKeys.taskView)) {
    const scope = context.permissionScopes.get(projectPermissionKeys.taskView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.project_is_visible(task.project_id, ${membershipId}::uuid, ${scope}) as allowed
      from public.project_tasks as task
      where task.id = ${entityId}::uuid and task.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (
    entityType === "invoice" &&
    context.permissions.has(financePermissionKeys.invoiceView)
  ) {
    const scope = context.permissionScopes.get(financePermissionKeys.invoiceView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, invoice.created_by_membership_id, invoice.created_by_membership_id
      ) as allowed
      from public.finance_invoices as invoice
      where invoice.id = ${entityId}::uuid and invoice.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (
    entityType === "estimate" &&
    context.permissions.has(financePermissionKeys.estimateView)
  ) {
    const scope = context.permissionScopes.get(financePermissionKeys.estimateView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, estimate.created_by_membership_id, estimate.created_by_membership_id
      ) as allowed
      from public.finance_estimates as estimate
      where estimate.id = ${entityId}::uuid and estimate.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "ticket" && context.permissions.has(supportPermissionKeys.view)) {
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.support_ticket_membership_access_allowed(
        ${entityId}::uuid, ${membershipId}::uuid, ${supportPermissionKeys.view}
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "asset" && context.permissions.has(assetPermissionKeys.view)) {
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.asset_membership_access_allowed(
        ${entityId}::uuid, ${membershipId}::uuid, ${assetPermissionKeys.view}
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "vendor" && context.permissions.has(vendorPermissionKeys.view)) {
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.vendor_membership_access_allowed(
        ${entityId}::uuid, ${membershipId}::uuid, ${vendorPermissionKeys.view}
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (
    entityType === "purchase_order" &&
    context.permissions.has(vendorPermissionKeys.purchaseOrderView)
  ) {
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.purchase_order_membership_access_allowed(
        ${entityId}::uuid, ${membershipId}::uuid, ${vendorPermissionKeys.purchaseOrderView}
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "contract" && context.permissions.has(legalPermissionKeys.view)) {
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.legal_contract_membership_access_allowed(
        ${entityId}::uuid, ${membershipId}::uuid, ${legalPermissionKeys.view}
      ) as allowed
    `;
    allowed = rows[0]?.allowed === true;
  } else if (entityType === "employee" && context.permissions.has(hrPermissionKeys.employeeView)) {
    const scope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
    const rows = await sql<Array<{ allowed: boolean }>>`
      select private.crm_scope_allows_membership(
        ${membershipId}::uuid, ${scope}, membership.id, membership.id
      ) as allowed
      from public.memberships as membership
      where membership.id = ${entityId}::uuid and membership.organization_id = ${organizationId}::uuid
    `;
    allowed = rows[0]?.allowed === true;
  }
  if (!allowed)
    throw new DocumentAccessError("The related record is outside your permission scope.");
}

export async function requireDocumentAccess(
  context: CurrentPermissionContext,
  documentId: string,
  action:
    | "view"
    | "download"
    | "comment"
    | "edit"
    | "archive"
    | "manage_access"
    | "legal_hold"
    | "submit_approval"
    | "publish"
    | "withdraw",
  sql: QuerySql = getDatabaseClient(),
): Promise<void> {
  if (!(await documentAccessAllowed(context, documentId, action, sql))) {
    throw new DocumentAccessError("The document is outside your permitted access.");
  }
}

export async function recordDocumentEvent(
  sql: QuerySql,
  context: CurrentPermissionContext,
  input: {
    documentId: string;
    versionId?: string | null;
    eventType: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into public.document_events (
      organization_id, document_id, version_id, event_type, actor_membership_id, details
    ) values (
      ${context.membership.organizationId}::uuid, ${input.documentId}::uuid,
      ${input.versionId ?? null}::uuid, ${input.eventType}, ${context.membership.id}::uuid,
      ${sql.json(toJsonValue(input.details ?? {}))}
    )
  `;
}

export async function getDocumentWorkspaceData(
  input: {
    query?: string;
    status?: string;
    folderId?: string;
    allFolders?: boolean;
  } = {},
): Promise<DocumentWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(documentPermissionKeys.workspace) ||
    !context.permissions.has(documentPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const query = (input.query ?? "").trim().slice(0, 100);
  const status = input.status === "archived" || input.status === "all" ? input.status : "active";
  const folderId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.folderId ?? "",
    )
      ? (input.folderId ?? null)
      : null;
  const allFolders = input.allFolders === true;
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const db = getDatabaseClient();
  const canManageFolders = context.permissions.has(documentPermissionKeys.folderManage);
  const canManageAccess = context.permissions.has(documentPermissionKeys.manageAccess);
  const canPublish = context.permissions.has(documentPermissionKeys.publish);
  const createScope = context.permissionScopes.get(documentPermissionKeys.create) ?? "own";
  const accessScope = context.permissionScopes.get(documentPermissionKeys.manageAccess) ?? "own";
  const publishScope = context.permissionScopes.get(documentPermissionKeys.publish) ?? "own";

  const [
    folderRows,
    categoryRows,
    tagRows,
    memberRows,
    departmentRows,
    teamRows,
    entityRows,
    documentRows,
  ] = await Promise.all([
    db<FolderRow[]>`
      with recursive visible_document_folders as (
        select folder.id, folder.parent_folder_id
        from public.document_folders as folder
        join public.documents as document on document.folder_id = folder.id
        where folder.organization_id = ${organizationId}::uuid
          and document.organization_id = ${organizationId}::uuid
          and private.document_membership_access_allowed(
            document.id, ${membershipId}::uuid, 'view'
          )
        union
        select parent.id, parent.parent_folder_id
        from public.document_folders as parent
        join visible_document_folders as child on child.parent_folder_id = parent.id
        where parent.organization_id = ${organizationId}::uuid
      )
      select id, parent_folder_id, name, description, classification, archived_at::text
      from public.document_folders
      where organization_id = ${organizationId}::uuid
        and (classification = 'internal' or ${canManageFolders}
          or id in (select id from visible_document_folders))
      order by archived_at nulls first, name
    `,
    db<
      Array<{
        id: string;
        name: string;
        description: string | null;
        status: "active" | "inactive";
      }>
    >`
      select id, name, description, status from public.document_categories
      where organization_id = ${organizationId}::uuid order by status, name
    `,
    db<Array<{ id: string; name: string }>>`
      select id, name from public.document_tags
      where organization_id = ${organizationId}::uuid order by name
    `,
    db<Array<{ id: string; name: string }>>`
      select membership.id, private.membership_display_name(membership.id) as name
      from public.memberships as membership
      where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
        and (
          private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${createScope}, membership.id, membership.id
          )
          or (${canManageAccess} and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${accessScope}, membership.id, membership.id
          ))
          or (${canPublish} and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${publishScope}, membership.id, membership.id
          ))
        )
      order by name limit 500
    `,
    db<Array<{ id: string; name: string }>>`
      select id, name from public.departments
      where organization_id = ${organizationId}::uuid and status = 'active' and ${canPublish}
      order by name
    `,
    db<Array<{ id: string; name: string }>>`
      select id, name from public.teams
      where organization_id = ${organizationId}::uuid and status = 'active' and ${canPublish}
      order by name
    `,
    getDocumentEntityOptions(context, db),
    db<DocumentRow[]>`
      select document.id, document.title, document.description, document.document_date::text,
        document.reference_code, document.folder_id,
        document.category_id, category.name as category_name, document.classification,
        document.owner_membership_id,
        private.membership_display_name(document.owner_membership_id) as owner_name,
        document.created_by_membership_id, document.status, document.expiry_date::text,
        document.review_date::text, document.retention_until::text, document.legal_hold,
        document.legal_hold_reason, document.created_at::text, document.updated_at::text,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'edit') as can_edit,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'download') as can_download,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'comment') as can_comment,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'archive') as can_archive,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'manage_access') as can_manage_access,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'legal_hold') as can_legal_hold,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'submit_approval') as can_submit_approval,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'publish') as can_publish,
        private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'withdraw') as can_withdraw
      from public.documents as document
      left join public.document_categories as category on category.id = document.category_id
      where document.organization_id = ${organizationId}::uuid
        and private.document_membership_access_allowed(document.id, ${membershipId}::uuid, 'view')
        and (${status} = 'all' or document.status = ${status})
        and (
          ${query} <> ''
          or ${allFolders}
          or document.folder_id is not distinct from ${folderId}::uuid
        )
        and (${query} = '' or document.title ilike ${search} escape '\\'
          or coalesce(document.description, '') ilike ${search} escape '\\'
          or coalesce(document.document_date::text, '') ilike ${search} escape '\\'
          or coalesce(document.reference_code, '') ilike ${search} escape '\\'
          or coalesce(category.name, '') ilike ${search} escape '\\'
          or exists (
            with recursive search_folders as (
              select folder.id, folder.parent_folder_id, folder.name,
                array[folder.id]::uuid[] as visited_ids, 1 as depth
              from public.document_folders as folder
              where folder.id = document.folder_id
                and folder.organization_id = document.organization_id
              union all
              select parent.id, parent.parent_folder_id, parent.name,
                child.visited_ids || parent.id, child.depth + 1
              from public.document_folders as parent
              join search_folders as child on child.parent_folder_id = parent.id
              where parent.organization_id = document.organization_id
                and not parent.id = any(child.visited_ids)
                and child.depth < 25
            )
            select 1 from search_folders
            where name ilike ${search} escape '\\'
          )
          or exists (
            select 1 from public.document_tag_links search_link
            join public.document_tags search_tag on search_tag.id = search_link.tag_id
            where search_link.document_id = document.id
              and search_tag.name ilike ${search} escape '\\'
          )
          or exists (
            select 1 from public.document_versions search_version
            join public.private_files search_file on search_file.id = search_version.private_file_id
            where search_version.document_id = document.id
              and search_file.original_file_name ilike ${search} escape '\\'
          ))
      order by document.updated_at desc limit 300
    `,
  ]);

  const documentIds = documentRows.map((row) => row.id);
  const [
    versionRows,
    tagLinkRows,
    linkRows,
    commentRows,
    grantRows,
    eventRows,
    reviewRows,
    publicationRows,
    publicationAudienceRows,
  ] = documentIds.length
    ? await Promise.all([
        db<VersionRow[]>`
          select version.id, version.document_id, version.version_number, version.version_note,
            file.original_file_name, file.mime_type, file.size_bytes, file.sha256,
            file.status as file_status,
            private.membership_display_name(version.uploaded_by_membership_id) as uploaded_by_name,
            version.created_at::text
          from public.document_versions as version
          join public.private_files as file on file.id = version.private_file_id
          where version.document_id = any(${documentIds}::uuid[])
          order by version.version_number desc
        `,
        db<TagLinkRow[]>`
          select link.document_id, tag.id, tag.name
          from public.document_tag_links as link join public.document_tags as tag on tag.id = link.tag_id
          where link.document_id = any(${documentIds}::uuid[]) order by tag.name
        `,
        db<LinkRow[]>`
          select link.id, link.document_id, link.entity_type, link.entity_id,
            case link.entity_type
              when 'client' then (select display_name from public.crm_companies where id = link.entity_id)
              when 'contact' then (select concat_ws(' ', first_name, last_name) from public.crm_contacts where id = link.entity_id)
              when 'lead' then (select name from public.crm_leads where id = link.entity_id)
              when 'project' then (select concat(code, ' — ', name) from public.projects where id = link.entity_id)
              when 'task' then (select concat(task_number, ' — ', title) from public.project_tasks where id = link.entity_id)
              when 'invoice' then (select coalesce(invoice_number, 'Draft invoice') from public.finance_invoices where id = link.entity_id)
              when 'estimate' then (select coalesce(estimate_number, 'Draft estimate') from public.finance_estimates where id = link.entity_id)
              when 'ticket' then (select concat('SUP-', lpad(ticket_number::text, 6, '0'), ' — ', subject) from public.support_tickets where id = link.entity_id)
              when 'asset' then (select concat(asset_tag, ' — ', name) from public.assets where id = link.entity_id)
              when 'vendor' then (select concat('VEN-', lpad(vendor_number::text, 6, '0'), ' — ', display_name) from public.vendors where id = link.entity_id)
              when 'purchase_order' then (select concat('PO-', lpad(purchase_order.purchase_order_number::text, 6, '0'), ' — ', vendor.display_name) from public.procurement_purchase_orders purchase_order join public.vendors vendor on vendor.id = purchase_order.vendor_id where purchase_order.id = link.entity_id)
              when 'contract' then (select concat(internal_reference, ' — ', title) from public.legal_contracts where id = link.entity_id)
              when 'employee' then (select coalesce(employee.preferred_name, employee.legal_name, member_profile.display_name,
                split_part(coalesce(member_user.email, ''), '@', 1), 'Employee')
                from public.memberships as member
                join public.identity_accounts as member_user on member_user.id = member.user_id
                left join public.profiles as member_profile on member_profile.id = member.user_id
                left join public.hr_employee_profiles as employee on employee.membership_id = member.id
                where member.id = link.entity_id)
            end as label
          from public.document_entity_links as link
          where link.document_id = any(${documentIds}::uuid[])
          order by link.created_at
        `,
        db<CommentRow[]>`
          select comment.id, comment.document_id, comment.body,
            private.membership_display_name(comment.created_by_membership_id) as author_name,
            comment.created_at::text
          from public.document_comments as comment
          where comment.document_id = any(${documentIds}::uuid[])
          order by comment.created_at
        `,
        db<GrantRow[]>`
          select grant.document_id, grant.membership_id,
            private.membership_display_name(grant.membership_id) as member_name,
            grant.access_level, grant.expires_at::text
          from public.document_access_grants as grant
          where grant.document_id = any(${documentIds}::uuid[])
          order by member_name
        `,
        db<EventRow[]>`
          select event.id, event.document_id, event.event_type,
            private.membership_display_name(event.actor_membership_id) as actor_name,
            event.details, event.created_at::text
          from public.document_events as event
          where event.document_id = any(${documentIds}::uuid[])
          order by event.created_at desc limit 1000
        `,
        db<ReviewRow[]>`
          select review.id, review.document_id, review.version_id, version.version_number,
            review.approval_request_id, review.status,
            private.membership_display_name(review.submitted_by_membership_id) as submitted_by_name,
            review.submitted_at::text, review.completed_at::text
          from public.document_review_requests as review
          join public.document_versions as version on version.id = review.version_id
          where review.document_id = any(${documentIds}::uuid[])
          order by review.submitted_at desc
        `,
        db<PublicationRow[]>`
          select publication.id, publication.document_id, publication.version_id,
            version.version_number, publication.publication_number,
            publication.effective_at::text, publication.expires_at::text,
            publication.release_note, publication.status,
            publication.supersedes_publication_id, publication.superseded_by_publication_id,
            publication.superseded_at::text, publication.withdrawn_at::text,
            publication.published_at::text,
            private.membership_display_name(publication.published_by_membership_id) as published_by_name
          from public.document_publications as publication
          join public.document_versions as version on version.id = publication.version_id
          where publication.document_id = any(${documentIds}::uuid[])
          order by publication.publication_number desc
        `,
        db<PublicationAudienceRow[]>`
          select audience.id, audience.publication_id, audience.audience_type, audience.audience_id,
            case audience.audience_type
              when 'organization' then 'Everyone in the organization'
              when 'department' then coalesce((select name from public.departments where id = audience.audience_id), 'Department')
              when 'team' then coalesce((select name from public.teams where id = audience.audience_id), 'Team')
              when 'membership' then private.membership_display_name(audience.audience_id)
            end as label
          from public.document_publication_audiences as audience
          join public.document_publications as publication on publication.id = audience.publication_id
          where publication.document_id = any(${documentIds}::uuid[])
          order by audience.audience_type, label
        `,
      ])
    : ([[], [], [], [], [], [], [], [], []] as [
        VersionRow[],
        TagLinkRow[],
        LinkRow[],
        CommentRow[],
        GrantRow[],
        EventRow[],
        ReviewRow[],
        PublicationRow[],
        PublicationAudienceRow[],
      ]);

  const folders = folderPaths(folderRows);
  const visibleFolderId =
    folderId && folders.some((folder) => folder.id === folderId) ? folderId : null;
  const folderMap = new Map(folders.map((folder) => [folder.id, folder.path]));
  const versions = groupBy(versionRows);
  const tagLinks = groupBy(tagLinkRows);
  const links = groupBy(linkRows);
  const comments = groupBy(commentRows);
  const grants = groupBy(grantRows);
  const events = groupBy(eventRows);
  const reviews = groupBy(reviewRows);
  const publications = groupBy(publicationRows);
  const publicationAudiences = new Map<string, PublicationAudienceRow[]>();
  for (const audience of publicationAudienceRows) {
    const values = publicationAudiences.get(audience.publication_id) ?? [];
    values.push(audience);
    publicationAudiences.set(audience.publication_id, values);
  }

  const documents: DocumentSummary[] = documentRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    documentDate: row.document_date,
    referenceCode: row.reference_code,
    folderId: row.folder_id,
    folderPath: row.folder_id ? (folderMap.get(row.folder_id) ?? null) : null,
    categoryId: row.category_id,
    categoryName: row.category_name,
    classification: row.classification,
    ownerMembershipId: row.owner_membership_id,
    ownerName: row.owner_name,
    createdByMembershipId: row.created_by_membership_id,
    status: row.status,
    expiryDate: row.expiry_date,
    reviewDate: row.review_date,
    retentionUntil: row.retention_until,
    legalHold: row.legal_hold,
    legalHoldReason: row.can_legal_hold ? row.legal_hold_reason : null,
    reviewState: documentReviewState({ reviewDate: row.review_date, expiryDate: row.expiry_date }),
    retentionState: documentRetentionState({
      legalHold: row.legal_hold,
      retentionUntil: row.retention_until,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: (tagLinks.get(row.id) ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
    links: (links.get(row.id) ?? []).map((link) => ({
      id: link.id,
      entityType: link.entity_type,
      entityId: link.entity_id,
      label: link.label,
    })),
    versions: (versions.get(row.id) ?? []).map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      versionNote: version.version_note,
      fileName: version.original_file_name,
      mimeType: version.mime_type,
      sizeBytes: Number(version.size_bytes),
      sha256: version.sha256,
      fileStatus: version.file_status,
      uploadedByName: version.uploaded_by_name,
      createdAt: version.created_at,
    })),
    comments: (comments.get(row.id) ?? []).map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorName: comment.author_name,
      createdAt: comment.created_at,
    })),
    grants: row.can_manage_access
      ? (grants.get(row.id) ?? []).map((grant) => ({
          membershipId: grant.membership_id,
          memberName: grant.member_name,
          accessLevel: grant.access_level,
          expiresAt: grant.expires_at,
        }))
      : [],
    events: (events.get(row.id) ?? []).slice(0, 30).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      actorName: event.actor_name,
      details: row.can_manage_access ? event.details : {},
      createdAt: event.created_at,
    })),
    reviews: (reviews.get(row.id) ?? []).map((review) => ({
      id: review.id,
      versionId: review.version_id,
      versionNumber: review.version_number,
      approvalRequestId: review.approval_request_id,
      status: review.status,
      submittedByName: review.submitted_by_name,
      submittedAt: review.submitted_at,
      completedAt: review.completed_at,
    })),
    publications: (publications.get(row.id) ?? []).map((publication) => ({
      id: publication.id,
      versionId: publication.version_id,
      versionNumber: publication.version_number,
      publicationNumber: publication.publication_number,
      effectiveAt: publication.effective_at,
      expiresAt: publication.expires_at,
      releaseNote: publication.release_note,
      status: publication.status,
      state: documentPublicationState({
        status: publication.status,
        effectiveAt: publication.effective_at,
        expiresAt: publication.expires_at,
      }),
      supersedesPublicationId: publication.supersedes_publication_id,
      supersededByPublicationId: publication.superseded_by_publication_id,
      supersededAt: publication.superseded_at,
      withdrawnAt: publication.withdrawn_at,
      publishedAt: publication.published_at,
      publishedByName: publication.published_by_name,
      audiences: (publicationAudiences.get(publication.id) ?? []).map((audience) => ({
        id: audience.id,
        audienceType: audience.audience_type,
        audienceId: audience.audience_id,
        label: audience.label,
      })),
    })),
    access: {
      canEdit: row.can_edit,
      canDownload: row.can_download,
      canComment: row.can_comment,
      canArchive: row.can_archive,
      canManageAccess: row.can_manage_access,
      canLegalHold: row.can_legal_hold,
      canSubmitApproval: row.can_submit_approval,
      canPublish: row.can_publish,
      canWithdraw: row.can_withdraw,
    },
  }));

  return {
    allowed: true,
    data: {
      documents,
      folders,
      categories: categoryRows,
      tags: tagRows,
      members: memberRows,
      departments: departmentRows,
      teams: teamRows,
      entityOptions: entityRows,
      filters: { query, status, folderId: visibleFolderId },
      summary: {
        visible: documents.length,
        active: documents.filter((document) => document.status === "active").length,
        reviewDue: documents.filter((document) => document.reviewState === "review_due").length,
        expired: documents.filter((document) => document.reviewState === "expired").length,
        legalHold: documents.filter((document) => document.legalHold).length,
      },
      capabilities: {
        canCreate: context.permissions.has(documentPermissionKeys.create),
        canManageFolders,
        canManageTaxonomy: context.permissions.has(documentPermissionKeys.taxonomyManage),
        canManageAccess,
        canLegalHold: context.permissions.has(documentPermissionKeys.legalHold),
        canPublish,
      },
    },
  };
}
