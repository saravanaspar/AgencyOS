"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { safeFileStem } from "@/modules/finance/pdf/html";
import { renderHtmlToPdf } from "@/lib/server/html-to-pdf";
import { formText, HrActionError, stateError } from "@/modules/hr/actions/action-utils";
import { parseCustomDocumentFields, type HrDocumentType } from "@/modules/hr/documents";
import { hrPermissionKeys, humanizeHrValue } from "@/modules/hr/hr";
import {
  hrDocumentGenerationSchema,
  hrDocumentIdSchema,
  hrDocumentTemplateDefaultSchema,
  hrDocumentTemplateStatusSchema,
} from "@/modules/hr/schemas/documents";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import {
  compileHrDocumentTemplate,
  type HrDocumentRenderValues,
} from "@/modules/hr/server/document-template-compiler";
import {
  HrDocumentTargetError,
  requireHrDocumentTarget,
  resolveHrDocumentTemplateSelection,
} from "@/modules/hr/server/documents";
import { createHrEmployeeDocumentPrivateFile } from "@/modules/hr/server/hr-document-service";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

function addressText(value: Record<string, unknown>): string {
  const preferredKeys = [
    "line1",
    "line2",
    "street",
    "city",
    "state",
    "postal_code",
    "postalCode",
    "country",
  ];
  const parts: string[] = [];
  for (const key of preferredKeys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim() && !parts.includes(entry.trim())) {
      parts.push(entry.trim());
    }
  }
  if (!parts.length) {
    for (const entry of Object.values(value)) {
      if (typeof entry === "string" && entry.trim()) parts.push(entry.trim());
    }
  }
  return parts.join(", ") || "Not provided";
}

function documentInputMessage(error: unknown): string | null {
  if (error instanceof HrActionError || error instanceof HrDocumentTargetError)
    return error.message;
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith("hr-document-template-")) {
    if (error.message.includes("missing-values")) {
      return "The selected template needs custom fields that were not supplied.";
    }
    if (error.message.includes("integrity"))
      return "The stored template failed its integrity check.";
    return "The selected document template is unavailable or invalid.";
  }
  if (/custom field|duplicate custom/i.test(error.message)) return error.message;
  return null;
}

function dateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function generateHrEmployeeDocumentAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrDocumentGenerationSchema.safeParse({
    membershipId: formText(formData, "membershipId"),
    documentType: formText(formData, "documentType"),
    templateSelection: formText(formData, "templateSelection"),
    title: formText(formData, "title"),
    reference: formText(formData, "reference"),
    effectiveDate: formText(formData, "effectiveDate"),
    expiryDate: formText(formData, "expiryDate"),
    signatoryName: formText(formData, "signatoryName"),
    signatoryTitle: formText(formData, "signatoryTitle"),
    customFields:
      typeof formData.get("customFields") === "string" ? formData.get("customFields") : "",
  });
  if (!parsed.success) {
    return stateError("Check the document fields.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.employeeDocumentManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot generate employee documents.");

  try {
    const values = parsed.data;
    const context = authorization.context;
    const target = await requireHrDocumentTarget(context, values.membershipId);
    const template = await resolveHrDocumentTemplateSelection({
      context,
      documentType: values.documentType,
      selection: values.templateSelection,
    });
    const custom = parseCustomDocumentFields(values.customFields);
    const renderValues: HrDocumentRenderValues = {
      "organization.legal_name": target.organizationLegalName,
      "organization.display_name": target.organizationDisplayName,
      "organization.registered_address": addressText(target.organizationAddress),
      "employee.legal_name": target.legalName,
      "employee.preferred_name": target.preferredName ?? target.legalName,
      "employee.employee_number": target.employeeNumber ?? "Not assigned",
      "employee.work_email": target.workEmail,
      "employee.personal_address": addressText(target.personalAddress),
      "employee.designation": target.designation ?? "Not assigned",
      "employee.department": target.department ?? "Not assigned",
      "employee.manager_name": target.managerName ?? "Not assigned",
      "employee.joining_date": target.joiningDate ?? values.effectiveDate,
      "employee.work_location": target.workLocation ?? "As assigned",
      "employee.work_mode": humanizeHrValue(target.workMode),
      "document.title": values.title,
      "document.reference": values.reference,
      "document.issue_date": dateToday(),
      "document.effective_date": values.effectiveDate,
      "document.expiry_date": values.expiryDate ?? "Not applicable",
      "document.signatory_name": values.signatoryName,
      "document.signatory_title": values.signatoryTitle,
      "template.name": template.name,
      "template.version": String(template.version),
    };
    for (const [key, value] of Object.entries(custom)) renderValues[`custom.${key}`] = value;

    const html = compileHrDocumentTemplate(template, renderValues);
    const pdf = await renderHtmlToPdf({ html, pageSize: "A4" });
    const documentId = randomUUID();
    const fileName = `${safeFileStem(values.reference) || "employee-document"}-${documentId.slice(0, 8)}.pdf`;
    const file = new File([new Uint8Array(pdf)], fileName, { type: "application/pdf" });
    const result = await createHrEmployeeDocumentPrivateFile(context, {
      id: documentId,
      membershipId: values.membershipId,
      documentType: values.documentType,
      title: values.title,
      reference: values.reference,
      effectiveDate: values.effectiveDate,
      expiryDate: values.expiryDate,
      templateSource: template.source,
      builtinTemplateKey: template.source === "builtin" ? template.key : null,
      customTemplateId: template.source === "object_storage" ? template.id : null,
      templateName: template.name,
      templateVersion: template.version,
      templateSha256: template.sha256,
      renderContext: {
        documentType: values.documentType,
        reference: values.reference,
        effectiveDate: values.effectiveDate,
        expiryDate: values.expiryDate,
        signatoryName: values.signatoryName,
        signatoryTitle: values.signatoryTitle,
        custom,
      },
      file,
      buffer: pdf,
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: result.created
        ? "Private employee document generated and queued for security scanning."
        : "An identical document file already exists.",
    };
  } catch (error) {
    return stateError(documentInputMessage(error) ?? "Employee document could not be generated.");
  }
}

export async function setDefaultHrDocumentTemplateAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrDocumentTemplateDefaultSchema.safeParse({
    documentType: formText(formData, "documentType"),
    templateSelection: formText(formData, "templateSelection"),
  });
  if (!parsed.success) return stateError("Choose a valid document template.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.documentTemplateManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot change document templates.");
  try {
    const values = parsed.data;
    const context = authorization.context;
    const template = await resolveHrDocumentTemplateSelection({
      context,
      documentType: values.documentType,
      selection: values.templateSelection,
    });
    await getDatabaseClient().begin(async (sql) => {
      await sql`
        insert into public.hr_document_template_defaults (
          organization_id, document_type, source_type, builtin_key, custom_template_id,
          updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${values.documentType}, ${template.source},
          ${template.source === "builtin" ? template.key : null},
          ${template.source === "object_storage" ? template.id : null}::uuid,
          ${context.membership.id}::uuid
        )
        on conflict (organization_id, document_type) do update
        set source_type = excluded.source_type, builtin_key = excluded.builtin_key,
            custom_template_id = excluded.custom_template_id,
            updated_by_membership_id = excluded.updated_by_membership_id,
            updated_at = now()
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.document_template_default_changed",
        entityType: "hr_document_template_default",
        entityId: null,
        afterState: {
          documentType: values.documentType,
          source: template.source,
          templateId: template.id,
          templateKey: template.key,
          templateName: template.name,
          templateVersion: template.version,
        },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: `${template.name} is now the default.` };
  } catch (error) {
    return stateError(documentInputMessage(error) ?? "Default template could not be changed.");
  }
}

export async function changeHrDocumentTemplateStatusAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrDocumentTemplateStatusSchema.safeParse({
    templateId: formText(formData, "templateId"),
    status: formText(formData, "status"),
  });
  if (!parsed.success) return stateError("Choose a valid template status.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.documentTemplateManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot change document templates.");
  try {
    const context = authorization.context;
    await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.status === "inactive") {
        const defaults = await sql<Array<{ document_type: HrDocumentType }>>`
          select document_type
          from public.hr_document_template_defaults
          where organization_id = ${context.membership.organizationId}::uuid
            and custom_template_id = ${parsed.data.templateId}::uuid
          limit 1
        `;
        if (defaults[0])
          throw new HrActionError("Choose another default before deactivating this template.");
      }
      const rows = await sql<
        Array<{ name: string; document_type: HrDocumentType; version: number }>
      >`
        update public.hr_document_templates
        set status = ${parsed.data.status}, updated_at = now()
        where id = ${parsed.data.templateId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning name, document_type, version
      `;
      const row = rows[0];
      if (!row) throw new HrActionError("Template was not found.");
      await writeAuditEvent(sql, context, {
        action: "hr.document_template_status_changed",
        entityType: "hr_document_template",
        entityId: parsed.data.templateId,
        afterState: {
          status: parsed.data.status,
          documentType: row.document_type,
          name: row.name,
          version: row.version,
        },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Template status updated." };
  } catch (error) {
    return stateError(documentInputMessage(error) ?? "Template status could not be changed.");
  }
}

export async function acknowledgeHrEmployeeDocumentAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrDocumentIdSchema.safeParse({ documentId: formText(formData, "documentId") });
  if (!parsed.success) return stateError("Document was not found.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.employeeDocumentAcknowledge,
  ]);
  if (!authorization.allowed) return stateError("You cannot acknowledge this document.");
  try {
    const context = authorization.context;
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.hr_employee_documents as document
        set acknowledged_at = now(), acknowledged_by_membership_id = ${context.membership.id}::uuid
        from public.private_files as file
        where document.id = ${parsed.data.documentId}::uuid
          and document.organization_id = ${context.membership.organizationId}::uuid
          and document.membership_id = ${context.membership.id}::uuid
          and document.acknowledged_at is null
          and file.id = document.private_file_id
          and file.status = 'available'
        returning document.id
      `;
      if (!rows[0])
        throw new HrActionError(
          "Only your available, unacknowledged document can be acknowledged.",
        );
      await writeAuditEvent(sql, context, {
        action: "hr.employee_document_acknowledged",
        entityType: "hr_employee_document",
        entityId: parsed.data.documentId,
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Document acknowledged." };
  } catch (error) {
    return stateError(documentInputMessage(error) ?? "Document could not be acknowledged.");
  }
}
