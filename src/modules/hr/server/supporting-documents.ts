import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type {
  HrSupportingDocumentCategory,
  HrSupportingDocumentReviewStatus,
  HrSupportingDocumentStatus,
} from "@/modules/hr/supporting-documents";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  privateFileDigest,
  type PrivateFilePolicy,
} from "@/modules/private-files/server/file-policy";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const HR_SUPPORTING_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_SUPPORTING_DOCUMENT_POLICY: PrivateFilePolicy = {
  maxBytes: HR_SUPPORTING_DOCUMENT_MAX_BYTES,
  allowedMimeTypes: new Map([
    ["application/pdf", new Set([".pdf"])],
    ["image/jpeg", new Set([".jpg", ".jpeg"])],
    ["image/png", new Set([".png"])],
  ]),
  description: "Supporting documents must be PDF, JPEG, or PNG files.",
};

export interface HrSupportingDocumentSummary {
  id: string;
  membershipId: string;
  employeeName: string;
  category: HrSupportingDocumentCategory;
  title: string;
  reference: string;
  issuer: string | null;
  identifierSuffix: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  employeeVisible: boolean;
  reviewStatus: HrSupportingDocumentReviewStatus;
  status: HrSupportingDocumentStatus;
  version: number;
  fileStatus: string;
  originalFileName: string;
  createdAt: string;
  isSelf: boolean;
  isExpired: boolean;
}

export interface HrSupportingDocumentsWorkspaceData {
  documents: HrSupportingDocumentSummary[];
  capabilities: {
    canView: boolean;
    canManage: boolean;
    canUploadOwn: boolean;
  };
}

interface SupportingDocumentRow {
  id: string;
  membership_id: string;
  employee_name: string;
  category: HrSupportingDocumentCategory;
  title: string;
  internal_reference: string;
  issuer: string | null;
  identifier_suffix: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  employee_visible: boolean;
  review_status: HrSupportingDocumentReviewStatus;
  status: HrSupportingDocumentStatus;
  version: number;
  file_status: string;
  original_file_name: string;
  created_at: string;
}

export async function getHrSupportingDocumentsData(
  context: CurrentPermissionContext,
): Promise<HrSupportingDocumentsWorkspaceData> {
  const canView = context.permissions.has(hrPermissionKeys.supportingDocumentView);
  const canManage = context.permissions.has(hrPermissionKeys.supportingDocumentManage);
  const canUploadOwn = context.permissions.has(hrPermissionKeys.supportingDocumentUploadOwn);
  if (!canView) {
    return { documents: [], capabilities: { canView, canManage, canUploadOwn } };
  }

  const scope = context.permissionScopes.get(hrPermissionKeys.supportingDocumentView) ?? "own";
  const rows = await getDatabaseClient()<SupportingDocumentRow[]>`
    select document.id, document.membership_id,
      coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
      document.category, document.title, document.internal_reference, document.issuer,
      document.identifier_suffix, document.issued_date::text, document.expiry_date::text,
      document.employee_visible, document.review_status, document.status, document.version,
      file.status as file_status, file.original_file_name, document.created_at::text
    from public.hr_employee_supporting_documents as document
    join public.memberships as membership on membership.id = document.membership_id
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    left join public.profiles as profile on profile.id = membership.user_id
    left join public.hr_employee_profiles as employee
      on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
    join public.private_files as file on file.id = document.private_file_id
    where document.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, document.membership_id, document.membership_id
      )
      and (${scope} <> 'own' or document.employee_visible = true)
    order by document.created_at desc
    limit 500
  `;
  const today = new Date().toISOString().slice(0, 10);
  return {
    documents: rows.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      category: row.category,
      title: row.title,
      reference: row.internal_reference,
      issuer: row.issuer,
      identifierSuffix: row.identifier_suffix,
      issuedDate: row.issued_date,
      expiryDate: row.expiry_date,
      employeeVisible: row.employee_visible,
      reviewStatus: row.review_status,
      status: row.status,
      version: row.version,
      fileStatus: row.file_status,
      originalFileName: row.original_file_name,
      createdAt: row.created_at,
      isSelf: row.membership_id === context.membership.id,
      isExpired: Boolean(row.expiry_date && row.expiry_date < today),
    })),
    capabilities: { canView, canManage, canUploadOwn },
  };
}

export class HrSupportingDocumentTargetError extends Error {}

export async function requireHrSupportingDocumentTarget(
  context: CurrentPermissionContext,
  membershipId: string,
  permissionKey: string,
): Promise<{ membershipId: string }> {
  const scope = context.permissionScopes.get(permissionKey) ?? "own";
  const rows = await getDatabaseClient()<Array<{ membership_id: string }>>`
    select membership.id as membership_id
    from public.memberships as membership
    where membership.id = ${membershipId}::uuid
      and membership.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
      )
    limit 1
  `;
  if (!rows[0]) {
    throw new HrSupportingDocumentTargetError(
      "Employee is outside your supporting-document scope.",
    );
  }
  return { membershipId: rows[0].membership_id };
}

export interface HrSupportingDocumentCreateInput {
  id: string;
  membershipId: string;
  category: HrSupportingDocumentCategory;
  title: string;
  reference: string;
  issuer: string | null;
  identifierSuffix: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  employeeVisible: boolean;
  reviewStatus: HrSupportingDocumentReviewStatus;
  file: File;
  buffer: Buffer;
}

async function hasDuplicateSupportingDocument(
  context: CurrentPermissionContext,
  input: HrSupportingDocumentCreateInput,
  sha256: string,
): Promise<boolean> {
  const rows = await getDatabaseClient()<Array<{ id: string }>>`
    select id
    from public.hr_employee_supporting_documents
    where organization_id = ${context.membership.organizationId}::uuid
      and membership_id = ${input.membershipId}::uuid
      and category = ${input.category}
      and internal_reference = ${input.reference}
      and sha256 = ${sha256}
    limit 1
  `;
  return Boolean(rows[0]);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );
}

export async function createHrSupportingDocumentPrivateFile(
  context: CurrentPermissionContext,
  input: HrSupportingDocumentCreateInput,
): Promise<{ created: boolean; documentId: string }> {
  const sha256 = privateFileDigest(input.buffer);
  if (await hasDuplicateSupportingDocument(context, input, sha256)) {
    return { created: false, documentId: input.id };
  }
  let result;
  try {
    result = await createQuarantinedPrivateFile({
      organizationId: context.membership.organizationId,
      uploadedByMembershipId: context.membership.id,
      moduleKey: "hr",
      entityType: "hr_employee_supporting_document",
      entityId: input.id,
      classification: "restricted",
      file: input.file,
      buffer: input.buffer,
      policy: HR_SUPPORTING_DOCUMENT_POLICY,
      accessRules: {
        viewPermission: hrPermissionKeys.supportingDocumentView,
        managePermission: hrPermissionKeys.supportingDocumentManage,
        ownMembershipId: input.membershipId,
        employeeVisible: input.employeeVisible,
      },
      metadata: {
        supportingDocumentId: input.id,
        membershipId: input.membershipId,
        category: input.category,
        reference: input.reference,
      },
      link: async (sql, privateFile) => {
        const lockKey = [
          context.membership.organizationId,
          input.membershipId,
          input.category,
          input.reference,
        ].join(":");
        await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const priorRows = await sql<Array<{ id: string; version: number }>>`
        select id, version
        from public.hr_employee_supporting_documents
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${input.membershipId}::uuid
          and category = ${input.category}
          and internal_reference = ${input.reference}
          and status = 'current'
        order by version desc
        limit 1
      `;
        const prior = priorRows[0] ?? null;
        const version = (prior?.version ?? 0) + 1;
        if (prior) {
          await sql`
          update public.hr_employee_supporting_documents
          set status = 'superseded'
          where id = ${prior.id}::uuid and status = 'current'
        `;
        }
        await sql`
        insert into public.hr_employee_supporting_documents (
          id, organization_id, membership_id, category, title, internal_reference,
          issuer, identifier_suffix, issued_date, expiry_date, employee_visible,
          review_status, reviewed_at, reviewed_by_membership_id, status, version, sha256,
          private_file_id, supersedes_document_id, uploaded_by_membership_id
        ) values (
          ${input.id}::uuid, ${context.membership.organizationId}::uuid,
          ${input.membershipId}::uuid, ${input.category}, ${input.title}, ${input.reference},
          ${input.issuer}, ${input.identifierSuffix}, ${input.issuedDate}::date,
          ${input.expiryDate}::date, ${input.employeeVisible}, ${input.reviewStatus},
          ${input.reviewStatus === "pending" ? null : new Date()}::timestamptz,
          ${input.reviewStatus === "pending" ? null : context.membership.id}::uuid,
          'current', ${version}, ${privateFile.sha256}, ${privateFile.id}::uuid,
          ${prior?.id ?? null}::uuid,
          ${context.membership.id}::uuid
        )
      `;
        await writeAuditEvent(sql, context, {
          action: "hr.supporting_document_quarantined",
          entityType: "hr_employee_supporting_document",
          entityId: input.id,
          afterState: {
            membershipId: input.membershipId,
            category: input.category,
            reference: input.reference,
            version,
            employeeVisible: input.employeeVisible,
            reviewStatus: input.reviewStatus,
            privateFileId: privateFile.id,
          },
        });
      },
    });
  } catch (error) {
    if (
      isUniqueViolation(error) &&
      (await hasDuplicateSupportingDocument(context, input, sha256))
    ) {
      return { created: false, documentId: input.id };
    }
    throw error;
  }
  return { created: result.created, documentId: input.id };
}

export function supportingDocumentValidationMessage(error: unknown): string | null {
  if (error instanceof HrSupportingDocumentTargetError) return error.message;
  if (!(error instanceof Error)) return null;
  if (!error.message.startsWith("private-file-")) return null;
  if (error.message.includes("10 MB")) return "Supporting documents are limited to 10 MB.";
  if (error.message.includes("PDF, JPEG, or PNG")) {
    return "Choose a PDF, JPEG, or PNG supporting document.";
  }
  if (error.message.includes("contents do not match")) {
    return "The file contents do not match the selected safe file type.";
  }
  return "The supporting document failed file validation.";
}

export async function getAuthorizedHrSupportingDocument(
  context: CurrentPermissionContext,
  documentId: string,
): Promise<{ id: string; membershipId: string } | null> {
  const scope = context.permissionScopes.get(hrPermissionKeys.supportingDocumentView) ?? "own";
  const rows = await getDatabaseClient()<Array<{ id: string; membership_id: string }>>`
    select document.id, document.membership_id
    from public.hr_employee_supporting_documents as document
    where document.id = ${documentId}::uuid
      and document.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, document.membership_id, document.membership_id
      )
      and (${scope} <> 'own' or document.employee_visible = true)
    limit 1
  `;
  const row = rows[0];
  return row ? { id: row.id, membershipId: row.membership_id } : null;
}

export async function recordHrSupportingDocumentDownload(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  input: { documentId: string; privateFileId: string },
): Promise<void> {
  await writeAuditEvent(sql, context, {
    action: "hr.supporting_document_downloaded",
    entityType: "hr_employee_supporting_document",
    entityId: input.documentId,
    afterState: { privateFileId: input.privateFileId },
  });
}

export async function reviewHrSupportingDocument(
  context: CurrentPermissionContext,
  input: { documentId: string; reviewStatus: "verified" | "rejected" },
): Promise<void> {
  await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<
      Array<{
        membership_id: string;
        category: HrSupportingDocumentCategory;
        review_status: string;
      }>
    >`
      update public.hr_employee_supporting_documents as document
      set review_status = ${input.reviewStatus}, reviewed_at = now(),
        reviewed_by_membership_id = ${context.membership.id}::uuid
      where document.id = ${input.documentId}::uuid
        and document.organization_id = ${context.membership.organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${context.membership.id}::uuid,
          ${context.permissionScopes.get(hrPermissionKeys.supportingDocumentManage) ?? "organization"},
          document.membership_id,
          document.membership_id
        )
      returning membership_id, category, review_status
    `;
    const row = rows[0];
    if (!row) throw new HrSupportingDocumentTargetError("Supporting document was not found.");
    await writeAuditEvent(sql, context, {
      action: "hr.supporting_document_reviewed",
      entityType: "hr_employee_supporting_document",
      entityId: input.documentId,
      afterState: {
        membershipId: row.membership_id,
        category: row.category,
        reviewStatus: row.review_status,
      },
    });
  });
}

export async function setHrSupportingDocumentVisibility(
  context: CurrentPermissionContext,
  input: { documentId: string; employeeVisible: boolean },
): Promise<void> {
  await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<
      Array<{ membership_id: string; category: HrSupportingDocumentCategory }>
    >`
      update public.hr_employee_supporting_documents as document
      set employee_visible = ${input.employeeVisible}
      where document.id = ${input.documentId}::uuid
        and document.organization_id = ${context.membership.organizationId}::uuid
        and private.crm_scope_allows_membership(
          ${context.membership.id}::uuid,
          ${context.permissionScopes.get(hrPermissionKeys.supportingDocumentManage) ?? "organization"},
          document.membership_id,
          document.membership_id
        )
      returning membership_id, category
    `;
    const row = rows[0];
    if (!row) throw new HrSupportingDocumentTargetError("Supporting document was not found.");
    await sql`
      update public.private_files as file
      set access_rules = jsonb_set(file.access_rules, '{employeeVisible}', ${sql.json(
        toJsonValue(input.employeeVisible),
      )})
      from public.hr_employee_supporting_documents as document
      where document.id = ${input.documentId}::uuid
        and document.private_file_id = file.id
        and file.organization_id = ${context.membership.organizationId}::uuid
    `;
    await writeAuditEvent(sql, context, {
      action: "hr.supporting_document_visibility_changed",
      entityType: "hr_employee_supporting_document",
      entityId: input.documentId,
      afterState: {
        membershipId: row.membership_id,
        category: row.category,
        employeeVisible: input.employeeVisible,
      },
    });
  });
}
