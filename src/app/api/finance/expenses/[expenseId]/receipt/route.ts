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
  getAuthorizedFinanceExpense,
} from "@/modules/finance/server/finance-attachments";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { createQuarantinedPrivateFile } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;
type RouteContext = { params: Promise<{ expenseId: string }> };
const expenseIdSchema = z.uuid();

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin expense receipt uploads are not allowed.", 403);
  }

  const authorization = await authorizeCurrentUser([
    financePermissionKeys.expenseView,
    financePermissionKeys.expenseReceiptManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading an expense receipt."
        : "You do not have permission to manage expense receipts.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsedExpenseId = expenseIdSchema.safeParse((await context.params).expenseId);
  if (!parsedExpenseId.success) return jsonError("Expense was not found.", 404);

  try {
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (contentLength > FINANCE_ATTACHMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      return jsonError("Expense receipts are limited to 10 MB.", 413);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Choose a receipt to upload.");

    const database = getDatabaseClient();
    const expense = await getAuthorizedFinanceExpense(
      database,
      authorization.context,
      parsedExpenseId.data,
      financePermissionKeys.expenseReceiptManage,
      { mutableOnly: true },
    );
    if (!expense) return jsonError("Expense was not found or no longer accepts receipts.", 404);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createQuarantinedPrivateFile({
      organizationId: expense.organizationId,
      uploadedByMembershipId: authorization.context.membership.id,
      moduleKey: "finance",
      entityType: "finance_expense",
      entityId: expense.id,
      classification: "confidential",
      file,
      buffer,
      policy: FINANCE_ATTACHMENT_POLICY,
      accessRules: {
        viewPermission: financePermissionKeys.expenseView,
        managePermission: financePermissionKeys.expenseReceiptManage,
      },
      metadata: { expenseId: expense.id, expenseType: expense.expenseType },
      link: async (sql, privateFile) => {
        const receiptRows = await sql<Array<{ id: string }>>`
          insert into public.finance_expense_receipts (
            organization_id, expense_id, private_file_id, file_name, mime_type,
            size_bytes, sha256, uploaded_by_membership_id
          ) values (
            ${expense.organizationId}::uuid, ${expense.id}::uuid, ${privateFile.id}::uuid,
            ${privateFile.fileName}, ${privateFile.mimeType}, ${privateFile.sizeBytes},
            ${privateFile.sha256}, ${authorization.context.membership.id}::uuid
          )
          returning id
        `;
        const receiptId = receiptRows[0]?.id;
        if (!receiptId) throw new Error("finance-expense-receipt-link-failed");
        await sql`
          insert into public.finance_expense_events (
            organization_id, expense_id, event_type, event_data, actor_membership_id
          ) values (
            ${expense.organizationId}::uuid, ${expense.id}::uuid, 'receipt_added',
            ${sql.json({ receiptId, privateFileId: privateFile.id, fileName: privateFile.fileName })},
            ${authorization.context.membership.id}::uuid
          )
        `;
        await writeAuditEvent(sql, authorization.context, {
          action: "finance.expense.receipt_quarantined",
          entityType: "finance_expense_receipt",
          entityId: receiptId,
          afterState: {
            expenseId: expense.id,
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
            ? "This exact receipt was previously blocked by the malware scanner."
            : result.duplicate.status === "available"
              ? "This exact receipt is already attached to the expense."
              : "This exact receipt is already quarantined for security scanning.",
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
        message: "Expense receipt uploaded and queued for malware scanning.",
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
    return jsonError("The expense receipt could not be uploaded.", 500);
  }
}
