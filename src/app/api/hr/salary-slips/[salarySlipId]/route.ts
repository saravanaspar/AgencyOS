import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readMinioObject } from "@/integrations/minio/object-storage";
import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  getAuthorizedSalarySlip,
  recordSalarySlipDownload,
  salarySlipContentDisposition,
} from "@/modules/hr/server/salary-slip-service";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import { recordPrivateFileEvent } from "@/modules/private-files/server/private-files";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ salarySlipId: string }> };
const salarySlipIdSchema = z.uuid();

interface SalarySlipFileRow {
  id: string;
  private_file_id: string;
  original_file_name: string | null;
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
    hrPermissionKeys.salarySlipView,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before downloading salary slips."
        : "You cannot download salary slips.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const parsed = salarySlipIdSchema.safeParse((await context.params).salarySlipId);
  if (!parsed.success) return jsonError("Salary slip was not found.", 404);

  try {
    const contextValue = authorization.context;
    const authorized = await getAuthorizedSalarySlip(contextValue, parsed.data);
    if (!authorized) return jsonError("Salary slip was not found.", 404);
    const rows = await getDatabaseClient()<SalarySlipFileRow[]>`
      select slip.id, slip.private_file_id, slip.original_file_name,
        file.mime_type, file.size_bytes, file.sha256, file.status as file_status,
        file.storage_bucket, file.storage_path
      from public.hr_salary_slips as slip
      join public.private_files as file on file.id = slip.private_file_id
      where slip.id = ${parsed.data}::uuid
        and slip.organization_id = ${contextValue.membership.organizationId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) return jsonError("Salary slip was not found.", 404);
    if (row.file_status === "rejected") {
      return jsonError("This salary slip was blocked by the malware scanner.", 410);
    }
    if (row.file_status !== "available" || !row.storage_bucket || !row.storage_path) {
      return jsonError("This salary slip is still awaiting security scanning.", 409);
    }
    const expectedSize = Number(row.size_bytes);
    const bytes = await readMinioObject(row.storage_bucket, row.storage_path, {
      maxBytes: expectedSize + 1,
    });
    if (bytes.length !== expectedSize) throw new Error("salary-slip-size-mismatch");
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("salary-slip-integrity-mismatch");
    }
    await getDatabaseClient().begin(async (sql) => {
      await recordPrivateFileEvent(sql, {
        fileId: row.private_file_id,
        organizationId: contextValue.membership.organizationId,
        eventType: "file.downloaded",
        actorMembershipId: contextValue.membership.id,
        details: { salarySlipId: row.id },
      });
      await recordSalarySlipDownload(sql, contextValue, {
        salarySlipId: row.id,
        privateFileId: row.private_file_id,
      });
    });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": salarySlipContentDisposition(
          row.original_file_name ?? "salary-slip.pdf",
        ),
        "content-length": String(bytes.length),
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError("Salary slip could not be downloaded.", 500);
  }
}
