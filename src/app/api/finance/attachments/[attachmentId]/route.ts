import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import { financeAttachmentContentDisposition } from "@/modules/finance/server/finance-attachments";
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
  invoice_id: string;
  invoice_number: string;
  private_file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  file_status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  quarantine_bucket: string | null;
  quarantine_path: string | null;
  issued_at: Date | null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

async function findAttachment(organizationId: string, attachmentId: string) {
  const rows = await getDatabaseClient()<AttachmentRow[]>`
    select attachment.id, attachment.invoice_id,
      coalesce(invoice.invoice_number, invoice.draft_reference) as invoice_number,
      attachment.private_file_id, attachment.file_name, attachment.mime_type,
      attachment.size_bytes, attachment.sha256, invoice.issued_at,
      private_file.status as file_status, private_file.storage_bucket, private_file.storage_path,
      private_file.quarantine_bucket, private_file.quarantine_path
    from public.finance_invoice_attachments as attachment
    join public.finance_invoices as invoice on invoice.id = attachment.invoice_id
    join public.private_files as private_file on private_file.id = attachment.private_file_id
    where attachment.id = ${attachmentId}::uuid
      and attachment.organization_id = ${organizationId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.invoiceView,
    financePermissionKeys.documentDownload,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading an invoice attachment."
        : "You do not have permission to download invoice attachments.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Attachment was not found.", 404);

  try {
    const row = await findAttachment(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Attachment was not found.", 404);
    if (row.file_status === "rejected") {
      return jsonError("This attachment was blocked by the malware scanner.", 410);
    }
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This attachment is still awaiting security scanning.", 409);
    }

    const expectedSize = Number(row.size_bytes);
    const bytes = await readObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("finance-attachment-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("finance-attachment-integrity-mismatch");
    }

    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: authorization.context.membership.id,
        details: { invoiceId: row.invoice_id, attachmentId: row.id },
      });
      await writeAuditEvent(sql, authorization.context, {
        action: "finance.invoice.attachment_downloaded",
        entityType: "finance_invoice_attachment",
        entityId: row.id,
        afterState: { invoiceId: row.invoice_id, privateFileId: row.private_file_id },
      });
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": financeAttachmentContentDisposition(row.file_name),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError("The invoice attachment could not be downloaded.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin invoice attachment deletion is not allowed.", 403);
  }
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.invoiceView,
    financePermissionKeys.invoiceAttachmentManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before removing an invoice attachment."
        : "You do not have permission to remove invoice attachments.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsed = attachmentIdSchema.safeParse((await context.params).attachmentId);
  if (!parsed.success) return jsonError("Attachment was not found.", 404);

  try {
    const database = getDatabaseClient();
    const row = await findAttachment(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Attachment was not found.", 404);
    if (row.issued_at) {
      return jsonError("Attachments on an issued invoice are immutable.", 409);
    }

    const objectLocations = await database.begin(async (sql) => {
      const deletedRows = await sql<Array<{ private_file_id: string }>>`
        delete from public.finance_invoice_attachments
        where id = ${row.id}::uuid
          and organization_id = ${authorization.context.membership.organizationId}::uuid
        returning private_file_id
      `;
      if (!deletedRows[0]) throw new Error("finance-attachment-not-found");
      const locations = await softDeletePrivateFile(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        actorMembershipId: authorization.context.membership.id,
      });
      await sql`
        insert into public.finance_invoice_events (
          organization_id, invoice_id, event_type, event_data, actor_membership_id
        ) values (
          ${authorization.context.membership.organizationId}::uuid, ${row.invoice_id}::uuid,
          'attachment_removed', ${sql.json({ attachmentId: row.id, fileName: row.file_name })},
          ${authorization.context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, authorization.context, {
        action: "finance.invoice.attachment_removed",
        entityType: "finance_invoice_attachment",
        entityId: row.id,
        beforeState: { invoiceId: row.invoice_id, fileName: row.file_name },
      });
      return locations;
    });

    await purgePrivateFileObjects({
      fileId: row.private_file_id,
      organizationId: authorization.context.membership.organizationId,
      ...objectLocations,
    }).catch(() => false);
    revalidatePath("/finance");
    return NextResponse.json(
      { ok: true, message: "Invoice attachment removed." },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return jsonError("The invoice attachment could not be removed.", 500);
  }
}
