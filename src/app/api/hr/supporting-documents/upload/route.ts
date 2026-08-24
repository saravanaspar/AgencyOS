import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAllowedApplicationOrigin } from "@/lib/server/request-origin";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { hrSupportingDocumentUploadSchema } from "@/modules/hr/schemas/supporting-documents";
import {
  buildHrSupportingDocumentReference,
  getHrSupportingDocumentCategoryDefinition,
  type HrSupportingDocumentCategory,
} from "@/modules/hr/supporting-documents";
import {
  createHrSupportingDocumentPrivateFile,
  HR_SUPPORTING_DOCUMENT_MAX_BYTES,
  requireHrSupportingDocumentTarget,
  supportingDocumentValidationMessage,
} from "@/modules/hr/server/supporting-documents";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
const MAX_MULTIPART_OVERHEAD_BYTES = 512_000;

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function formBoolean(formData: FormData, key: string): boolean {
  return formData.get(key) === "true" || formData.get(key) === "on";
}

export async function POST(request: Request) {
  if (!isAllowedApplicationOrigin(request, { requireOrigin: true })) {
    return jsonError("Cross-origin supporting-document uploads are not allowed.", 403);
  }
  const authorization = await authorizeCurrentUser([hrPermissionKeys.workspace]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading supporting documents."
        : "You cannot access HR supporting documents.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }
  const context = authorization.context;
  const canManage = context.permissions.has(hrPermissionKeys.supportingDocumentManage);
  const canUploadOwn = context.permissions.has(hrPermissionKeys.supportingDocumentUploadOwn);
  if (!canManage && !canUploadOwn) return jsonError("You cannot upload supporting documents.", 403);

  try {
    const rawContentLength = request.headers.get("content-length");
    const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (contentLength > HR_SUPPORTING_DOCUMENT_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
      return jsonError("Supporting documents are limited to 10 MB.", 413);
    }

    const formData = await request.formData();
    const membershipId = canManage ? formText(formData, "membershipId") : context.membership.id;
    const parsed = hrSupportingDocumentUploadSchema.safeParse({
      membershipId,
      category: formText(formData, "category"),
      title: formText(formData, "title"),
      issuer: formText(formData, "issuer"),
      identifierSuffix: formText(formData, "identifierSuffix"),
      issuedDate: formText(formData, "issuedDate"),
      expiryDate: formText(formData, "expiryDate"),
      employeeVisible: canManage ? formBoolean(formData, "employeeVisible") : true,
    });
    if (!parsed.success) return jsonError("Check the supporting-document details.");

    const values = parsed.data;
    const definition = getHrSupportingDocumentCategoryDefinition(
      values.category as HrSupportingDocumentCategory,
    );
    if (!canManage && !definition.selfUploadAllowed) {
      return jsonError("Only HR can upload this document category.", 403);
    }
    if (!definition.identifierSuffixAllowed && values.identifierSuffix) {
      return jsonError("This document category does not accept an identifier suffix.");
    }
    const permissionKey = canManage
      ? hrPermissionKeys.supportingDocumentManage
      : hrPermissionKeys.supportingDocumentUploadOwn;
    await requireHrSupportingDocumentTarget(context, values.membershipId, permissionKey);

    const uploadedFile = formData.get("file");
    if (!(uploadedFile instanceof File)) return jsonError("Choose a supporting document file.");
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const documentId = randomUUID();
    const extension =
      uploadedFile.type === "application/pdf"
        ? ".pdf"
        : uploadedFile.type === "image/png"
          ? ".png"
          : ".jpg";
    const file = new File(
      [new Uint8Array(buffer)],
      `supporting-document-${values.category}-${documentId.slice(0, 8)}${extension}`,
      { type: uploadedFile.type },
    );
    const reference = buildHrSupportingDocumentReference(values.category, values.title);
    const result = await createHrSupportingDocumentPrivateFile(context, {
      id: documentId,
      membershipId: values.membershipId,
      category: values.category,
      title: values.title,
      reference,
      issuer: values.issuer,
      identifierSuffix: values.identifierSuffix,
      issuedDate: values.issuedDate,
      expiryDate: values.expiryDate,
      employeeVisible: canManage ? values.employeeVisible : true,
      reviewStatus: canManage ? "verified" : "pending",
      file,
      buffer,
    });
    revalidatePath("/hr");
    return NextResponse.json(
      {
        ok: true,
        duplicate: !result.created,
        message: result.created
          ? "Supporting document uploaded for security scanning."
          : "This exact file is already uploaded or awaiting scanning.",
      },
      {
        status: result.created ? 202 : 200,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  } catch (error) {
    const validation = supportingDocumentValidationMessage(error);
    if (validation) return jsonError(validation, validation.includes("10 MB") ? 413 : 400);
    return jsonError("Supporting document could not be uploaded.", 500);
  }
}
