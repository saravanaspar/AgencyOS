import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  FINANCE_ATTACHMENT_MAX_BYTES,
  FINANCE_ATTACHMENT_POLICY,
  financeAttachmentValidationMessage,
  getAuthorizedFinanceInvoice,
} from "@/modules/finance/server/finance-attachments";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;
type RouteContext = { params: Promise<{ invoiceId: string }> };
const invoiceIdSchema = z.uuid();

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin invoice attachment uploads are not allowed.", 403);
  }

  const authorization = await authorizeCurrentUser([
    financePermissionKeys.invoiceView,
    financePermissionKeys.invoiceAttachmentManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading an invoice attachment."
        : "You do not have permission to manage invoice attachments.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsedInvoiceId = invoiceIdSchema.safeParse((await context.params).invoiceId);
  if (!parsedInvoiceId.success) return jsonError("Invoice was not found.", 404);

  try {
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (contentLength > FINANCE_ATTACHMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      return jsonError("Invoice attachments are limited to 10 MB.", 413);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Choose a file to upload.");

    const database = getDatabaseClient();
    const invoice = await getAuthorizedFinanceInvoice(
      database,
      authorization.context,
      parsedInvoiceId.data,
      { writableOnly: true },
    );
    if (!invoice) return jsonError("Invoice was not found or no longer accepts attachments.", 404);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createQuarantinedPrivateFile({
      organizationId: invoice.organizationId,
      uploadedByMembershipId: authorization.context.membership.id,
      moduleKey: "finance",
      entityType: "finance_invoice",
      entityId: invoice.id,
      classification: "confidential",
      file,
      buffer,
      policy: FINANCE_ATTACHMENT_POLICY,
      accessRules: {
        viewPermission: financePermissionKeys.invoiceView,
        managePermission: financePermissionKeys.invoiceAttachmentManage,
      },
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.displayNumber },
      link: async (sql, privateFile) => {
        const attachmentRows = await sql<Array<{ id: string }>>`
          insert into public.finance_invoice_attachments (
            organization_id, invoice_id, private_file_id, file_name, mime_type,
            size_bytes, sha256, uploaded_by_membership_id
          ) values (
            ${invoice.organizationId}::uuid, ${invoice.id}::uuid, ${privateFile.id}::uuid,
            ${privateFile.fileName}, ${privateFile.mimeType}, ${privateFile.sizeBytes},
            ${privateFile.sha256}, ${authorization.context.membership.id}::uuid
          )
          returning id
        `;
        const attachmentId = attachmentRows[0]?.id;
        if (!attachmentId) throw new Error("finance-attachment-link-failed");
        await sql`
          insert into public.finance_invoice_events (
            organization_id, invoice_id, event_type, event_data, actor_membership_id
          ) values (
            ${invoice.organizationId}::uuid, ${invoice.id}::uuid, 'attachment_added',
            ${sql.json({ attachmentId, privateFileId: privateFile.id, fileName: privateFile.fileName })},
            ${authorization.context.membership.id}::uuid
          )
        `;
        await writeAuditEvent(sql, authorization.context, {
          action: "finance.invoice.attachment_quarantined",
          entityType: "finance_invoice_attachment",
          entityId: attachmentId,
          afterState: {
            invoiceId: invoice.id,
            privateFileId: privateFile.id,
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
              ? "This exact file is already attached to the invoice."
              : "This exact file is already quarantined for security scanning.",
        },
        {
          status: blocked ? 409 : 200,
          headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
        },
      );
    }

    revalidatePath("/finance");
    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        status: "quarantined",
        message: "Invoice attachment uploaded and queued for malware scanning.",
      },
      {
        status: 202,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  } catch (error) {
    const validationMessage = financeAttachmentValidationMessage(error);
    if (validationMessage) {
      return jsonError(validationMessage, validationMessage.includes("10 MB") ? 413 : 400);
    }
    return jsonError("The invoice attachment could not be uploaded.", 500);
  }
}
