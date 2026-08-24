import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";
import { projectPermissionKeys } from "@/modules/projects/projects";
import {
  getAuthorizedAttachmentTask,
  privateFileValidationMessage,
  PROJECT_ATTACHMENT_MAX_BYTES,
  PROJECT_ATTACHMENT_POLICY,
} from "@/modules/projects/server/project-attachments";
import { writeProjectAuditEvent } from "@/modules/projects/server/project-audit";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;
type RouteContext = { params: Promise<{ taskId: string }> };
const taskIdSchema = z.uuid();

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin attachment uploads are not allowed.", 403);
  }

  const authorization = await authorizeCurrentUser([projectPermissionKeys.taskUpdate]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading an attachment."
        : "You do not have permission to add task attachments.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsedTaskId = taskIdSchema.safeParse((await context.params).taskId);
  if (!parsedTaskId.success) return jsonError("Task was not found.", 404);

  try {
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (contentLength > PROJECT_ATTACHMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      return jsonError("Attachments are limited to 10 MB.", 413);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Choose a file to upload.");

    const database = getDatabaseClient();
    const task = await getAuthorizedAttachmentTask(
      database,
      authorization.context,
      parsedTaskId.data,
      projectPermissionKeys.taskUpdate,
      { writableOnly: true },
    );
    if (!task) return jsonError("Task was not found, is read-only, or is outside your scope.", 404);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createQuarantinedPrivateFile({
      organizationId: task.organizationId,
      uploadedByMembershipId: authorization.context.membership.id,
      moduleKey: "projects",
      entityType: "project_task",
      entityId: task.id,
      classification: "internal",
      file,
      buffer,
      policy: PROJECT_ATTACHMENT_POLICY,
      accessRules: {
        viewPermission: projectPermissionKeys.taskView,
        updatePermission: projectPermissionKeys.taskUpdate,
      },
      metadata: { projectId: task.projectId, taskId: task.id },
      link: async (sql, privateFile) => {
        await sql`
          insert into public.project_task_attachments (
            organization_id, project_id, task_id, private_file_id, storage_path, file_name,
            mime_type, size_bytes, sha256, uploaded_by_membership_id
          ) values (
            ${task.organizationId}::uuid, ${task.projectId}::uuid, ${task.id}::uuid,
            ${privateFile.id}::uuid, ${privateFile.quarantinePath}, ${privateFile.fileName},
            ${privateFile.mimeType}, ${privateFile.sizeBytes}, ${privateFile.sha256},
            ${authorization.context.membership.id}::uuid
          )
        `;
        await writeProjectAuditEvent(sql, authorization.context, {
          action: "project.task.attachment.quarantined",
          entityType: "project_task_attachment",
          entityId: privateFile.id,
          afterState: {
            taskId: task.id,
            projectId: task.projectId,
            fileName: privateFile.fileName,
            mimeType: privateFile.mimeType,
            sizeBytes: privateFile.sizeBytes,
            sha256: privateFile.sha256,
            scanStatus: "quarantined",
          },
        });
      },
    });

    if (!result.created) {
      const blocked = result.duplicate.status === "rejected";
      return NextResponse.json(
        {
          ok: !blocked,
          duplicate: true,
          message: blocked
            ? "This exact file was previously blocked by the malware scanner."
            : result.duplicate.status === "available"
              ? "This exact file is already attached."
              : "This exact file is already quarantined for security scanning.",
        },
        {
          status: blocked ? 409 : 200,
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
        },
      );
    }

    revalidatePath("/projects");
    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        status: "quarantined",
        message: "File uploaded to quarantine and queued for malware scanning.",
      },
      {
        status: 202,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  } catch (error) {
    const validationMessage = privateFileValidationMessage(error);
    if (validationMessage) {
      return jsonError(validationMessage, validationMessage.includes("10 MB") ? 413 : 400);
    }
    return jsonError("The attachment could not be uploaded.", 500);
  }
}
