import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { financePermissionKeys } from "@/modules/finance/finance";
import {
  downloadFinanceSnapshotBytes,
  financeSnapshotContentDisposition,
  getFinanceDocumentSnapshot,
} from "@/modules/finance/server/document-snapshots";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ snapshotId: string }> };
const snapshotIdSchema = z.uuid();

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { ok: false, message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const snapshotId = snapshotIdSchema.safeParse((await routeContext.params).snapshotId);
  if (!snapshotId.success) return jsonError("Finance document was not found.", 404);

  const documentAuthorization = await authorizeCurrentUser([
    financePermissionKeys.documentDownload,
  ]);
  if (!documentAuthorization.allowed) {
    return jsonError(
      documentAuthorization.reason === "signed-out"
        ? "Sign in before downloading finance documents."
        : "You do not have permission to download finance documents.",
      documentAuthorization.reason === "signed-out" ? 401 : 403,
    );
  }

  try {
    const snapshot = await getFinanceDocumentSnapshot(
      documentAuthorization.context.membership.organizationId,
      snapshotId.data,
    );
    if (!snapshot) return jsonError("Finance document was not found.", 404);

    const viewPermission =
      snapshot.entityType === "estimate"
        ? financePermissionKeys.estimateView
        : snapshot.entityType === "invoice"
          ? financePermissionKeys.invoiceView
          : financePermissionKeys.creditNoteView;
    const sourceAuthorization = await authorizeCurrentUser([viewPermission]);
    if (!sourceAuthorization.allowed) {
      return jsonError("Finance document was not found.", 404);
    }

    const bytes = await downloadFinanceSnapshotBytes(snapshot);
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: snapshot.privateFileId,
        organizationId: documentAuthorization.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: documentAuthorization.context.membership.id,
        details: {
          moduleKey: "finance",
          snapshotId: snapshot.id,
          entityType: snapshot.entityType,
          entityId: snapshot.entityId,
          documentNumber: snapshot.documentNumber,
          versionNumber: snapshot.versionNumber,
        },
      });
      await writeAuditEvent(sql, documentAuthorization.context, {
        action: "finance.document.downloaded",
        entityType: "finance_document_snapshot",
        entityId: snapshot.id,
        afterState: {
          sourceEntityType: snapshot.entityType,
          sourceEntityId: snapshot.entityId,
          documentNumber: snapshot.documentNumber,
          versionNumber: snapshot.versionNumber,
          privateFileId: snapshot.privateFileId,
        },
      });
    });

    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": financeSnapshotContentDisposition(snapshot.fileName),
        "content-length": String(snapshot.sizeBytes),
        "content-security-policy": "sandbox; default-src 'none'",
        "content-type": snapshot.mimeType,
        "x-content-type-options": "nosniff",
        "x-download-options": "noopen",
      },
    });
  } catch (error) {
    console.warn("[AgencyOS] Finance document download failed.", {
      code: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("The finance document could not be downloaded.", 500);
  }
}
