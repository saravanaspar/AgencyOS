import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
  putObject,
  removeObject,
} from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import type { HrDocumentType } from "@/modules/hr/documents";
import { validateAndNormalizeHrTemplateHtml } from "@/modules/hr/server/document-template-compiler";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export const HR_DOCUMENT_TEMPLATE_UPLOAD_MAX_BYTES = 512 * 1024;

export interface StoredHrDocumentTemplate {
  id: string;
  version: number;
  sha256: string;
  storageBucket: string;
  storagePath: string;
}

function safeTemplateFileName(value: string): string {
  const base = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .trim()
    .slice(0, 160);
  return base || "template.html";
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );
}

export async function storeHrDocumentTemplate(input: {
  context: CurrentPermissionContext;
  documentType: HrDocumentType;
  name: string;
  description: string | null;
  fileName: string;
  buffer: Buffer;
}): Promise<StoredHrDocumentTemplate> {
  if (!input.buffer.length || input.buffer.length > HR_DOCUMENT_TEMPLATE_UPLOAD_MAX_BYTES) {
    throw new Error("hr-document-template-size-invalid");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.buffer);
  } catch {
    throw new Error("hr-document-template-encoding-invalid");
  }
  const normalized = validateAndNormalizeHrTemplateHtml(decoded);
  const normalizedBuffer = Buffer.from(normalized.html, "utf8");
  const sha256 = createHash("sha256").update(normalizedBuffer).digest("hex");
  const templateId = randomUUID();
  const organizationId = input.context.membership.organizationId;
  const safeName = safeTemplateFileName(input.fileName).replace(/\.html?$/i, "") || "template";
  const storagePath = `${organizationId}/${templateId}/${randomUUID()}-${safeName}.html`;

  await putObject({
    bucket: OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
    objectName: storagePath,
    body: normalizedBuffer,
    contentType: "text/html; charset=utf-8",
    cacheControl: "private, no-store",
  });

  try {
    return await getDatabaseClient().begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${organizationId + ":hr-document-template:" + input.documentType + ":" + input.name.toLowerCase()}, 0))`;
      const versions = await sql<Array<{ version: number }>>`
        select coalesce(max(version), 0) + 1 as version
        from public.hr_document_templates
        where organization_id = ${organizationId}::uuid
          and document_type = ${input.documentType}
          and lower(name) = lower(${input.name})
      `;
      const version = Number(versions[0]?.version ?? 1);
      await sql`
        insert into public.hr_document_templates (
          id, organization_id, document_type, name, description, version,
          storage_bucket, storage_path, sha256, size_bytes, original_file_name,
          placeholder_keys, created_by_membership_id
        ) values (
          ${templateId}::uuid, ${organizationId}::uuid, ${input.documentType}, ${input.name},
          ${input.description}, ${version}, ${OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET}, ${storagePath},
          ${sha256}, ${normalizedBuffer.length}, ${safeTemplateFileName(input.fileName)},
          ${sql.json(toJsonValue(normalized.placeholders))}, ${input.context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, input.context, {
        action: "hr.document_template_uploaded",
        entityType: "hr_document_template",
        entityId: templateId,
        afterState: {
          documentType: input.documentType,
          name: input.name,
          version,
          sha256,
          placeholderCount: normalized.placeholders.length,
        },
      });
      return {
        id: templateId,
        version,
        sha256,
        storageBucket: OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET,
        storagePath,
      };
    });
  } catch (error) {
    await removeObject(OBJECT_STORAGE_DOCUMENT_TEMPLATE_BUCKET, storagePath).catch(() => undefined);
    if (isUniqueViolation(error)) throw new Error("hr-document-template-version-conflict");
    throw error;
  }
}
