import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { documentPermissionKeys } from "@/modules/documents/documents";
import {
  DocumentAccessError,
  recordDocumentEvent,
  requireDocumentAccess,
} from "@/modules/documents/server/documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  normalizePrivateFileName,
  privateFileContentDisposition,
} from "@/modules/private-files/server/file-policy";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string; versionId: string }> };
const idSchema = z.uuid();
const previewMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "text/csv",
]);

interface VersionFileRow {
  version_id: string;
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

function inlineDisposition(fileName: string): string {
  const safe = normalizePrivateFileName(fileName).replace(/["\\]/g, "-");
  return `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(request: Request, routeContext: RouteContext) {
  const authorization = await authorizeCurrentUser([
    documentPermissionKeys.workspace,
    documentPermissionKeys.download,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before opening documents."
        : "You cannot open documents.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const params = await routeContext.params;
  const documentId = idSchema.safeParse(params.documentId);
  const versionId = idSchema.safeParse(params.versionId);
  if (!documentId.success || !versionId.success)
    return jsonError("Document version was not found.", 404);
  const context = authorization.context;
  try {
    await requireDocumentAccess(context, documentId.data, "download");
    const rows = await getDatabaseClient()<VersionFileRow[]>`
      select version.id as version_id, version.private_file_id, file.original_file_name,
        file.mime_type, file.size_bytes, file.sha256, file.status as file_status,
        file.storage_bucket, file.storage_path
      from public.document_versions as version
      join public.private_files as file on file.id = version.private_file_id
      where version.id = ${versionId.data}::uuid
        and version.document_id = ${documentId.data}::uuid
        and version.organization_id = ${context.membership.organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) return jsonError("Document version was not found.", 404);
    if (row.file_status === "rejected")
      return jsonError("This file was blocked by the malware scanner.", 410);
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This file is still awaiting security scanning.", 409);
    }
    const expectedSize = Number(row.size_bytes);
    const bytes = await readObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("document-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("document-integrity-mismatch");
    }
    const requestedPreview = new URL(request.url).searchParams.get("mode") === "preview";
    const preview = requestedPreview && previewMimeTypes.has(row.mime_type);
    const eventType = preview ? "document.previewed" : "document.downloaded";
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: context.membership.organizationId,
        eventType: preview ? "file.previewed" : "file.downloaded",
        actorMembershipId: context.membership.id,
        details: { documentId: documentId.data, versionId: row.version_id },
      });
      await recordDocumentEvent(sql, context, {
        documentId: documentId.data,
        versionId: row.version_id,
        eventType,
        details: { sha256: row.sha256, mimeType: row.mime_type },
      });
      await writeAuditEvent(sql, context, {
        action: eventType,
        entityType: "document",
        entityId: documentId.data,
        metadata: { versionId: row.version_id, sha256: row.sha256 },
      });
    });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": preview
          ? inlineDisposition(row.original_file_name)
          : privateFileContentDisposition(row.original_file_name),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return jsonError("Document version was not found.", 404);
    }
    return jsonError("Document version could not be opened.", 500);
  }
}
