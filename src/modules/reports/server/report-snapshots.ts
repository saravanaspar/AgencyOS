import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { putObject, readObject, removeObject } from "@/integrations/object-storage/client";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { renderHtmlToPdf } from "@/lib/server/html-to-pdf";
import { toJsonValue } from "@/lib/server/json-value";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";
import {
  PRIVATE_FILE_CLEAN_BUCKET,
  recordPrivateFileEvent,
} from "@/modules/private-files/server/private-files";
import {
  buildPrivateFileStoragePaths,
  privateFileContentDisposition,
} from "@/modules/private-files/server/file-policy";
import {
  buildReportDocument,
  buildReportDocumentCsv,
  buildReportDocumentHtml,
} from "@/modules/reports/report-document";
import type { ReportSnapshotFormat } from "@/modules/reports/reports";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import { getSavedReportViewForContext } from "@/modules/reports/server/report-studio";
import { getReportsWorkspaceDataForContext } from "@/modules/reports/server/reports";

export interface StoredReportSnapshot {
  id: string;
  savedViewId: string;
  ownerMembershipId: string;
  privateFileId: string;
  format: ReportSnapshotFormat;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageBucket: string;
  storagePath: string;
  generatedAt: string;
}

interface SnapshotStorageRow {
  id: string;
  saved_view_id: string;
  owner_membership_id: string;
  private_file_id: string;
  format: ReportSnapshotFormat;
  original_file_name: string;
  mime_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_bucket: string;
  storage_path: string;
  generated_at: Date;
}

function safeFileStem(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || "agencyos-report";
}

function mapStoredSnapshot(row: SnapshotStorageRow): StoredReportSnapshot {
  return {
    id: row.id,
    savedViewId: row.saved_view_id,
    ownerMembershipId: row.owner_membership_id,
    privateFileId: row.private_file_id,
    format: row.format,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    generatedAt: row.generated_at.toISOString(),
  };
}

export async function generateReportSnapshot(
  context: CurrentPermissionContext,
  input: {
    savedViewId: string;
    format: ReportSnapshotFormat;
    scheduleId?: string | null;
    scheduledFor?: Date | null;
    systemDelivery?: boolean;
  },
): Promise<StoredReportSnapshot> {
  if (!context.permissions.has(reportsPermissionKeys.snapshotCreate) && !input.systemDelivery) {
    throw new Error("report-snapshot-permission-denied");
  }
  if (input.systemDelivery && (!input.scheduleId || !input.scheduledFor)) {
    throw new Error("report-snapshot-system-delivery-invalid");
  }
  const database = getDatabaseClient();
  const view = await getSavedReportViewForContext(database, context, input.savedViewId, {
    scheduleId: input.systemDelivery ? input.scheduleId : null,
  });
  if (!view) throw new Error("report-view-not-found");
  if (view.section === "hr" && !context.permissions.has(hrPermissionKeys.reportExport)) {
    throw new Error("hr-export-permission-required");
  }
  if (input.scheduleId && input.scheduledFor) {
    const existing = await database<SnapshotStorageRow[]>`
      select snapshot.id, snapshot.saved_view_id, snapshot.owner_membership_id,
        snapshot.private_file_id, snapshot.format, file.original_file_name, file.mime_type,
        file.size_bytes, file.sha256, file.storage_bucket, file.storage_path, snapshot.generated_at
      from public.report_snapshots as snapshot
      join public.private_files as file on file.id = snapshot.private_file_id
      where snapshot.organization_id = ${context.membership.organizationId}::uuid
        and snapshot.owner_membership_id = ${context.membership.id}::uuid
        and snapshot.schedule_id = ${input.scheduleId}::uuid
        and snapshot.scheduled_for = ${input.scheduledFor}::timestamptz
        and file.status = 'available'
      limit 1
    `;
    if (existing[0]) return mapStoredSnapshot(existing[0]);
  }
  const reportResult = await getReportsWorkspaceDataForContext(context, view.filters, {
    widgetKeys: view.widgetKeys,
    savedViewId: view.id,
  });
  if (!reportResult.allowed) throw new Error("report-source-permission-denied");
  if (!reportResult.data.capabilities.sections.includes(view.section)) {
    throw new Error("report-source-permission-denied");
  }
  const data = reportResult.data;
  const document = buildReportDocument(data);
  const extension = input.format === "pdf" ? "pdf" : "csv";
  const mimeType = input.format === "pdf" ? "application/pdf" : "text/csv";
  const bytes =
    input.format === "pdf"
      ? await renderHtmlToPdf({
          html: buildReportDocumentHtml(data, view.name),
          pageSize: "A4",
          landscape: true,
        })
      : Buffer.from(buildReportDocumentCsv(data), "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const snapshotId = randomUUID();
  const privateFileId = randomUUID();
  const fileName = `${safeFileStem(view.name)}-${data.filters.to}.${extension}`;
  const paths = buildPrivateFileStoragePaths({
    organizationId: context.membership.organizationId,
    fileId: privateFileId,
    fileName,
  });
  let uploaded = false;
  try {
    await putObject({
      bucket: PRIVATE_FILE_CLEAN_BUCKET,
      objectName: paths.cleanPath,
      body: bytes,
      cacheControl: "private, no-store",
      contentType: mimeType,
    });
    uploaded = true;
    const rows = await database.begin(async (sql) => {
      await sql`
        insert into public.private_files (
          id, organization_id, uploaded_by_membership_id, module_key, entity_type, entity_id,
          classification, original_file_name, mime_type, size_bytes, sha256, status,
          clean_target_path, storage_bucket, storage_path, access_rules, metadata,
          scan_attempt_count, scan_engine, scan_signature, scan_requested_at,
          scan_completed_at, next_scan_at, available_at
        ) values (
          ${privateFileId}::uuid, ${context.membership.organizationId}::uuid,
          ${context.membership.id}::uuid, 'reports', 'report_snapshot', ${snapshotId}::uuid,
          'confidential', ${fileName}, ${mimeType}, ${bytes.length}, ${digest}, 'available',
          ${paths.cleanPath}, ${PRIVATE_FILE_CLEAN_BUCKET}, ${paths.cleanPath},
          ${sql.json(toJsonValue({ viewPermission: reportsPermissionKeys.snapshotDownload, ownerMembershipId: context.membership.id }))},
          ${sql.json(toJsonValue({ savedViewId: view.id, section: view.section, format: input.format, generated: true }))},
          0, 'agencyos-generated', 'reports-snapshot-v1', now(), now(), null, now()
        )
      `;
      await recordPrivateFileEvent(sql, {
        fileId: privateFileId,
        organizationId: context.membership.organizationId,
        eventType: "file.generated",
        actorMembershipId: context.membership.id,
        details: {
          moduleKey: "reports",
          savedViewId: view.id,
          section: view.section,
          format: input.format,
        },
      });
      const snapshotRows = await sql<SnapshotStorageRow[]>`
        insert into public.report_snapshots (
          id, organization_id, saved_view_id, schedule_id, scheduled_for, owner_membership_id,
          private_file_id, format, report_name, section, period_from, period_to,
          source_hash, row_count
        ) values (
          ${snapshotId}::uuid, ${context.membership.organizationId}::uuid, ${view.id}::uuid,
          ${input.scheduleId ?? null}::uuid, ${input.scheduledFor ?? null}::timestamptz,
          ${context.membership.id}::uuid,
          ${privateFileId}::uuid, ${input.format}, ${view.name}, ${view.section},
          ${data.filters.from}::date, ${data.filters.to}::date, ${digest}, ${document.rowCount}
        )
        returning id, saved_view_id, owner_membership_id, private_file_id, format,
          ${fileName}::text as original_file_name, ${mimeType}::text as mime_type,
          ${bytes.length}::bigint as size_bytes, ${digest}::text as sha256,
          ${PRIVATE_FILE_CLEAN_BUCKET}::text as storage_bucket,
          ${paths.cleanPath}::text as storage_path, generated_at
      `;
      await writeAuditEvent(sql, context, {
        action: "reports.snapshot.generated",
        entityType: "report_snapshot",
        entityId: snapshotId,
        afterState: {
          savedViewId: view.id,
          section: view.section,
          format: input.format,
          rowCount: document.rowCount,
          privateFileId,
          scheduled: Boolean(input.scheduleId),
        },
        changedFields: ["report_snapshot"],
      });
      return snapshotRows;
    });
    const stored = rows[0];
    if (!stored) throw new Error("report-snapshot-not-stored");
    uploaded = false;
    return mapStoredSnapshot(stored);
  } finally {
    if (uploaded) {
      await removeObject(PRIVATE_FILE_CLEAN_BUCKET, paths.cleanPath).catch(() => undefined);
    }
  }
}

export async function getReportSnapshot(
  organizationId: string,
  membershipId: string,
  snapshotId: string,
): Promise<StoredReportSnapshot | null> {
  const rows = await getDatabaseClient()<SnapshotStorageRow[]>`
    select snapshot.id, snapshot.saved_view_id, snapshot.owner_membership_id,
      snapshot.private_file_id, snapshot.format, file.original_file_name, file.mime_type,
      file.size_bytes, file.sha256, file.storage_bucket, file.storage_path, snapshot.generated_at
    from public.report_snapshots as snapshot
    join public.private_files as file on file.id = snapshot.private_file_id
    where snapshot.id = ${snapshotId}::uuid
      and snapshot.organization_id = ${organizationId}::uuid
      and snapshot.owner_membership_id = ${membershipId}::uuid
      and file.status = 'available'
    limit 1
  `;
  return rows[0] ? mapStoredSnapshot(rows[0]) : null;
}

export async function downloadReportSnapshotBytes(snapshot: StoredReportSnapshot): Promise<Buffer> {
  const bytes = await readObject(snapshot.storageBucket, snapshot.storagePath, {
    maxBytes: snapshot.sizeBytes + 1,
  });
  if (bytes.length !== snapshot.sizeBytes) throw new Error("report-snapshot-size-mismatch");
  if (createHash("sha256").update(bytes).digest("hex") !== snapshot.sha256) {
    throw new Error("report-snapshot-integrity-mismatch");
  }
  return bytes;
}

export const reportSnapshotContentDisposition = privateFileContentDisposition;
