"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { toJsonValue } from "@/lib/server/json-value";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import { requireDocumentAccess } from "@/modules/documents/server/documents";
import { legalCompliancePermissionKeys } from "@/modules/legal/compliance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import {
  legalComplianceLifecycleSchema,
  legalComplianceRecordSchema,
  type LegalComplianceActionState,
} from "@/modules/legal/schemas/compliance";
import {
  LegalComplianceAccessError,
  requireLegalComplianceRecordAccess,
} from "@/modules/legal/server/compliance";
import { validateLegalOwnerAssignment } from "@/modules/legal/server/owner-validation";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const success = (message: string): LegalComplianceActionState => ({ status: "success", message });
const failure = (
  message: string,
  fieldErrors?: Record<string, string[]>,
): LegalComplianceActionState => ({ status: "error", message, fieldErrors });
const value = (formData: FormData, key: string) => formData.get(key);
const refresh = () => revalidatePath("/legal");
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "23505",
  );

export async function saveLegalComplianceRecordAction(
  _previous: LegalComplianceActionState,
  formData: FormData,
): Promise<LegalComplianceActionState> {
  const parsed = legalComplianceRecordSchema.safeParse({
    recordId: value(formData, "recordId"),
    internalReference: value(formData, "internalReference"),
    title: value(formData, "title"),
    recordType: value(formData, "recordType"),
    responsibleOwnerMembershipId: value(formData, "responsibleOwnerMembershipId"),
    departmentId: value(formData, "departmentId"),
    issuingAuthority: value(formData, "issuingAuthority"),
    jurisdiction: value(formData, "jurisdiction"),
    identifierLastFour: value(formData, "identifierLastFour"),
    issueDate: value(formData, "issueDate"),
    effectiveDate: value(formData, "effectiveDate"),
    expiryDate: value(formData, "expiryDate"),
    renewalDate: value(formData, "renewalDate"),
    reviewDate: value(formData, "reviewDate"),
    responseDueDate: value(formData, "responseDueDate"),
    confidentialityLevel: value(formData, "confidentialityLevel"),
    legalPrivilege: value(formData, "legalPrivilege"),
    documentId: value(formData, "documentId"),
    documentVersionId: value(formData, "documentVersionId"),
    summary: value(formData, "summary"),
  });
  if (!parsed.success) {
    return failure("Check the compliance-record fields.", parsed.error.flatten().fieldErrors);
  }

  const permissionKey = parsed.data.recordId
    ? legalCompliancePermissionKeys.update
    : legalCompliancePermissionKeys.create;
  const authorization = await authorizeCurrentUser([legalPermissionKeys.workspace, permissionKey]);
  if (!authorization.allowed) return failure("You cannot save legal compliance records.");
  const context = authorization.context;
  if (
    parsed.data.legalPrivilege &&
    !context.permissions.has(legalCompliancePermissionKeys.managePrivileged)
  ) {
    return failure("Only privileged-record managers can apply legal privilege.");
  }

  try {
    const notification = await getDatabaseClient().begin(async (sql) => {
      if (parsed.data.recordId) {
        await requireLegalComplianceRecordAccess(
          context,
          parsed.data.recordId,
          legalCompliancePermissionKeys.update,
          sql,
        );
      }
      await validateLegalOwnerAssignment(
        sql,
        context,
        parsed.data.responsibleOwnerMembershipId,
        permissionKey,
      );
      await requireDocumentAccess(context, parsed.data.documentId, "view", sql);
      const documents = await sql<
        Array<{ classification: string; file_status: string; document_version_id: string }>
      >`
        select document.classification, private_file.status as file_status,
          version.id as document_version_id
        from public.documents document
        join public.document_versions version on version.document_id = document.id
        join public.private_files private_file on private_file.id = version.private_file_id
        where document.id = ${parsed.data.documentId}::uuid
          and version.id = ${parsed.data.documentVersionId}::uuid
          and document.organization_id = ${context.membership.organizationId}::uuid
        limit 1
      `;
      const document = documents[0];
      if (!document || document.file_status !== "available") throw new Error("document-invalid");
      if (parsed.data.legalPrivilege && document.classification !== "restricted") {
        throw new Error("privileged-document-classification");
      }

      if (parsed.data.recordId) {
        const before = await sql<
          Array<{
            document_version_id: string;
            status: string;
            responsible_owner_membership_id: string;
          }>
        >`
          select document_version_id, status, responsible_owner_membership_id
          from public.legal_compliance_records
          where id = ${parsed.data.recordId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
          for update
        `;
        if (!before[0] || before[0].status !== "active") throw new Error("record-locked");
        await sql`
          update public.legal_compliance_records set
            internal_reference = ${parsed.data.internalReference}, title = ${parsed.data.title},
            record_type = ${parsed.data.recordType},
            responsible_owner_membership_id = ${parsed.data.responsibleOwnerMembershipId}::uuid,
            department_id = ${parsed.data.departmentId}::uuid,
            issuing_authority = ${parsed.data.issuingAuthority}, jurisdiction = ${parsed.data.jurisdiction},
            identifier_last_four = ${parsed.data.identifierLastFour},
            issue_date = ${parsed.data.issueDate}::date,
            effective_date = ${parsed.data.effectiveDate}::date,
            expiry_date = ${parsed.data.expiryDate}::date,
            renewal_date = ${parsed.data.renewalDate}::date,
            review_date = ${parsed.data.reviewDate}::date,
            response_due_date = ${parsed.data.responseDueDate}::date,
            confidentiality_level = ${parsed.data.confidentialityLevel},
            legal_privilege = ${parsed.data.legalPrivilege},
            document_id = ${parsed.data.documentId}::uuid,
            document_version_id = ${parsed.data.documentVersionId}::uuid,
            summary = ${parsed.data.summary}
          where id = ${parsed.data.recordId}::uuid
        `;
        await sql`
          insert into public.legal_compliance_record_events (
            organization_id, record_id, event_type, actor_membership_id, details
          ) values (
            ${context.membership.organizationId}::uuid, ${parsed.data.recordId}::uuid,
            ${
              before[0].document_version_id === parsed.data.documentVersionId
                ? "compliance.record_updated"
                : "compliance.document_version_changed"
            },
            ${context.membership.id}::uuid,
            ${sql.json(
              toJsonValue({
                previousDocumentVersionId: before[0].document_version_id,
                documentVersionId: parsed.data.documentVersionId,
              }),
            )}
          )
        `;
        await writeAuditEvent(sql, context, {
          action: "legal.compliance_record.updated",
          entityType: "legal_compliance_record",
          entityId: parsed.data.recordId,
          afterState: {
            recordType: parsed.data.recordType,
            status: "active",
            confidentialityLevel: parsed.data.confidentialityLevel,
            legalPrivilege: parsed.data.legalPrivilege,
          },
          changedFields: ["metadata", "documentVersionId"],
        });
        return {
          id: parsed.data.recordId,
          created: false,
          ownerMembershipId: parsed.data.responsibleOwnerMembershipId,
          ownerChanged:
            before[0].responsible_owner_membership_id !== parsed.data.responsibleOwnerMembershipId,
          title: parsed.data.title,
        };
      }

      const rows = await sql<Array<{ id: string }>>`
        insert into public.legal_compliance_records (
          organization_id, internal_reference, title, record_type,
          responsible_owner_membership_id, department_id, issuing_authority, jurisdiction,
          identifier_last_four, issue_date, effective_date, expiry_date, renewal_date,
          review_date, response_due_date, confidentiality_level, legal_privilege,
          document_id, document_version_id, summary, created_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.internalReference},
          ${parsed.data.title}, ${parsed.data.recordType},
          ${parsed.data.responsibleOwnerMembershipId}::uuid, ${parsed.data.departmentId}::uuid,
          ${parsed.data.issuingAuthority}, ${parsed.data.jurisdiction},
          ${parsed.data.identifierLastFour}, ${parsed.data.issueDate}::date,
          ${parsed.data.effectiveDate}::date, ${parsed.data.expiryDate}::date,
          ${parsed.data.renewalDate}::date, ${parsed.data.reviewDate}::date,
          ${parsed.data.responseDueDate}::date, ${parsed.data.confidentialityLevel},
          ${parsed.data.legalPrivilege}, ${parsed.data.documentId}::uuid,
          ${parsed.data.documentVersionId}::uuid, ${parsed.data.summary},
          ${context.membership.id}::uuid
        ) returning id
      `;
      const recordId = rows[0]?.id;
      if (!recordId) throw new Error("record-create-failed");
      await sql`
        insert into public.legal_compliance_record_events (
          organization_id, record_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${recordId}::uuid,
          'compliance.record_created', ${context.membership.id}::uuid,
          ${sql.json(
            toJsonValue({
              recordType: parsed.data.recordType,
              documentVersionId: parsed.data.documentVersionId,
            }),
          )}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "legal.compliance_record.created",
        entityType: "legal_compliance_record",
        entityId: recordId,
        afterState: {
          recordType: parsed.data.recordType,
          status: "active",
          confidentialityLevel: parsed.data.confidentialityLevel,
          legalPrivilege: parsed.data.legalPrivilege,
        },
        changedFields: ["record"],
      });
      return {
        id: recordId,
        created: true,
        ownerMembershipId: parsed.data.responsibleOwnerMembershipId,
        ownerChanged: true,
        title: parsed.data.title,
      };
    });

    if (notification.ownerChanged) {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: notification.ownerMembershipId,
        category: "assignment",
        severity: "info",
        title: notification.created ? "Legal record assigned" : "Legal record reassigned",
        message: `${notification.title} is assigned to you.`,
        deepLink: "/legal",
        sourceModule: "legal",
        sourceEntityType: "compliance_record",
        sourceEntityId: notification.id,
        dedupeKey: `legal-compliance-${notification.id}-${notification.ownerMembershipId}`,
        createdByMembershipId: context.membership.id,
      });
    }
    refresh();
    return success(
      notification.created ? "Compliance record created." : "Compliance record updated.",
    );
  } catch (error) {
    if (error instanceof LegalComplianceAccessError) return failure(error.message);
    if (isUniqueViolation(error)) return failure("That internal reference is already in use.");
    if (error instanceof Error && error.message === "owner-outside-scope") {
      return failure("Choose an active owner inside your permission scope.");
    }
    if (error instanceof Error && error.message === "privileged-document-classification") {
      return failure("Legally privileged records require a restricted linked document.");
    }
    if (error instanceof Error && error.message === "record-locked") {
      return failure("Closed or archived records cannot be edited.");
    }
    return failure("The compliance record could not be saved.");
  }
}

export async function updateLegalComplianceLifecycleAction(
  _previous: LegalComplianceActionState,
  formData: FormData,
): Promise<LegalComplianceActionState> {
  const parsed = legalComplianceLifecycleSchema.safeParse({
    recordId: value(formData, "recordId"),
    action: value(formData, "action"),
    reason: value(formData, "reason"),
  });
  if (!parsed.success) {
    return failure("Check the lifecycle action.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    legalPermissionKeys.workspace,
    legalCompliancePermissionKeys.manageLifecycle,
  ]);
  if (!authorization.allowed) return failure("You cannot manage compliance-record lifecycle.");
  const context = authorization.context;

  try {
    const status = await getDatabaseClient().begin(async (sql) => {
      await requireLegalComplianceRecordAccess(
        context,
        parsed.data.recordId,
        legalCompliancePermissionKeys.manageLifecycle,
        sql,
      );
      const rows = await sql<Array<{ status: string; title: string }>>`
        select status, title from public.legal_compliance_records
        where id = ${parsed.data.recordId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        for update
      `;
      const record = rows[0];
      if (!record) throw new Error("record-not-found");
      let nextStatus: "closed" | "archived";
      if (parsed.data.action === "close") {
        if (record.status !== "active" || !parsed.data.reason) throw new Error("lifecycle-invalid");
        nextStatus = "closed";
      } else if (parsed.data.action === "archive") {
        if (record.status !== "closed") throw new Error("lifecycle-invalid");
        nextStatus = "archived";
      } else {
        if (record.status !== "archived") throw new Error("lifecycle-invalid");
        nextStatus = "closed";
      }
      await sql`
        update public.legal_compliance_records set
          status = ${nextStatus},
          closure_reason = case
            when ${parsed.data.action} = 'close' then ${parsed.data.reason}
            else closure_reason
          end,
          closed_at = case
            when ${parsed.data.action} = 'close' then now()
            else closed_at
          end
        where id = ${parsed.data.recordId}::uuid
      `;
      const lifecycleEvent = parsed.data.action === "restore" ? "restored" : nextStatus;
      await sql`
        insert into public.legal_compliance_record_events (
          organization_id, record_id, event_type, actor_membership_id, details
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.recordId}::uuid,
          ${`compliance.record_${lifecycleEvent}`}, ${context.membership.id}::uuid,
          ${sql.json(toJsonValue({ reason: parsed.data.reason }))}
        )
      `;
      await writeAuditEvent(sql, context, {
        action: `legal.compliance_record.${lifecycleEvent}`,
        entityType: "legal_compliance_record",
        entityId: parsed.data.recordId,
        afterState: { status: nextStatus },
        changedFields: ["status"],
      });
      return { action: parsed.data.action, status: nextStatus };
    });
    refresh();
    return success(
      status.action === "restore"
        ? "Compliance record restored to closed history."
        : `Compliance record marked ${status.status}.`,
    );
  } catch (error) {
    return failure(
      error instanceof LegalComplianceAccessError
        ? error.message
        : "The record is not ready for that lifecycle action.",
    );
  }
}
