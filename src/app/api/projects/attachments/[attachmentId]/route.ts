import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import type { PrivateFileStatus } from "@/modules/private-files/private-files";
import {
  purgePrivateFileObjects,
  recordPrivateFileEvent,
  softDeletePrivateFile,
} from "@/modules/private-files/server/private-files";
import { projectPermissionKeys } from "@/modules/projects/projects";
import { attachmentContentDisposition } from "@/modules/projects/server/project-attachments";
import { writeProjectAuditEvent } from "@/modules/projects/server/project-audit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ attachmentId: string }> };
const attachmentIdSchema = z.uuid();

interface AttachmentRow {
  id: string;
  private_file_id: string;
  project_id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  file_status: PrivateFileStatus;
  storage_bucket: string | null;
  storage_path: string | null;
  quarantine_bucket: string | null;
  quarantine_path: string | null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

async function getAttachment(
  attachmentId: string,
  permissionKey: string,
  options: { writableOnly?: boolean } = {},
): Promise<
  | { allowed: false; response: NextResponse }
  | { allowed: true; row: AttachmentRow; context: CurrentPermissionContext }
> {
  const authorization = await authorizeCurrentUser([permissionKey]);
  if (!authorization.allowed) {
    return {
      allowed: false,
      response: jsonError(
        authorization.reason === "signed-out"
          ? "Sign in before accessing task attachments."
          : "You do not have permission to access this attachment.",
        authorization.reason === "signed-out" ? 401 : 403,
      ),
    };
  }

  const database = getDatabaseClient();
  const scope = authorization.context.permissionScopes.get(permissionKey) ?? "own";
  const rows = await database<AttachmentRow[]>`
    select attachment.id, attachment.private_file_id, attachment.project_id, attachment.task_id,
      attachment.file_name, attachment.mime_type, attachment.size_bytes, attachment.sha256,
      private_file.status as file_status, private_file.storage_bucket, private_file.storage_path,
      private_file.quarantine_bucket, private_file.quarantine_path
    from public.project_task_attachments as attachment
    join public.private_files as private_file on private_file.id = attachment.private_file_id
    join public.project_tasks as task on task.id = attachment.task_id
    join public.projects as project on project.id = task.project_id
    where attachment.id = ${attachmentId}::uuid
      and attachment.organization_id = ${authorization.context.membership.organizationId}::uuid
      and private.project_is_visible(
        task.project_id,
        ${authorization.context.membership.id}::uuid,
        ${scope}
      )
      and (
        ${options.writableOnly ?? false} = false
        or (project.archived_at is null and project.closure_status <> 'closed')
      )
    limit 1
  `;
  const row = rows[0];
  if (!row || row.file_status === "deleted") {
    return { allowed: false, response: jsonError("Attachment was not found.", 404) };
  }
  return { allowed: true, row, context: authorization.context };
}

export async function GET(_request: Request, context: RouteContext) {
  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Attachment was not found.", 404);

  try {
    const result = await getAttachment(parsed.data, projectPermissionKeys.taskView);
    if (!result.allowed) return result.response;
    if (result.row.file_status === "rejected") {
      return jsonError("This attachment was blocked by the malware scanner.", 410);
    }
    if (result.row.file_status !== "available") {
      return jsonError("This attachment is still quarantined for security scanning.", 409);
    }
    if (!result.row.storage_bucket || !result.row.storage_path) {
      return jsonError("Attachment was not found.", 404);
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readObject(result.row.storage_bucket, result.row.storage_path, {
        maxBytes: result.row.size_bytes + 1,
      });
    } catch {
      return jsonError("Attachment was not found.", 404);
    }
    if (
      fileBuffer.length !== result.row.size_bytes ||
      createHash("sha256").update(fileBuffer).digest("hex") !== result.row.sha256
    ) {
      return jsonError("Attachment integrity check failed.", 409);
    }

    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: result.row.private_file_id,
        organizationId: result.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: result.context.membership.id,
        details: { moduleKey: "projects", taskId: result.row.task_id },
      });
      await writeProjectAuditEvent(sql, result.context, {
        action: "project.task.attachment.downloaded",
        entityType: "project_task_attachment",
        entityId: result.row.id,
        afterState: {
          taskId: result.row.task_id,
          projectId: result.row.project_id,
          fileName: result.row.file_name,
          sizeBytes: result.row.size_bytes,
        },
      });
    });

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": attachmentContentDisposition(result.row.file_name),
        "content-length": String(result.row.size_bytes),
        "content-security-policy": "sandbox; default-src 'none'",
        "content-type": result.row.mime_type || "application/octet-stream",
        "x-content-type-options": "nosniff",
        "x-download-options": "noopen",
      },
    });
  } catch {
    return jsonError("The attachment could not be downloaded.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin attachment deletion is not allowed.", 403);
  }

  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Attachment was not found.", 404);

  try {
    const result = await getAttachment(parsed.data, projectPermissionKeys.taskUpdate, {
      writableOnly: true,
    });
    if (!result.allowed) return result.response;

    const objectLocations = await getDatabaseClient().begin(async (sql) => {
      const deletedRows = await sql<{ private_file_id: string }[]>`
        delete from public.project_task_attachments
        where id = ${result.row.id}::uuid
        returning private_file_id
      `;
      if (!deletedRows[0]) throw new Error("attachment-not-found");

      const locations = await softDeletePrivateFile(sql, {
        fileId: result.row.private_file_id,
        organizationId: result.context.membership.organizationId,
        actorMembershipId: result.context.membership.id,
      });
      await writeProjectAuditEvent(sql, result.context, {
        action: "project.task.attachment.deleted",
        entityType: "project_task_attachment",
        entityId: result.row.id,
        beforeState: {
          taskId: result.row.task_id,
          projectId: result.row.project_id,
          fileName: result.row.file_name,
          mimeType: result.row.mime_type,
          sizeBytes: result.row.size_bytes,
          scanStatus: result.row.file_status,
        },
      });
      return locations;
    });

    const purged = await purgePrivateFileObjects({
      fileId: result.row.private_file_id,
      organizationId: result.context.membership.organizationId,
      ...objectLocations,
    });
    if (!purged) console.warn("[AgencyOS] Deleted private-file objects are queued for cleanup.");

    revalidatePath("/projects");
    return NextResponse.json(
      { ok: true, message: "Attachment removed." },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return jsonError("The attachment could not be removed.", 500);
  }
}
