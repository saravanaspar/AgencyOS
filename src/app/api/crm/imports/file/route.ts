import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { readSheet } from "read-excel-file/node";

import { validateMultipartContentLength } from "@/lib/server/multipart-content-length";
import { mapTabularLeadRows, parseCsv } from "@/modules/crm/crm-imports";
import { crmFileImportSchema } from "@/modules/crm/schemas/imports";
import {
  CRM_IMPORT_MAX_FILE_BYTES,
  CRM_IMPORT_MAX_ROWS,
  importLeadRows,
} from "@/modules/crm/server/imports";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeCurrentUser(["crm.import.execute", "crm.lead.create"]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before importing CRM leads."
        : "You do not have permission to import CRM leads.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  try {
    const boundedLength = validateMultipartContentLength(
      request,
      CRM_IMPORT_MAX_FILE_BYTES,
      128_000,
    );
    if (!boundedLength.ok && boundedLength.status === 411) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (!boundedLength.ok) {
      return jsonError("Import files are limited to 5 MB.", 413);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return jsonError("Choose a CSV or XLSX file.");
    if (file.size > CRM_IMPORT_MAX_FILE_BYTES)
      return jsonError("Import files are limited to 5 MB.", 413);

    const parsed = crmFileImportSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Check the import options.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "xlsx") {
      return jsonError("Only .csv and .xlsx files are accepted.");
    }

    const context = authorization.context;
    const ownerMembershipId = parsed.data.ownerMembershipId ?? context.membership.id;
    if (
      ownerMembershipId !== context.membership.id &&
      !context.permissions.has("crm.lead.assign")
    ) {
      return jsonError("You cannot assign imported leads to another owner.", 403);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tabularRows =
      extension === "csv"
        ? parseCsv(buffer.toString("utf8"), CRM_IMPORT_MAX_ROWS + 1)
        : ((await readSheet(buffer)) as unknown[][]);
    const rows = mapTabularLeadRows(tabularRows);
    if (rows.length > CRM_IMPORT_MAX_ROWS) {
      return jsonError(`Imports are limited to ${CRM_IMPORT_MAX_ROWS} data rows.`);
    }

    const outcome = await importLeadRows(
      {
        organizationId: context.membership.organizationId,
        membershipId: context.membership.id,
        userId: context.user.id,
      },
      {
        sourceType: extension,
        sourceName: parsed.data.sourceName,
        fileName: file.name.slice(0, 255),
        stageId: parsed.data.stageId,
        ownerMembershipId,
        duplicatePolicy: parsed.data.duplicatePolicy,
      },
      rows,
    );

    revalidatePath("/crm");
    revalidatePath("/dashboard");
    return NextResponse.json({ ok: true, outcome }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "The import could not be completed.",
      400,
    );
  }
}
