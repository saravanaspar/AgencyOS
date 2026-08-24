import "server-only";

import type { Sql, TransactionSql } from "postgres";

import type { PermissionScope } from "@/modules/permissions/permission-scopes";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  normalizePrivateFileName,
  privateFileContentDisposition,
  privateFileDigest,
  type PrivateFilePolicy,
  validatePrivateFileCandidate,
  validatePrivateFileContent,
} from "@/modules/private-files/server/file-policy";

export const PROJECT_ATTACHMENT_BUCKET = "project-attachments";
export const PROJECT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const PROJECT_ATTACHMENT_POLICY: PrivateFilePolicy = {
  maxBytes: PROJECT_ATTACHMENT_MAX_BYTES,
  allowedMimeTypes: new Map([
    ["image/png", new Set([".png"])],
    ["image/jpeg", new Set([".jpg", ".jpeg"])],
    ["application/pdf", new Set([".pdf"])],
    ["text/plain", new Set([".txt"])],
    ["text/csv", new Set([".csv"])],
  ]),
  description: "Only PNG, JPEG, PDF, TXT, and CSV attachments are accepted.",
};

type QuerySql = Sql | TransactionSql;

export interface AuthorizedAttachmentTask {
  id: string;
  projectId: string;
  projectCode: string;
  organizationId: string;
}

function scopeFor(context: CurrentPermissionContext, permissionKey: string): PermissionScope {
  return context.permissionScopes.get(permissionKey) ?? "own";
}

export const normalizeAttachmentFileName = normalizePrivateFileName;
export const attachmentDigest = privateFileDigest;
export const attachmentContentDisposition = privateFileContentDisposition;

export function validateAttachmentFile(file: File): string | null {
  const error = validatePrivateFileCandidate(file, PROJECT_ATTACHMENT_POLICY);
  return error === "Files are limited to 10 MB." ? "Attachments are limited to 10 MB." : error;
}

export function validateAttachmentContent(file: File, buffer: Buffer): string | null {
  return validatePrivateFileContent(file.type, buffer);
}

export function privateFileValidationMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.startsWith("private-file-invalid:")) return null;
  return error.message.slice("private-file-invalid:".length);
}

export async function getAuthorizedAttachmentTask(
  sql: QuerySql,
  context: CurrentPermissionContext,
  taskId: string,
  permissionKey: string,
  options: { writableOnly?: boolean } = {},
): Promise<AuthorizedAttachmentTask | null> {
  const rows = await sql<
    Array<{
      id: string;
      project_id: string;
      project_code: string;
      organization_id: string;
    }>
  >`
    select task.id, task.project_id, project.code as project_code, task.organization_id
    from public.project_tasks as task
    join public.projects as project on project.id = task.project_id
    where task.id = ${taskId}::uuid
      and task.organization_id = ${context.membership.organizationId}::uuid
      and private.project_is_visible(
        task.project_id,
        ${context.membership.id}::uuid,
        ${scopeFor(context, permissionKey)}
      )
      and (
        ${options.writableOnly ?? false} = false
        or (project.archived_at is null and project.closure_status <> 'closed')
      )
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        projectCode: row.project_code,
        organizationId: row.organization_id,
      }
    : null;
}
