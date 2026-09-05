import "server-only";

import { randomUUID } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import {
  OBJECT_STORAGE_PRIVATE_BUCKET,
  OBJECT_STORAGE_QUARANTINE_BUCKET,
  putObject,
  removeObject,
} from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import type {
  PrivateFileClassification,
  PrivateFileStatus,
} from "@/modules/private-files/private-files";
import {
  buildPrivateFileStoragePaths,
  normalizePrivateFileName,
  privateFileDigest,
  type PrivateFilePolicy,
  validatePrivateFileCandidate,
  validatePrivateFileContent,
} from "@/modules/private-files/server/file-policy";

export const PRIVATE_FILE_QUARANTINE_BUCKET = OBJECT_STORAGE_QUARANTINE_BUCKET;
export const PRIVATE_FILE_CLEAN_BUCKET = OBJECT_STORAGE_PRIVATE_BUCKET;

const MAX_METADATA_BYTES = 8 * 1024;
type QuerySql = Sql | TransactionSql;

export interface PrivateFileRow {
  id: string;
  organization_id: string;
  uploaded_by_membership_id: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  classification: PrivateFileClassification;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  version: number;
  status: PrivateFileStatus;
  quarantine_bucket: string | null;
  quarantine_path: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  scan_attempt_count: number;
  scan_error_code: string | null;
  scan_signature: string | null;
  next_scan_at: Date | null;
  available_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

export interface PrivateFileLinkRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  quarantinePath: string;
}

export type CreatePrivateFileResult =
  { created: true; file: PrivateFileLinkRecord } | { created: false; duplicate: PrivateFileRow };

interface CreatePrivateFileInput {
  organizationId: string;
  uploadedByMembershipId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  classification?: PrivateFileClassification;
  file: File;
  buffer: Buffer;
  policy: PrivateFilePolicy;
  accessRules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  link: (sql: TransactionSql, file: PrivateFileLinkRecord) => Promise<void>;
}

function boundedJsonObject(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const normalized = value ?? {};
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("private-file-metadata-too-large");
  }
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );
}

async function findDuplicate(input: {
  organizationId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  sha256: string;
}): Promise<PrivateFileRow | null> {
  const rows = await getDatabaseClient()<PrivateFileRow[]>`
    select *
    from public.private_files
    where organization_id = ${input.organizationId}::uuid
      and module_key = ${input.moduleKey}
      and entity_type = ${input.entityType}
      and entity_id = ${input.entityId}::uuid
      and sha256 = ${input.sha256}
      and status <> 'deleted'
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createQuarantinedPrivateFile(
  input: CreatePrivateFileInput,
): Promise<CreatePrivateFileResult> {
  const candidateError = validatePrivateFileCandidate(input.file, input.policy);
  if (candidateError) throw new Error(`private-file-invalid:${candidateError}`);
  if (input.file.size !== input.buffer.length) throw new Error("private-file-size-mismatch");

  const contentError = validatePrivateFileContent(input.file.type, input.buffer);
  if (contentError) throw new Error(`private-file-invalid:${contentError}`);

  const fileName = normalizePrivateFileName(input.file.name);
  const sha256 = privateFileDigest(input.buffer);
  const duplicate = await findDuplicate({
    organizationId: input.organizationId,
    moduleKey: input.moduleKey,
    entityType: input.entityType,
    entityId: input.entityId,
    sha256,
  });
  if (duplicate) return { created: false, duplicate };

  const fileId = randomUUID();
  const paths = buildPrivateFileStoragePaths({
    organizationId: input.organizationId,
    fileId,
    fileName,
  });
  const accessRules = boundedJsonObject(input.accessRules);
  const metadata = boundedJsonObject(input.metadata);
  try {
    await putObject({
      bucket: PRIVATE_FILE_QUARANTINE_BUCKET,
      objectName: paths.quarantinePath,
      body: input.buffer,
      cacheControl: "private, no-store",
      contentType: "application/octet-stream",
    });
  } catch {
    throw new Error("private-file-quarantine-upload-failed");
  }

  const linkRecord: PrivateFileLinkRecord = {
    id: fileId,
    fileName,
    mimeType: input.file.type,
    sizeBytes: input.file.size,
    sha256,
    quarantinePath: paths.quarantinePath,
  };

  try {
    await getDatabaseClient().begin(async (sql) => {
      await sql`
        insert into public.private_files (
          id, organization_id, uploaded_by_membership_id, module_key, entity_type, entity_id,
          classification, original_file_name, mime_type, size_bytes, sha256,
          quarantine_bucket, quarantine_path, clean_target_path, access_rules, metadata
        ) values (
          ${fileId}::uuid, ${input.organizationId}::uuid, ${input.uploadedByMembershipId}::uuid,
          ${input.moduleKey}, ${input.entityType}, ${input.entityId}::uuid,
          ${input.classification ?? "internal"}, ${fileName}, ${input.file.type},
          ${input.file.size}, ${sha256}, ${PRIVATE_FILE_QUARANTINE_BUCKET},
          ${paths.quarantinePath}, ${paths.cleanPath}, ${sql.json(toJsonValue(accessRules))},
          ${sql.json(toJsonValue(metadata))}
        )
      `;
      await recordPrivateFileEvent(sql, {
        fileId,
        organizationId: input.organizationId,
        eventType: "file.quarantined",
        actorMembershipId: input.uploadedByMembershipId,
        details: {
          moduleKey: input.moduleKey,
          entityType: input.entityType,
          entityId: input.entityId,
          mimeType: input.file.type,
          sizeBytes: input.file.size,
          sha256,
        },
      });
      await input.link(sql, linkRecord);
    });
  } catch (error) {
    await removeObject(PRIVATE_FILE_QUARANTINE_BUCKET, paths.quarantinePath).catch(() => undefined);
    if (isUniqueViolation(error)) {
      const racedDuplicate = await findDuplicate({
        organizationId: input.organizationId,
        moduleKey: input.moduleKey,
        entityType: input.entityType,
        entityId: input.entityId,
        sha256,
      });
      if (racedDuplicate) return { created: false, duplicate: racedDuplicate };
    }
    throw error;
  }

  return { created: true, file: linkRecord };
}

export async function recordPrivateFileEvent(
  sql: QuerySql,
  input: {
    fileId: string;
    organizationId: string;
    eventType: string;
    actorMembershipId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into public.private_file_events (
      file_id, organization_id, event_type, actor_membership_id, details
    ) values (
      ${input.fileId}::uuid, ${input.organizationId}::uuid, ${input.eventType},
      ${input.actorMembershipId ?? null}::uuid, ${sql.json(toJsonValue(boundedJsonObject(input.details)))}
    )
  `;
}

export async function softDeletePrivateFile(
  sql: TransactionSql,
  input: { fileId: string; organizationId: string; actorMembershipId: string },
): Promise<{
  quarantineBucket: string | null;
  quarantinePath: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}> {
  const rows = await sql<
    Array<{
      quarantine_bucket: string | null;
      quarantine_path: string | null;
      storage_bucket: string | null;
      storage_path: string | null;
    }>
  >`
    update public.private_files
    set status = 'deleted', retention_state = 'deleted', deleted_at = now(), purge_after = now(),
        locked_at = null, lock_token = null, next_scan_at = null, updated_at = now()
    where id = ${input.fileId}::uuid
      and organization_id = ${input.organizationId}::uuid
      and status <> 'deleted'
    returning quarantine_bucket, quarantine_path, storage_bucket, storage_path
  `;
  const row = rows[0];
  if (!row) throw new Error("private-file-not-found");

  await recordPrivateFileEvent(sql, {
    fileId: input.fileId,
    organizationId: input.organizationId,
    eventType: "file.deleted",
    actorMembershipId: input.actorMembershipId,
  });

  return {
    quarantineBucket: row.quarantine_bucket,
    quarantinePath: row.quarantine_path,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  };
}

export async function purgePrivateFileObjects(input: {
  fileId: string;
  organizationId: string;
  quarantineBucket: string | null;
  quarantinePath: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}): Promise<boolean> {
  const objects = [
    input.quarantineBucket && input.quarantinePath
      ? { bucket: input.quarantineBucket, path: input.quarantinePath }
      : null,
    input.storageBucket && input.storagePath
      ? { bucket: input.storageBucket, path: input.storagePath }
      : null,
  ].filter((value): value is { bucket: string; path: string } => Boolean(value));

  let removed = true;
  for (const object of objects) {
    try {
      await removeObject(object.bucket, object.path);
    } catch {
      removed = false;
    }
  }
  if (!removed) return false;

  await getDatabaseClient().begin(async (sql) => {
    await sql`
      update public.private_files
      set purged_at = coalesce(purged_at, now()), locked_at = null, lock_token = null,
          updated_at = now()
      where id = ${input.fileId}::uuid and organization_id = ${input.organizationId}::uuid
    `;
    await recordPrivateFileEvent(sql, {
      fileId: input.fileId,
      organizationId: input.organizationId,
      eventType: "file.objects_purged",
    });
  });
  return true;
}
