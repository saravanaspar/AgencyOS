import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { scanBufferWithClamav } from "@/integrations/clamav/client";
import {
  putMinioObject,
  readMinioObject,
  removeMinioObject,
} from "@/integrations/minio/object-storage";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { readBoundedResponseText } from "@/lib/server/bounded-response";
import { privateFileRetryDelaySeconds } from "@/modules/private-files/private-files";
import {
  PRIVATE_FILE_CLEAN_BUCKET,
  purgePrivateFileObjects,
  recordPrivateFileEvent,
} from "@/modules/private-files/server/private-files";
import { getPrivateFileScanConfiguration } from "@/modules/private-files/server/scan-config";
import { enqueueNotification } from "@/modules/notifications/server/notifications";

const MAX_FILES_PER_RUN = 20;
const MAX_PURGES_PER_RUN = 20;
const MAX_ATTEMPTS = 5;
const SCAN_CONCURRENCY = 2;
const SCANNER_TIMEOUT_MS = 20_000;
const SCANNER_RESPONSE_LIMIT_BYTES = 8 * 1024;
const STALE_LOCK_MINUTES = 5;

const scannerResponseSchema = z.object({
  verdict: z.enum(["clean", "infected"]),
  engine: z.string().trim().min(1).max(100).optional(),
  signature: z.string().trim().min(1).max(200).optional(),
  reference: z.string().trim().min(1).max(200).optional(),
});

interface ClaimedFileRow {
  id: string;
  lock_token: string;
  organization_id: string;
  uploaded_by_membership_id: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  quarantine_bucket: string;
  quarantine_path: string;
  clean_target_path: string;
  scan_attempt_count: number;
}

interface PurgeRow {
  id: string;
  lock_token: string;
  organization_id: string;
  status: "available" | "rejected" | "deleted";
  quarantine_bucket: string | null;
  quarantine_path: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

interface ScanVerdict {
  verdict: "clean" | "infected";
  engine: string;
  signature?: string;
  reference?: string;
}

export interface PrivateFileScanSummary {
  claimed: number;
  available: number;
  rejected: number;
  retrying: number;
  exhausted: number;
  purged: number;
  purgeRetrying: number;
  skipped: number;
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 6 * 60 * 60);
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), 6 * 60 * 60);
}

async function claimFiles(): Promise<ClaimedFileRow[]> {
  return getDatabaseClient().begin(async (sql) => {
    const rows = await sql<ClaimedFileRow[]>`
      with candidates as (
        select file.id
        from public.private_files as file
        where (
          (
            file.status in ('quarantined', 'scan_failed')
            and coalesce(file.next_scan_at, file.scan_requested_at) <= now()
          )
          or (
            file.status = 'scanning'
            and file.locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute')
          )
        )
          and file.scan_attempt_count < ${MAX_ATTEMPTS}
          and file.deleted_at is null
          and (file.locked_at is null or file.locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute'))
        order by coalesce(file.next_scan_at, file.scan_requested_at), file.created_at, file.id
        for update skip locked
        limit ${MAX_FILES_PER_RUN}
      )
      update public.private_files as file
      set status = 'scanning', locked_at = now(), lock_token = gen_random_uuid(),
          scan_started_at = now(), scan_attempt_count = file.scan_attempt_count + 1,
          scan_error_code = null, updated_at = now()
      from candidates
      where file.id = candidates.id
      returning file.id, file.lock_token, file.organization_id, file.uploaded_by_membership_id,
        file.module_key, file.entity_type, file.entity_id, file.original_file_name,
        file.mime_type, file.size_bytes, file.sha256, file.quarantine_bucket,
        file.quarantine_path, file.clean_target_path, file.scan_attempt_count
    `;
    for (const row of rows) {
      await recordPrivateFileEvent(sql, {
        fileId: row.id,
        organizationId: row.organization_id,
        eventType: "scan.started",
        details: { attempt: row.scan_attempt_count },
      });
    }
    return rows;
  });
}

async function scanWithProvider(row: ClaimedFileRow, buffer: Buffer): Promise<ScanVerdict> {
  const configuration = getPrivateFileScanConfiguration();
  if (!configuration.configured || !configuration.provider || !configuration.scannerUrl) {
    throw new Error("scanner_not_configured");
  }

  if (configuration.provider === "clamav") {
    const endpoint = new URL(configuration.scannerUrl);
    return scanBufferWithClamav({
      host: endpoint.hostname.replace(/^\[|\]$/g, ""),
      port: Number(endpoint.port || 3310),
      buffer,
      timeoutMs: SCANNER_TIMEOUT_MS,
      maxResponseBytes: SCANNER_RESPONSE_LIMIT_BYTES,
    });
  }

  if (!configuration.scannerBearerToken) throw new Error("scanner_not_configured");
  const response = await fetch(configuration.scannerUrl, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(SCANNER_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${configuration.scannerBearerToken}`,
      "content-type": "application/octet-stream",
      "content-length": String(buffer.length),
      "x-agencyos-file-id": row.id,
      "x-agencyos-file-sha256": row.sha256,
      "x-agencyos-file-mime": row.mime_type,
    },
    body: new Uint8Array(buffer),
  });
  const responseText = await readBoundedResponseText(
    response,
    SCANNER_RESPONSE_LIMIT_BYTES,
    "Scanner response exceeded the safe limit.",
  );
  if (!response.ok) {
    const error = new Error(`scanner_http_${response.status}`);
    Reflect.set(error, "retryAfterSeconds", retryAfterSeconds(response.headers.get("retry-after")));
    throw error;
  }
  const parsed = scannerResponseSchema.safeParse(JSON.parse(responseText));
  if (!parsed.success) throw new Error("scanner_invalid_response");
  return {
    verdict: parsed.data.verdict,
    engine: parsed.data.engine ?? "external-scanner",
    signature: parsed.data.signature,
    reference: parsed.data.reference,
  };
}

async function notifyUploader(
  row: ClaimedFileRow,
  input: { title: string; message: string; key: string },
) {
  try {
    await enqueueNotification({
      organizationId: row.organization_id,
      recipientMembershipId: row.uploaded_by_membership_id,
      category: "security_alert",
      severity: "error",
      title: input.title,
      message: input.message,
      deepLink: row.module_key === "projects" ? "/projects" : null,
      sourceModule: "private_files",
      sourceEntityType: "private_file",
      sourceEntityId: row.id,
      dedupeKey: input.key,
      metadata: { moduleKey: row.module_key, entityType: row.entity_type, entityId: row.entity_id },
    });
  } catch {
    console.warn("[AgencyOS] Private-file scan notification could not be queued.");
  }
}

async function markRetry(row: ClaimedFileRow, errorCode: string, requestedDelay?: number) {
  const exhausted = row.scan_attempt_count >= MAX_ATTEMPTS;
  const delay = Math.min(
    Math.max(requestedDelay ?? privateFileRetryDelaySeconds(row.scan_attempt_count), 30),
    6 * 60 * 60,
  );
  const updated = await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      update public.private_files
      set status = 'scan_failed', scan_error_code = ${errorCode.slice(0, 100)},
          next_scan_at = case when ${exhausted} then null else now() + (${delay} * interval '1 second') end,
          scan_completed_at = case when ${exhausted} then now() else scan_completed_at end,
          retention_state = case when ${exhausted} then 'hold' else retention_state end,
          locked_at = null, lock_token = null, updated_at = now()
      where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid and status = 'scanning'
      returning id
    `;
    if (!rows[0]) return false;
    await recordPrivateFileEvent(sql, {
      fileId: row.id,
      organizationId: row.organization_id,
      eventType: exhausted ? "scan.exhausted" : "scan.retry_scheduled",
      details: {
        errorCode: errorCode.slice(0, 100),
        attempt: row.scan_attempt_count,
        delaySeconds: delay,
      },
    });
    return true;
  });
  if (!updated) return "lost" as const;
  if (exhausted) {
    await notifyUploader(row, {
      title: "File scan needs attention",
      message: `The security scan for ${row.original_file_name} could not be completed. The file remains quarantined and cannot be downloaded.`,
      key: `private-file:${row.id}:scan-exhausted`,
    });
  }
  return exhausted ? ("exhausted" as const) : ("retrying" as const);
}

async function rejectFile(
  row: ClaimedFileRow,
  input: { code: string; signature?: string; engine: string },
) {
  const updated = await getDatabaseClient().begin(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      update public.private_files
      set status = 'rejected', retention_state = 'expired', scan_engine = ${input.engine},
          scan_signature = ${input.signature ?? null}, scan_error_code = ${input.code},
          scan_completed_at = now(), purge_after = now(), locked_at = null, lock_token = null,
          next_scan_at = null, updated_at = now()
      where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid and status = 'scanning'
      returning id
    `;
    if (!rows[0]) return false;
    await recordPrivateFileEvent(sql, {
      fileId: row.id,
      organizationId: row.organization_id,
      eventType: "scan.rejected",
      details: { code: input.code, engine: input.engine, signature: input.signature ?? null },
    });
    return true;
  });
  if (!updated) return false;
  await purgePrivateFileObjects({
    fileId: row.id,
    organizationId: row.organization_id,
    quarantineBucket: row.quarantine_bucket,
    quarantinePath: row.quarantine_path,
    storageBucket: null,
    storagePath: null,
  });
  await notifyUploader(row, {
    title: "Unsafe file blocked",
    message: `${row.original_file_name} was blocked by the malware scanner and was not released for download.`,
    key: `private-file:${row.id}:rejected`,
  });
  return true;
}

async function releaseFile(row: ClaimedFileRow, buffer: Buffer, verdict: ScanVerdict) {
  try {
    await putMinioObject({
      bucket: PRIVATE_FILE_CLEAN_BUCKET,
      objectName: row.clean_target_path,
      body: buffer,
      cacheControl: "private, max-age=3600",
      contentType: row.mime_type,
    });
  } catch {
    throw new Error("clean_storage_upload_failed");
  }

  try {
    await getDatabaseClient().begin(async (sql) => {
      const updated = await sql<{ id: string }[]>`
        update public.private_files
        set status = 'available', storage_bucket = ${PRIVATE_FILE_CLEAN_BUCKET},
            storage_path = ${row.clean_target_path}, scan_engine = ${verdict.engine},
            scan_signature = ${verdict.signature ?? null}, scan_provider_reference = ${verdict.reference ?? null},
            scan_error_code = null, scan_completed_at = now(), available_at = now(),
            next_scan_at = null, locked_at = null, lock_token = null, updated_at = now()
        where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid and status = 'scanning'
        returning id
      `;
      if (!updated[0]) throw new Error("private-file-scan-lock-lost");
      await recordPrivateFileEvent(sql, {
        fileId: row.id,
        organizationId: row.organization_id,
        eventType: "scan.clean",
        details: { engine: verdict.engine, providerReference: verdict.reference ?? null },
      });
    });
  } catch (error) {
    await removeMinioObject(PRIVATE_FILE_CLEAN_BUCKET, row.clean_target_path).catch(
      () => undefined,
    );
    throw error;
  }

  let quarantineRemoved = true;
  try {
    await removeMinioObject(row.quarantine_bucket, row.quarantine_path);
  } catch {
    quarantineRemoved = false;
  }
  if (quarantineRemoved) {
    await getDatabaseClient()`
      update public.private_files
      set quarantine_purged_at = coalesce(quarantine_purged_at, now()), purge_after = null,
          updated_at = now()
      where id = ${row.id}::uuid and status = 'available'
    `;
  } else {
    await getDatabaseClient()`
      update public.private_files
      set purge_after = now() + interval '5 minutes', updated_at = now()
      where id = ${row.id}::uuid and status = 'available' and quarantine_purged_at is null
    `;
    console.warn(
      "[AgencyOS] A released file still has a private quarantine copy awaiting cleanup.",
    );
  }
}

async function processFile(
  row: ClaimedFileRow,
): Promise<"available" | "rejected" | "retrying" | "exhausted" | "skipped" | "lost"> {
  try {
    const buffer = await readMinioObject(row.quarantine_bucket, row.quarantine_path);
    if (buffer.length !== row.size_bytes) {
      return (await rejectFile(row, { code: "size_mismatch", engine: "agencyos-integrity" }))
        ? "rejected"
        : "skipped";
    }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== row.sha256) {
      return (await rejectFile(row, { code: "checksum_mismatch", engine: "agencyos-integrity" }))
        ? "rejected"
        : "skipped";
    }

    const verdict = await scanWithProvider(row, buffer);
    if (verdict.verdict === "infected") {
      return (await rejectFile(row, {
        code: "malware_detected",
        signature: verdict.signature,
        engine: verdict.engine,
      }))
        ? "rejected"
        : "skipped";
    }
    await releaseFile(row, buffer, verdict);
    return "available";
  } catch (error) {
    const message = error instanceof Error ? error.message : "scan_failed";
    const delay =
      error && typeof error === "object" && "retryAfterSeconds" in error
        ? Number(Reflect.get(error, "retryAfterSeconds"))
        : undefined;
    return markRetry(row, message, Number.isFinite(delay) ? delay : undefined);
  }
}

async function claimPurgeRows(): Promise<PurgeRow[]> {
  return getDatabaseClient().begin(
    async (sql) => sql<PurgeRow[]>`
    with candidates as (
      select id
      from public.private_files
      where (
          (
            status in ('rejected', 'deleted')
            and purged_at is null
            and coalesce(purge_after, now()) <= now()
          )
          or (
            status = 'available'
            and quarantine_path is not null
            and quarantine_purged_at is null
            and coalesce(purge_after, updated_at) <= now()
          )
        )
        and (locked_at is null or locked_at < now() - (${STALE_LOCK_MINUTES} * interval '1 minute'))
      order by coalesce(purge_after, updated_at), id
      for update skip locked
      limit ${MAX_PURGES_PER_RUN}
    )
    update public.private_files as file
    set locked_at = now(), lock_token = gen_random_uuid(), updated_at = now()
    from candidates
    where file.id = candidates.id
    returning file.id, file.lock_token, file.organization_id, file.status, file.quarantine_bucket,
      file.quarantine_path, file.storage_bucket, file.storage_path
  `,
  );
}

async function processPurge(row: PurgeRow): Promise<boolean> {
  if (row.status === "available") {
    if (!row.quarantine_bucket || !row.quarantine_path) return true;
    let quarantineRemoved = true;
    try {
      await removeMinioObject(row.quarantine_bucket, row.quarantine_path);
    } catch {
      quarantineRemoved = false;
    }
    if (quarantineRemoved) {
      const updated = await getDatabaseClient().begin(async (sql) => {
        const rows = await sql<{ id: string }[]>`
          update public.private_files
          set quarantine_purged_at = coalesce(quarantine_purged_at, now()), purge_after = null,
              locked_at = null, lock_token = null, updated_at = now()
          where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid
            and status = 'available'
          returning id
        `;
        if (!rows[0]) return false;
        await recordPrivateFileEvent(sql, {
          fileId: row.id,
          organizationId: row.organization_id,
          eventType: "file.quarantine_purged",
        });
        return true;
      });
      return updated;
    }
    await getDatabaseClient()`
      update public.private_files
      set locked_at = null, lock_token = null, purge_after = now() + interval '1 hour',
          updated_at = now()
      where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid
    `;
    return false;
  }

  const removed = await purgePrivateFileObjects({
    fileId: row.id,
    organizationId: row.organization_id,
    quarantineBucket: row.quarantine_bucket,
    quarantinePath: row.quarantine_path,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  });
  if (removed) return true;
  await getDatabaseClient()`
    update public.private_files
    set locked_at = null, lock_token = null, purge_after = now() + interval '1 hour', updated_at = now()
    where id = ${row.id}::uuid and lock_token = ${row.lock_token}::uuid
  `;
  return false;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
}

export async function runPrivateFileScanWorker(): Promise<PrivateFileScanSummary> {
  const files = await claimFiles();
  const results = await mapWithConcurrency(files, SCAN_CONCURRENCY, processFile);
  const purgeRows = await claimPurgeRows();
  const purgeResults = await mapWithConcurrency(purgeRows, SCAN_CONCURRENCY, processPurge);

  return {
    claimed: files.length,
    available: results.filter((result) => result === "available").length,
    rejected: results.filter((result) => result === "rejected").length,
    retrying: results.filter((result) => result === "retrying").length,
    exhausted: results.filter((result) => result === "exhausted").length,
    purged: purgeResults.filter(Boolean).length,
    purgeRetrying: purgeResults.filter((result) => !result).length,
    skipped: results.filter((result) => result === "skipped" || result === "lost").length,
  };
}
