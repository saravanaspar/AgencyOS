import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readMinioObject } from "@/integrations/minio/object-storage";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  financeAttachmentContentDisposition,
  getAuthorizedFinanceExpense,
} from "@/modules/finance/server/finance-attachments";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  purgePrivateFileObjects,
  recordPrivateFileEvent,
  softDeletePrivateFile,
} from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ receiptId: string }> };
const receiptIdSchema = z.uuid();

interface ReceiptRow {
  id: string;
  expense_id: string;
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
}

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

async function findReceipt(organizationId: string, receiptId: string) {
  const rows = await getDatabaseClient()<ReceiptRow[]>`
    select receipt.id, receipt.expense_id, receipt.private_file_id, receipt.file_name,
      receipt.mime_type, receipt.size_bytes, receipt.sha256,
      private_file.status as file_status, private_file.storage_bucket, private_file.storage_path,
      private_file.quarantine_bucket, private_file.quarantine_path
    from public.finance_expense_receipts as receipt
    join public.private_files as private_file on private_file.id = receipt.private_file_id
    where receipt.id = ${receiptId}::uuid
      and receipt.organization_id = ${organizationId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser([financePermissionKeys.expenseView]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading an expense receipt."
        : "You do not have permission to download expense receipts.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsed = receiptIdSchema.safeParse((await context.params).receiptId);
  if (!parsed.success) return jsonError("Expense receipt was not found.", 404);

  try {
    const row = await findReceipt(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Expense receipt was not found.", 404);
    const expense = await getAuthorizedFinanceExpense(
      getDatabaseClient(),
      authorization.context,
      row.expense_id,
      financePermissionKeys.expenseView,
    );
    if (!expense) return jsonError("Expense receipt was not found.", 404);
    if (row.file_status === "rejected") {
      return jsonError("This receipt was blocked by the malware scanner.", 410);
    }
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This receipt is still awaiting security scanning.", 409);
    }

    const expectedSize = Number(row.size_bytes);
    const bytes = await readMinioObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("finance-expense-receipt-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("finance-expense-receipt-integrity-mismatch");
    }

    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: authorization.context.membership.id,
        details: { expenseId: row.expense_id, receiptId: row.id },
      });
      await writeAuditEvent(sql, authorization.context, {
        action: "finance.expense.receipt_downloaded",
        entityType: "finance_expense_receipt",
        entityId: row.id,
        afterState: { expenseId: row.expense_id, privateFileId: row.private_file_id },
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
    return jsonError("The expense receipt could not be downloaded.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin expense receipt deletion is not allowed.", 403);
  }
  const authorization = await authorizeCurrentUser([
    financePermissionKeys.expenseView,
    financePermissionKeys.expenseReceiptManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before removing an expense receipt."
        : "You do not have permission to remove expense receipts.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  const parsed = receiptIdSchema.safeParse((await context.params).receiptId);
  if (!parsed.success) return jsonError("Expense receipt was not found.", 404);

  try {
    const database = getDatabaseClient();
    const row = await findReceipt(authorization.context.membership.organizationId, parsed.data);
    if (!row) return jsonError("Expense receipt was not found.", 404);
    const expense = await getAuthorizedFinanceExpense(
      database,
      authorization.context,
      row.expense_id,
      financePermissionKeys.expenseReceiptManage,
      { mutableOnly: true },
    );
    if (!expense) return jsonError("This expense receipt is now immutable.", 409);

    const objectLocations = await database.begin(async (sql) => {
      const deletedRows = await sql<Array<{ private_file_id: string }>>`
        delete from public.finance_expense_receipts
        where id = ${row.id}::uuid
          and organization_id = ${authorization.context.membership.organizationId}::uuid
        returning private_file_id
      `;
      if (!deletedRows[0]) throw new Error("finance-expense-receipt-not-found");
      const locations = await softDeletePrivateFile(sql, {
        fileId: row.private_file_id,
        organizationId: authorization.context.membership.organizationId,
        actorMembershipId: authorization.context.membership.id,
      });
      await sql`
        insert into public.finance_expense_events (
          organization_id, expense_id, event_type, event_data, actor_membership_id
        ) values (
          ${authorization.context.membership.organizationId}::uuid,
          ${row.expense_id}::uuid,
          'receipt_removed',
          ${sql.json({ receiptId: row.id, fileName: row.file_name })},
          ${authorization.context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, authorization.context, {
        action: "finance.expense.receipt_removed",
        entityType: "finance_expense_receipt",
        entityId: row.id,
        beforeState: { expenseId: row.expense_id, fileName: row.file_name },
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
      { ok: true, message: "Expense receipt removed." },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    return jsonError("The expense receipt could not be removed.", 500);
  }
}
