import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  getAuthorizedHrSupportingDocument,
  recordHrSupportingDocumentDownload,
} from "@/modules/hr/server/supporting-documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { privateFileContentDisposition } from "@/modules/private-files/server/file-policy";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ documentId: string }> };
const documentIdSchema = z.uuid();

interface SupportingDocumentFileRow {
  id: string;
  private_file_id: string;
  original_file_name: string;
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

export async function GET(_request: Request, routeContext: RouteContext) {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.supportingDocumentView,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading supporting documents."
        : "You cannot download supporting documents.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const parsed = documentIdSchema.safeParse((await routeContext.params).documentId);
  if (!parsed.success) return jsonError("Supporting document was not found.", 404);

  try {
    const context = authorization.context;
    const authorized = await getAuthorizedHrSupportingDocument(context, parsed.data);
    if (!authorized) return jsonError("Supporting document was not found.", 404);
    const rows = await getDatabaseClient()<SupportingDocumentFileRow[]>`
      select document.id, document.private_file_id, file.original_file_name,
        file.mime_type, file.size_bytes, file.sha256, file.status as file_status,
        file.storage_bucket, file.storage_path
      from public.hr_employee_supporting_documents as document
      join public.private_files as file on file.id = document.private_file_id
      where document.id = ${parsed.data}::uuid
        and document.organization_id = ${context.membership.organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) return jsonError("Supporting document was not found.", 404);
    if (row.file_status === "rejected") {
      return jsonError("This document was blocked by the malware scanner.", 410);
    }
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This document is still awaiting security scanning.", 409);
    }
    const expectedSize = Number(row.size_bytes);
    const bytes = await readObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("hr-supporting-document-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("hr-supporting-document-integrity-mismatch");
    }
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: context.membership.id,
        details: { supportingDocumentId: row.id },
      });
      await recordHrSupportingDocumentDownload(sql, context, {
        documentId: row.id,
        privateFileId: row.private_file_id,
      });
    });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": privateFileContentDisposition(row.original_file_name),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError("Supporting document could not be downloaded.", 500);
  }
}
