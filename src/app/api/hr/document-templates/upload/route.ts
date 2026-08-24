import { NextResponse } from "next/server";
import { z } from "zod";

import { validateMultipartContentLength } from "@/lib/server/multipart-content-length";
import { hrDocumentTypes } from "@/modules/hr/documents";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  HR_DOCUMENT_TEMPLATE_UPLOAD_MAX_BYTES,
  storeHrDocumentTemplate,
} from "@/modules/hr/server/document-template-storage";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

export const runtime = "nodejs";
const MAX_MULTIPART_OVERHEAD_BYTES = 128_000;

const uploadSchema = z.object({
  documentType: z.enum(hrDocumentTypes),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable(),
});

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Template could not be uploaded.";
  if (error.message.includes("size")) return "HTML templates are limited to 512 KB.";
  if (error.message.includes("encoding")) return "Template must be valid UTF-8 HTML.";
  if (error.message.includes("blocked") || error.message.includes("unsafe")) {
    return "Template contains scripts, active content, external resources, or unsafe CSS.";
  }
  if (error.message.includes("placeholder")) {
    return "Template placeholders are unsupported or required employee/company placeholders are missing.";
  }
  if (error.message.includes("html-root") || error.message.includes("body-required")) {
    return "Upload a complete HTML document with html, head, and body elements.";
  }
  return "Template could not be uploaded.";
}

export async function POST(request: Request) {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.documentTemplateManage,
  ]);
  if (!authorization.allowed) {
    return jsonError(
      authorization.reason === "signed-out"
        ? "Sign in before uploading document templates."
        : "You cannot upload document templates.",
      authorization.reason === "signed-out" ? 401 : 403,
    );
  }

  try {
    const boundedLength = validateMultipartContentLength(
      request,
      HR_DOCUMENT_TEMPLATE_UPLOAD_MAX_BYTES,
      MAX_MULTIPART_OVERHEAD_BYTES,
    );
    if (!boundedLength.ok && boundedLength.status === 411) {
      return jsonError("A bounded Content-Length header is required.", 411);
    }
    if (!boundedLength.ok) {
      return jsonError("HTML templates are limited to 512 KB.", 413);
    }

    const formData = await request.formData();
    const descriptionValue = formData.get("description");
    const parsed = uploadSchema.safeParse({
      documentType: formData.get("documentType"),
      name: formData.get("name"),
      description:
        typeof descriptionValue === "string" && descriptionValue.trim()
          ? descriptionValue.trim()
          : null,
    });
    if (!parsed.success) return jsonError("Check the template name, type, and description.");
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("Choose an HTML template file.");
    if (
      !/\.html?$/i.test(file.name) ||
      !["text/html", "application/xhtml+xml", ""].includes(file.type)
    ) {
      return jsonError("Choose a .html template file.");
    }
    if (file.size <= 0 || file.size > HR_DOCUMENT_TEMPLATE_UPLOAD_MAX_BYTES) {
      return jsonError("HTML templates are limited to 512 KB.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeHrDocumentTemplate({
      context: authorization.context,
      documentType: parsed.data.documentType,
      name: parsed.data.name,
      description: parsed.data.description,
      fileName: file.name,
      buffer,
    });
    return NextResponse.json(
      {
        ok: true,
        message: `Template version ${stored.version} uploaded. Select it as the default when ready.`,
        templateId: stored.id,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(uploadErrorMessage(error));
  }
}
