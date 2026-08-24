import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import type { HrDocumentTemplateSource, HrDocumentType } from "@/modules/hr/documents";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PrivateFilePolicy } from "@/modules/private-files/server/file-policy";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const HR_EMPLOYEE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_EMPLOYEE_DOCUMENT_POLICY: PrivateFilePolicy = {
  maxBytes: HR_EMPLOYEE_DOCUMENT_MAX_BYTES,
  allowedMimeTypes: new Map([["application/pdf", new Set([".pdf"])]]),
  description: "Employee documents must be PDF files.",
};

export interface HrEmployeeDocumentCreateInput {
  id: string;
  membershipId: string;
  documentType: HrDocumentType;
  title: string;
  reference: string;
  effectiveDate: string;
  expiryDate: string | null;
  templateSource: HrDocumentTemplateSource;
  builtinTemplateKey: string | null;
  customTemplateId: string | null;
  templateName: string;
  templateVersion: number;
  templateSha256: string;
  renderContext: Record<string, unknown>;
  file: File;
  buffer: Buffer;
}

export async function createHrEmployeeDocumentPrivateFile(
  context: CurrentPermissionContext,
  input: HrEmployeeDocumentCreateInput,
): Promise<{ created: boolean; documentId: string }> {
  const result = await createQuarantinedPrivateFile({
    organizationId: context.membership.organizationId,
    uploadedByMembershipId: context.membership.id,
    moduleKey: "hr",
    entityType: "hr_employee_document",
    entityId: input.id,
    classification: "restricted",
    file: input.file,
    buffer: input.buffer,
    policy: HR_EMPLOYEE_DOCUMENT_POLICY,
    accessRules: {
      viewPermission: hrPermissionKeys.employeeDocumentView,
      managePermission: hrPermissionKeys.employeeDocumentManage,
      ownMembershipId: input.membershipId,
    },
    metadata: {
      documentId: input.id,
      membershipId: input.membershipId,
      documentType: input.documentType,
      reference: input.reference,
    },
    link: async (sql, privateFile) => {
      const lockKey = [
        context.membership.organizationId,
        input.membershipId,
        input.documentType,
        input.reference,
      ].join(":");
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const priorRows = await sql<Array<{ id: string; version: number }>>`
        select id, version
        from public.hr_employee_documents
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${input.membershipId}::uuid
          and document_type = ${input.documentType}
          and internal_reference = ${input.reference}
        order by version desc
        limit 1
      `;
      const prior = priorRows[0] ?? null;
      const version = (prior?.version ?? 0) + 1;
      if (prior) {
        await sql`
          update public.hr_employee_documents
          set status = 'superseded'
          where id = ${prior.id}::uuid and status = 'issued'
        `;
      }
      await sql`
        insert into public.hr_employee_documents (
          id, organization_id, membership_id, document_type, title, internal_reference,
          version, effective_date, expiry_date, status, template_source,
          builtin_template_key, custom_template_id, template_name, template_version,
          template_sha256, render_context, private_file_id, original_file_name,
          supersedes_document_id, created_by_membership_id
        ) values (
          ${input.id}::uuid, ${context.membership.organizationId}::uuid,
          ${input.membershipId}::uuid, ${input.documentType}, ${input.title},
          ${input.reference}, ${version}, ${input.effectiveDate}::date,
          ${input.expiryDate}::date, 'issued', ${input.templateSource},
          ${input.builtinTemplateKey}, ${input.customTemplateId}::uuid, ${input.templateName},
          ${input.templateVersion}, ${input.templateSha256},
          ${sql.json(toJsonValue(input.renderContext))}, ${privateFile.id}::uuid,
          ${privateFile.fileName}, ${prior?.id ?? null}::uuid, ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.employee_document_generated",
        entityType: "hr_employee_document",
        entityId: input.id,
        afterState: {
          membershipId: input.membershipId,
          documentType: input.documentType,
          reference: input.reference,
          version,
          templateSource: input.templateSource,
          templateName: input.templateName,
          templateVersion: input.templateVersion,
          templateSha256: input.templateSha256,
          privateFileId: privateFile.id,
        },
      });
    },
  });
  return { created: result.created, documentId: input.id };
}

export async function getAuthorizedHrEmployeeDocument(
  context: CurrentPermissionContext,
  documentId: string,
): Promise<{ id: string; membershipId: string } | null> {
  const scope = context.permissionScopes.get(hrPermissionKeys.employeeDocumentView) ?? "own";
  const rows = await getDatabaseClient()<Array<{ id: string; membership_id: string }>>`
    select document.id, document.membership_id
    from public.hr_employee_documents as document
    where document.id = ${documentId}::uuid
      and document.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, document.membership_id, document.membership_id
      )
    limit 1
  `;
  const row = rows[0];
  return row ? { id: row.id, membershipId: row.membership_id } : null;
}

export async function recordHrEmployeeDocumentDownload(
  sql: TransactionSql,
  context: CurrentPermissionContext,
  input: { documentId: string; privateFileId: string },
): Promise<void> {
  await writeAuditEvent(sql, context, {
    action: "hr.employee_document_downloaded",
    entityType: "hr_employee_document",
    entityId: input.documentId,
    afterState: { privateFileId: input.privateFileId },
  });
}

export function hrEmployeeDocumentContentDisposition(fileName: string): string {
  const safe = fileName.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "employee-document.pdf";
  return `attachment; filename="${safe}"`;
}
