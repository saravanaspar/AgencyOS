import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readMinioObject } from "@/integrations/minio/object-storage";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  getAuthorizedHrEmployeeDocument,
  hrEmployeeDocumentContentDisposition,
  recordHrEmployeeDocumentDownload,
} from "@/modules/hr/server/hr-document-service";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ documentId: string }> };
const documentIdSchema = z.uuid();

interface DocumentFileRow {
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

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.employeeDocumentView,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading employee documents."
        : "You cannot download employee documents.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const parsed = documentIdSchema.safeParse((await context.params).documentId);
  if (!parsed.success) return jsonError("Document was not found.", 404);

  try {
    const contextValue = authorization.context;
    const authorized = await getAuthorizedHrEmployeeDocument(contextValue, parsed.data);
    if (!authorized) return jsonError("Document was not found.", 404);
    const rows = await getDatabaseClient()<DocumentFileRow[]>`
      select document.id, document.private_file_id, document.original_file_name,
        file.mime_type, file.size_bytes, file.sha256, file.status as file_status,
        file.storage_bucket, file.storage_path
      from public.hr_employee_documents as document
      join public.private_files as file on file.id = document.private_file_id
      where document.id = ${parsed.data}::uuid
        and document.organization_id = ${contextValue.membership.organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) return jsonError("Document was not found.", 404);
    if (row.file_status === "rejected") {
      return jsonError("This document was blocked by the malware scanner.", 410);
    }
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This document is still awaiting security scanning.", 409);
    }
    const expectedSize = Number(row.size_bytes);
    const bytes = await readMinioObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("hr-document-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("hr-document-integrity-mismatch");
    }
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: contextValue.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: contextValue.membership.id,
        details: { employeeDocumentId: row.id },
      });
      await recordHrEmployeeDocumentDownload(sql, contextValue, {
        documentId: row.id,
        privateFileId: row.private_file_id,
      });
    });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": hrEmployeeDocumentContentDisposition(row.original_file_name),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError("Document could not be downloaded.", 500);
  }
}
