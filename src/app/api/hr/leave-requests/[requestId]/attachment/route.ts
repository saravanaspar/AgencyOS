import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  getAuthorizedLeaveRequest,
  HR_LEAVE_ATTACHMENT_MAX_BYTES,
  HR_LEAVE_ATTACHMENT_POLICY,
  leaveAttachmentValidationMessage,
} from "@/modules/hr/server/leave-attachments";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

const requestIdSchema = z.uuid();
const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;
type RouteContext = { params: Promise<{ requestId: string }> };

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin leave attachment uploads are not allowed.", 403);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
    hrPermissionKeys.leaveRequestCreate,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading leave evidence."
        : "You cannot upload leave evidence.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsedRequestId = requestIdSchema.safeParse((await context.params).requestId);
  if (!parsedRequestId.success) return jsonError("Leave request was not found.", 404);

  try {
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (contentLength > HR_LEAVE_ATTACHMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      return jsonError("Leave evidence is limited to 10 MB.", 413);
    }

    const leaveRequest = await getAuthorizedLeaveRequest(
      authorization.context,
      parsedRequestId.data,
      hrPermissionKeys.leaveRequestCreate,
      { ownOnly: true, draftOnly: true },
    );
    if (!leaveRequest) return jsonError("Only your draft leave request accepts evidence.", 409);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Choose a leave evidence file.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createQuarantinedPrivateFile({
      organizationId: leaveRequest.organizationId,
      uploadedByMembershipId: authorization.context.membership.id,
      moduleKey: "hr",
      entityType: "hr_leave_request",
      entityId: leaveRequest.id,
      classification: "restricted",
      file,
      buffer,
      policy: HR_LEAVE_ATTACHMENT_POLICY,
      accessRules: {
        viewPermission: hrPermissionKeys.leaveRequestView,
        managePermission: hrPermissionKeys.leaveRequestCreate,
      },
      metadata: { leaveRequestId: leaveRequest.id, membershipId: leaveRequest.membershipId },
      link: async (sql, privateFile) => {
        const rows = await sql<Array<{ id: string }>>`
          insert into public.hr_leave_request_attachments (
            organization_id, leave_request_id, private_file_id, file_name, mime_type,
            size_bytes, sha256, uploaded_by_membership_id
          ) values (
            ${leaveRequest.organizationId}::uuid, ${leaveRequest.id}::uuid,
            ${privateFile.id}::uuid, ${privateFile.fileName}, ${privateFile.mimeType},
            ${privateFile.sizeBytes}, ${privateFile.sha256},
            ${authorization.context.membership.id}::uuid
          )
          returning id
        `;
        if (!rows[0]) throw new Error("hr-leave-attachment-link-failed");
        await writeAuditEvent(sql, authorization.context, {
          action: "hr.leave_attachment_quarantined",
          entityType: "hr_leave_attachment",
          entityId: rows[0].id,
          afterState: {
            leaveRequestId: leaveRequest.id,
            privateFileId: privateFile.id,
            fileName: privateFile.fileName,
            sizeBytes: privateFile.sizeBytes,
          },
        });
      },
    });

    if (!result.created) {
      return NextResponse.json(
        {
          ok: result.duplicate.status !== "rejected",
          duplicate: true,
          message:
            result.duplicate.status === "rejected"
              ? "This exact file was previously blocked by the malware scanner."
              : "This exact file is already attached or awaiting scanning.",
        },
        {
          status: result.duplicate.status === "rejected" ? 409 : 200,
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
        },
      );
    }

    revalidatePath("/hr");
    return NextResponse.json(
      { ok: true, status: "quarantined", message: "Evidence uploaded for security scanning." },
      {
        status: 202,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  } catch (error) {
    const validationMessage = leaveAttachmentValidationMessage(error);
    if (validationMessage) {
      return jsonError(validationMessage, validationMessage.includes("10 MB") ? 413 : 400);
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      Reflect.get(error, "code") === "23505"
    ) {
      return jsonError("This draft already has an attachment. Remove it before replacing it.", 409);
    }
    return jsonError("Leave evidence could not be uploaded.", 500);
  }
}
