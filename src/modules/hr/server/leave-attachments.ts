import "server-only";

import type { Sql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  privateFileContentDisposition,
  type PrivateFilePolicy,
} from "@/modules/private-files/server/file-policy";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const HR_LEAVE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_LEAVE_ATTACHMENT_POLICY: PrivateFilePolicy = {
  maxBytes: HR_LEAVE_ATTACHMENT_MAX_BYTES,
  description: "Use a PDF, JPEG, or PNG file up to 10 MB.",
  allowedMimeTypes: new Map([
    ["application/pdf", new Set([".pdf"])],
    ["image/jpeg", new Set([".jpg", ".jpeg"])],
    ["image/png", new Set([".png"])],
  ]),
};

export interface AuthorizedLeaveRequest {
  id: string;
  organizationId: string;
  membershipId: string;
  status: string;
}

export async function getAuthorizedLeaveRequest(
  context: CurrentPermissionContext,
  requestId: string,
  permissionKey: string,
  options: { ownOnly?: boolean; draftOnly?: boolean } = {},
  database: Sql = getDatabaseClient(),
): Promise<AuthorizedLeaveRequest | null> {
  const scope = context.permissionScopes.get(permissionKey) ?? "own";
  const rows = await database<
    Array<{
      id: string;
      organization_id: string;
      membership_id: string;
      status: string;
    }>
  >`
    select request.id, request.organization_id, request.membership_id, request.status
    from public.hr_leave_requests as request
    where request.id = ${requestId}::uuid
      and request.organization_id = ${context.membership.organizationId}::uuid
      and (${options.ownOnly ?? false} = false or request.membership_id = ${context.membership.id}::uuid)
      and (${options.draftOnly ?? false} = false or request.status = 'draft')
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, request.membership_id, request.membership_id
      )
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        membershipId: row.membership_id,
        status: row.status,
      }
    : null;
}

export function leaveAttachmentValidationMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  if (!message.startsWith("private-file-invalid:")) return null;
  return message.slice("private-file-invalid:".length);
}

export const leaveAttachmentContentDisposition = privateFileContentDisposition;
