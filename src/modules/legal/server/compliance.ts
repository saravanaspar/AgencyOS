import "server-only";

import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  legalComplianceConfidentialityLabels,
  legalCompliancePermissionKeys,
  legalComplianceRecordTypeLabels,
  legalComplianceStatusLabels,
  legalComplianceTimingState,
  type LegalComplianceConfidentiality,
  type LegalComplianceRecordType,
  type LegalComplianceStatus,
} from "@/modules/legal/compliance";
import { legalPermissionKeys } from "@/modules/legal/legal";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";

export interface LegalComplianceRecordSummary {
  id: string;
  internalReference: string;
  title: string;
  recordType: LegalComplianceRecordType;
  recordTypeLabel: string;
  status: LegalComplianceStatus;
  statusLabel: string;
  responsibleOwnerMembershipId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  issuingAuthority: string | null;
  jurisdiction: string | null;
  identifierLastFour: string | null;
  issueDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  reviewDate: string | null;
  responseDueDate: string | null;
  confidentialityLevel: LegalComplianceConfidentiality;
  confidentialityLabel: string;
  legalPrivilege: boolean;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  documentFileName: string;
  documentVersionNumber: number;
  summary: string | null;
  timingState: ReturnType<typeof legalComplianceTimingState>;
  reminders: Array<{ type: string; remindOn: string; status: string }>;
  events: Array<{ id: string; eventType: string; actorName: string | null; createdAt: string }>;
  canEdit: boolean;
  canManageLifecycle: boolean;
  canOpen: boolean;
}

export interface LegalComplianceWorkspaceData {
  records: LegalComplianceRecordSummary[];
  members: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  documents: Array<{
    id: string;
    title: string;
    classification: string;
    versions: Array<{ id: string; versionNumber: number; fileName: string; status: string }>;
  }>;
  summary: {
    total: number;
    active: number;
    due: number;
    expired: number;
    privileged: number;
  };
  capabilities: {
    canCreate: boolean;
    canManagePrivileged: boolean;
  };
}

export type LegalComplianceWorkspaceResult =
  | { allowed: true; data: LegalComplianceWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

export class LegalComplianceAccessError extends Error {}

export async function requireLegalComplianceRecordAccess(
  context: CurrentPermissionContext,
  recordId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.legal_compliance_record_membership_access_allowed(
      ${recordId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) {
    throw new LegalComplianceAccessError("Compliance record is outside your permission scope.");
  }
}

type RecordRow = {
  id: string;
  internal_reference: string;
  title: string;
  record_type: LegalComplianceRecordType;
  status: LegalComplianceStatus;
  responsible_owner_membership_id: string;
  owner_name: string;
  department_id: string | null;
  department_name: string | null;
  issuing_authority: string | null;
  jurisdiction: string | null;
  identifier_last_four: string | null;
  issue_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_date: string | null;
  review_date: string | null;
  response_due_date: string | null;
  confidentiality_level: LegalComplianceConfidentiality;
  legal_privilege: boolean;
  document_id: string;
  document_version_id: string;
  document_title: string;
  document_file_name: string;
  document_version_number: number;
  summary: string | null;
  can_edit: boolean;
  can_manage_lifecycle: boolean;
  can_open: boolean;
};

type ReminderRow = {
  record_id: string;
  reminder_type: string;
  remind_on: string;
  status: string;
};

type EventRow = {
  id: string;
  record_id: string;
  event_type: string;
  actor_name: string | null;
  created_at: Date;
};

export async function getLegalComplianceWorkspaceData(filters?: {
  query?: string;
  type?: string;
  status?: string;
}): Promise<LegalComplianceWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(legalPermissionKeys.workspace) ||
    !context.permissions.has(legalCompliancePermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const canCreate = context.permissions.has(legalCompliancePermissionKeys.create);
  const canUpdate = context.permissions.has(legalCompliancePermissionKeys.update);
  const createScope = context.permissionScopes.get(legalCompliancePermissionKeys.create) ?? "own";
  const updateScope = context.permissionScopes.get(legalCompliancePermissionKeys.update) ?? "own";
  const query = filters?.query?.trim() ?? "";
  const type = filters?.type ?? "all";
  const status = filters?.status ?? "all";
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

  try {
    const [records, reminders, events, members, departments, documentRows] = await Promise.all([
      database<RecordRow[]>`
        select record.id, record.internal_reference, record.title, record.record_type, record.status,
          record.responsible_owner_membership_id,
          coalesce(owner_profile.display_name, owner_account.email) as owner_name,
          record.department_id, department.name as department_name,
          record.issuing_authority, record.jurisdiction, record.identifier_last_four,
          record.issue_date, record.effective_date, record.expiry_date, record.renewal_date,
          record.review_date, record.response_due_date, record.confidentiality_level,
          record.legal_privilege, record.document_id, record.document_version_id,
          document.title as document_title, private_file.original_filename as document_file_name,
          version.version_number as document_version_number, record.summary,
          private.legal_compliance_record_membership_access_allowed(
            record.id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.update}
          ) as can_edit,
          private.legal_compliance_record_membership_access_allowed(
            record.id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.manageLifecycle}
          ) as can_manage_lifecycle,
          private.legal_compliance_record_membership_access_allowed(
            record.id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.download}
          ) and private.document_membership_access_allowed(
            record.document_id, ${membershipId}::uuid, 'download'
          ) as can_open
        from public.legal_compliance_records record
        join public.memberships owner on owner.id = record.responsible_owner_membership_id
        join public.identity_accounts owner_account on owner_account.id = owner.user_id
        left join public.profiles owner_profile on owner_profile.id = owner.user_id
        left join public.departments department on department.id = record.department_id
        join public.documents document on document.id = record.document_id
        join public.document_versions version on version.id = record.document_version_id
        join public.private_files private_file on private_file.id = version.private_file_id
        where record.organization_id = ${organizationId}::uuid
          and private.legal_compliance_record_membership_access_allowed(
            record.id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.view}
          )
          and (${type} = 'all' or record.record_type = ${type})
          and (${status} = 'all' or record.status = ${status})
          and (${query} = '' or record.internal_reference ilike ${search} escape '\\'
            or record.title ilike ${search} escape '\\'
            or coalesce(record.issuing_authority, '') ilike ${search} escape '\\')
        order by record.updated_at desc, record.id desc
      `,
      database<ReminderRow[]>`
        select reminder.record_id, reminder.reminder_type, reminder.remind_on, reminder.status
        from public.legal_compliance_record_reminders reminder
        where reminder.organization_id = ${organizationId}::uuid
          and private.legal_compliance_record_membership_access_allowed(
            reminder.record_id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.view}
          )
        order by reminder.remind_on, reminder.id
      `,
      database<EventRow[]>`
        select event.id, event.record_id, event.event_type,
          coalesce(profile.display_name, account.email) as actor_name, event.created_at
        from public.legal_compliance_record_events event
        left join public.memberships actor on actor.id = event.actor_membership_id
        left join public.identity_accounts account on account.id = actor.user_id
        left join public.profiles profile on profile.id = actor.user_id
        where event.organization_id = ${organizationId}::uuid
          and private.legal_compliance_record_membership_access_allowed(
            event.record_id, ${membershipId}::uuid, ${legalCompliancePermissionKeys.view}
          )
        order by event.created_at desc, event.id desc
      `,
      database<Array<{ id: string; name: string }>>`
        select membership.id, coalesce(profile.display_name, account.email) as name
        from public.memberships membership
        join public.identity_accounts account on account.id = membership.user_id
        left join public.profiles profile on profile.id = membership.user_id
        where membership.organization_id = ${organizationId}::uuid and membership.status = 'active'
          and (
            (${canCreate} and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${createScope}, membership.id, membership.id
            ))
            or (${canUpdate} and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${updateScope}, membership.id, membership.id
            ))
          )
        order by name
      `,
      database<Array<{ id: string; name: string }>>`
        select id, name from public.departments
        where organization_id = ${organizationId}::uuid and status = 'active'
        order by name
      `,
      database<
        Array<{
          id: string;
          title: string;
          classification: string;
          version_id: string;
          version_number: number;
          file_name: string;
          file_status: string;
        }>
      >`
        select document.id, document.title, document.classification,
          version.id as version_id, version.version_number,
          private_file.original_filename as file_name, private_file.status as file_status
        from public.documents document
        join public.document_versions version on version.document_id = document.id
        join public.private_files private_file on private_file.id = version.private_file_id
        where document.organization_id = ${organizationId}::uuid
          and document.status = 'active'
          and private.document_membership_access_allowed(
            document.id, ${membershipId}::uuid, 'view'
          )
        order by document.title, version.version_number desc
      `,
    ]);

    const reminderMap = new Map<string, LegalComplianceRecordSummary["reminders"]>();
    for (const reminder of reminders) {
      const items = reminderMap.get(reminder.record_id) ?? [];
      items.push({
        type: reminder.reminder_type,
        remindOn: reminder.remind_on,
        status: reminder.status,
      });
      reminderMap.set(reminder.record_id, items);
    }
    const eventMap = new Map<string, LegalComplianceRecordSummary["events"]>();
    for (const event of events) {
      const items = eventMap.get(event.record_id) ?? [];
      if (items.length < 20) {
        items.push({
          id: event.id,
          eventType: event.event_type,
          actorName: event.actor_name,
          createdAt: event.created_at.toISOString(),
        });
      }
      eventMap.set(event.record_id, items);
    }
    const recordData = records.map((record): LegalComplianceRecordSummary => ({
      id: record.id,
      internalReference: record.internal_reference,
      title: record.title,
      recordType: record.record_type,
      recordTypeLabel: legalComplianceRecordTypeLabels[record.record_type],
      status: record.status,
      statusLabel: legalComplianceStatusLabels[record.status],
      responsibleOwnerMembershipId: record.responsible_owner_membership_id,
      ownerName: record.owner_name,
      departmentId: record.department_id,
      departmentName: record.department_name,
      issuingAuthority: record.issuing_authority,
      jurisdiction: record.jurisdiction,
      identifierLastFour: record.identifier_last_four,
      issueDate: record.issue_date,
      effectiveDate: record.effective_date,
      expiryDate: record.expiry_date,
      renewalDate: record.renewal_date,
      reviewDate: record.review_date,
      responseDueDate: record.response_due_date,
      confidentialityLevel: record.confidentiality_level,
      confidentialityLabel: legalComplianceConfidentialityLabels[record.confidentiality_level],
      legalPrivilege: record.legal_privilege,
      documentId: record.document_id,
      documentVersionId: record.document_version_id,
      documentTitle: record.document_title,
      documentFileName: record.document_file_name,
      documentVersionNumber: record.document_version_number,
      summary: record.summary,
      timingState: legalComplianceTimingState({
        status: record.status,
        expiryDate: record.expiry_date,
        renewalDate: record.renewal_date,
        reviewDate: record.review_date,
        responseDueDate: record.response_due_date,
      }),
      reminders: reminderMap.get(record.id) ?? [],
      events: eventMap.get(record.id) ?? [],
      canEdit: record.can_edit && record.status === "active",
      canManageLifecycle: record.can_manage_lifecycle,
      canOpen: record.can_open,
    }));

    const documentMap = new Map<string, LegalComplianceWorkspaceData["documents"][number]>();
    for (const row of documentRows) {
      let document = documentMap.get(row.id);
      if (!document) {
        document = {
          id: row.id,
          title: row.title,
          classification: row.classification,
          versions: [],
        };
        documentMap.set(row.id, document);
      }
      document.versions.push({
        id: row.version_id,
        versionNumber: row.version_number,
        fileName: row.file_name,
        status: row.file_status,
      });
    }

    return {
      allowed: true,
      data: {
        records: recordData,
        members,
        departments,
        documents: [...documentMap.values()],
        summary: {
          total: recordData.length,
          active: recordData.filter((item) => item.status === "active").length,
          due: recordData.filter((item) =>
            ["response_due", "review_due", "renewal_due"].includes(item.timingState),
          ).length,
          expired: recordData.filter((item) => item.timingState === "expired").length,
          privileged: recordData.filter((item) => item.legalPrivilege).length,
        },
        capabilities: {
          canCreate,
          canManagePrivileged: context.permissions.has(
            legalCompliancePermissionKeys.managePrivileged,
          ),
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
