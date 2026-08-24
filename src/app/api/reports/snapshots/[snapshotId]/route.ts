import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { getRequestSecurityContextFromRequest } from "@/lib/server/request-context";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";
import { reportsPermissionKeys } from "@/modules/reports/reports";
import {
  downloadReportSnapshotBytes,
  getReportSnapshot,
  reportSnapshotContentDisposition,
} from "@/modules/reports/server/report-snapshots";
import { authorizedRateLimitAllows } from "@/modules/security/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ snapshotId: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { ok: false, message },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request, routeContext: RouteContext) {
  const snapshotId = z.uuid().safeParse((await routeContext.params).snapshotId);
  if (!snapshotId.success) return jsonError("Report snapshot was not found.", 404);
  const authorization = await authorizeCurrentUser([
    reportsPermissionKeys.workspace,
    reportsPermissionKeys.snapshotDownload,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading report snapshots."
        : "You do not have permission to download report snapshots.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const rateAllowed = await authorizedRateLimitAllows({
    kind: "export",
    context: authorization.context,
    request: getRequestSecurityContextFromRequest(request),
  });
  if (!rateAllowed) {
    return NextResponse.json(
      { ok: false, message: "Too many download requests." },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": "60",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  try {
    const snapshot = await getReportSnapshot(
      authorization.context.membership.organizationId,
      authorization.context.membership.id,
      snapshotId.data,
    );
    if (!snapshot) return jsonError("Report snapshot was not found.", 404);
    const bytes = await downloadReportSnapshotBytes(snapshot);
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: snapshot.privateFileId,
        organizationId: authorization.context.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: authorization.context.membership.id,
        details: {
          moduleKey: "reports",
          snapshotId: snapshot.id,
          savedViewId: snapshot.savedViewId,
          format: snapshot.format,
        },
      });
      await writeAuditEvent(sql, authorization.context, {
        action: "reports.snapshot.downloaded",
        entityType: "report_snapshot",
        entityId: snapshot.id,
        source: "api",
        metadata: {
          savedViewId: snapshot.savedViewId,
          format: snapshot.format,
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
        "content-disposition": reportSnapshotContentDisposition(snapshot.fileName),
        "content-length": String(snapshot.sizeBytes),
        "content-security-policy": "sandbox; default-src 'none'",
        "content-type": snapshot.mimeType,
        "x-content-type-options": "nosniff",
        "x-download-options": "noopen",
      },
    });
  } catch {
    return jsonError("The report snapshot could not be downloaded.", 500);
  }
}
