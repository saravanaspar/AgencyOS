import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  getAuthorizedLeaveRequest,
  leaveAttachmentContentDisposition,
} from "@/modules/hr/server/leave-attachments";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  purgePrivateFileObjects,
  recordPrivateFileEvent,
  softDeletePrivateFile,
} from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ attachmentId: string }> };
const attachmentIdSchema = z.uuid();

interface AttachmentRow {
  id: string;
  leave_request_id: string;
  private_file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  file_status: string;
  storage_bucket: string | null;
  storage_path: string | null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

async function findAttachment(organizationId: string, attachmentId: string) {
  const rows = await getDatabaseClient()<AttachmentRow[]>`
    select attachment.id, attachment.leave_request_id, attachment.private_file_id,
      attachment.file_name, attachment.mime_type, attachment.size_bytes, attachment.sha256,
      private_file.status as file_status, private_file.storage_bucket, private_file.storage_path
    from public.hr_leave_request_attachments as attachment
    join public.private_files as private_file on private_file.id = attachment.private_file_id
    where attachment.id = ${attachmentId}::uuid
      and attachment.organization_id = ${organizationId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading leave evidence."
        : "You cannot download leave evidence.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Leave evidence was not found.", 404);

  try {
    const row = await findAttachment(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Leave evidence was not found.", 404);
    const leaveRequest = await getAuthorizedLeaveRequest(
      authorization.context,
      row.leave_request_id,
      hrPermissionKeys.leaveRequestView,
    );
    if (!leaveRequest) return jsonError("Leave evidence was not found.", 404);
    if (row.file_status === "rejected")
      return jsonError("This file was blocked by the malware scanner.", 410);
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This file is still awaiting security scanning.", 409);
    }

    const expectedSize = Number(row.size_bytes);
    const bytes = await readObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("hr-leave-attachment-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("hr-leave-attachment-integrity-mismatch");
    }

    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: authorization.context.membership.id,
        details: { leaveRequestId: row.leave_request_id, attachmentId: row.id },
      });
      await writeAuditEvent(sql, authorization.context, {
        action: "hr.leave_attachment_downloaded",
        entityType: "hr_leave_attachment",
        entityId: row.id,
        afterState: { leaveRequestId: row.leave_request_id, privateFileId: row.private_file_id },
      });
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": leaveAttachmentContentDisposition(row.file_name),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError("Leave evidence could not be downloaded.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin leave attachment deletion is not allowed.", 403);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
    hrPermissionKeys.leaveRequestCreate,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before removing leave evidence."
        : "You cannot remove leave evidence.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Leave evidence was not found.", 404);

  try {
    const database = getDatabaseClient();
    const row = await findAttachment(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Leave evidence was not found.", 404);
    const leaveRequest = await getAuthorizedLeaveRequest(
      authorization.context,
      row.leave_request_id,
      hrPermissionKeys.leaveRequestCreate,
      { ownOnly: true, draftOnly: true },
    );
    if (!leaveRequest) return jsonError("Only draft leave evidence can be removed.", 409);

    const locations = await database.begin(async (sql) => {
      await sql`
        delete from public.hr_leave_request_attachments
        where id = ${row.id}::uuid
          and organization_id = ${authorization.context.membership.organizationId}::uuid
      `;
      const objectLocations = await softDeletePrivateFile(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        actorMembershipId: authorization.context.membership.id,
      });
      await writeAuditEvent(sql, authorization.context, {
        action: "hr.leave_attachment_removed",
        entityType: "hr_leave_attachment",
        entityId: row.id,
        beforeState: { leaveRequestId: row.leave_request_id, fileName: row.file_name },
      });
      return objectLocations;
    });
    await purgePrivateFileObjects({
      fileId: row.private_file_id,
      organizationId: authorization.context.membership.organizationId,
      ...locations,
    }).catch(() => false);
    revalidatePath("/hr");
    return NextResponse.json(
      { ok: true, message: "Leave evidence removed." },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return jsonError("Leave evidence could not be removed.", 500);
  }
}
