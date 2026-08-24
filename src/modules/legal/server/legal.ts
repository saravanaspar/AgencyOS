import "server-only";

import type { TransactionSql } from "postgres";

import { crmPermissionKeys } from "@/modules/crm/crm";
import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  legalContractStatusLabels,
  legalContractTimingState,
  legalContractTypeLabels,
  legalPermissionKeys,
  legalSignatureStatusLabels,
  type LegalContractStatus,
  type LegalContractType,
  type LegalSignatureStatus,
  type LegalVersionKind,
} from "@/modules/legal/legal";
import {
  getCurrentPermissionContext,
  type CurrentPermissionContext,
} from "@/modules/permissions/server/effective-permissions";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";

export interface LegalTemplateSummary {
  id: string;
  name: string;
  contractType: LegalContractType;
  description: string | null;
  sourceDocumentId: string;
  sourceVersionId: string;
  sourceDocumentTitle: string;
  sourceVersionNumber: number;
  status: "active" | "inactive";
}

export interface LegalContractVersionSummary {
  id: string;
  versionNumber: number;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  documentFileName: string;
  versionKind: LegalVersionKind;
  status: "draft" | "approved" | "superseded" | "signed";
  note: string | null;
  uploadedByName: string;
  createdAt: string;
  canOpen: boolean;
}

export interface LegalContractSummary {
  id: string;
  internalReference: string;
  title: string;
  contractType: LegalContractType;
  contractTypeLabel: string;
  counterpartyName: string;
  counterpartyCompanyId: string | null;
  responsibleOwnerMembershipId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  templateId: string | null;
  templateName: string | null;
  status: LegalContractStatus;
  statusLabel: string;
  effectiveDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  noticePeriodDays: number | null;
  jurisdiction: string | null;
  governingLaw: string | null;
  contractValueMinor: number | null;
  currency: string | null;
  signatureStatus: LegalSignatureStatus;
  signatureStatusLabel: string;
  financeReviewRequired: boolean;
  ownerApprovalRequired: boolean;
  approvalRequestId: string | null;
  timingState: ReturnType<typeof legalContractTimingState>;
  versions: LegalContractVersionSummary[];
  events: Array<{
    id: string;
    eventType: string;
    actorName: string | null;
    createdAt: string;
  }>;
  canEdit: boolean;
  canReview: boolean;
  canManageSignatures: boolean;
  canManageLifecycle: boolean;
}

export interface LegalWorkspaceData {
  contracts: LegalContractSummary[];
  templates: LegalTemplateSummary[];
  members: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  documents: Array<{
    id: string;
    title: string;
    versions: Array<{ id: string; versionNumber: number; fileName: string; status: string }>;
  }>;
  summary: {
    total: number;
    inReview: number;
    active: number;
    renewalDue: number;
    noticeDue: number;
    unsigned: number;
  };
  capabilities: {
    canCreate: boolean;
    canManageTemplates: boolean;
  };
}

export type LegalWorkspaceResult =
  | { allowed: true; data: LegalWorkspaceData }
  | { allowed: false; reason: AuthorizationFailureReason };

type ContractRow = {
  id: string;
  internal_reference: string;
  title: string;
  contract_type: LegalContractType;
  counterparty_name: string;
  counterparty_company_id: string | null;
  responsible_owner_membership_id: string;
  owner_name: string;
  department_id: string | null;
  department_name: string | null;
  template_id: string | null;
  template_name: string | null;
  status: LegalContractStatus;
  effective_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  notice_period_days: number | null;
  jurisdiction: string | null;
  governing_law: string | null;
  contract_value_minor: string | number | null;
  currency: string | null;
  signature_status: LegalSignatureStatus;
  finance_review_required: boolean;
  owner_approval_required: boolean;
  approval_request_id: string | null;
  can_edit_scope: boolean;
  can_review_scope: boolean;
  can_manage_signatures_scope: boolean;
  can_manage_lifecycle_scope: boolean;
};

type TemplateRow = {
  id: string;
  name: string;
  contract_type: LegalContractType;
  description: string | null;
  source_document_id: string;
  source_version_id: string;
  source_document_title: string;
  source_version_number: number;
  status: "active" | "inactive";
};

type VersionRow = {
  id: string;
  contract_id: string;
  version_number: number;
  document_id: string;
  document_version_id: string;
  document_title: string;
  file_name: string;
  version_kind: LegalVersionKind;
  status: "draft" | "approved" | "superseded" | "signed";
  note: string | null;
  uploaded_by_name: string;
  created_at: Date;
  can_open: boolean;
};

type EventRow = {
  id: string;
  contract_id: string;
  event_type: string;
  actor_name: string | null;
  created_at: Date;
};

export class LegalAccessError extends Error {}

export async function requireLegalContractAccess(
  context: CurrentPermissionContext,
  contractId: string,
  permissionKey: string,
  sql: TransactionSql,
): Promise<void> {
  const rows = await sql<Array<{ allowed: boolean }>>`
    select private.legal_contract_membership_access_allowed(
      ${contractId}::uuid, ${context.membership.id}::uuid, ${permissionKey}
    ) as allowed
  `;
  if (!rows[0]?.allowed) throw new LegalAccessError("Contract is outside your permission scope.");
}

export async function getLegalWorkspaceData(filters?: {
  query?: string;
  status?: string;
}): Promise<LegalWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;
  const context = permissionResult.context;
  if (
    !context.permissions.has(legalPermissionKeys.workspace) ||
    !context.permissions.has(legalPermissionKeys.view)
  ) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const database = getDatabaseClient();
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const canCreate = context.permissions.has(legalPermissionKeys.create);
  const canUpdate = context.permissions.has(legalPermissionKeys.update);
  const createScope = context.permissionScopes.get(legalPermissionKeys.create) ?? "own";
  const updateScope = context.permissionScopes.get(legalPermissionKeys.update) ?? "own";
  const canViewCompanies = context.permissions.has(crmPermissionKeys.companyView);
  const companyScope = context.permissionScopes.get(crmPermissionKeys.companyView) ?? "own";
  const query = filters?.query?.trim() ?? "";
  const status = filters?.status ?? "all";
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

  try {
    const [contracts, templates, versions, events, members, departments, companies, documentRows] =
      await Promise.all([
        database<ContractRow[]>`
          select contract.id, contract.internal_reference, contract.title, contract.contract_type,
            contract.counterparty_name, contract.counterparty_company_id,
            contract.responsible_owner_membership_id,
            coalesce(owner_profile.display_name, owner_account.email) as owner_name,
            contract.department_id, department.name as department_name,
            contract.template_id, template.name as template_name, contract.status,
            contract.effective_date, contract.end_date, contract.renewal_date,
            contract.notice_period_days, contract.jurisdiction, contract.governing_law,
            contract.contract_value_minor, contract.currency, contract.signature_status,
            contract.finance_review_required, contract.owner_approval_required,
            contract.approval_request_id,
            private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.update}
            ) as can_edit_scope,
            private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.review}
            ) as can_review_scope,
            private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.manageSignatures}
            ) as can_manage_signatures_scope,
            private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.manageLifecycle}
            ) as can_manage_lifecycle_scope
          from public.legal_contracts contract
          join public.memberships owner on owner.id = contract.responsible_owner_membership_id
          join public.identity_accounts owner_account on owner_account.id = owner.user_id
          left join public.profiles owner_profile on owner_profile.id = owner.user_id
          left join public.departments department on department.id = contract.department_id
          left join public.legal_contract_templates template on template.id = contract.template_id
          where contract.organization_id = ${organizationId}::uuid
            and private.legal_contract_membership_access_allowed(
              contract.id, ${membershipId}::uuid, ${legalPermissionKeys.view}
            )
            and (${status} = 'all' or contract.status = ${status})
            and (${query} = '' or contract.internal_reference ilike ${search} escape '\\'
              or contract.title ilike ${search} escape '\\'
              or contract.counterparty_name ilike ${search} escape '\\')
          order by contract.updated_at desc, contract.id desc
        `,
        database<TemplateRow[]>`
          select template.id, template.name, template.contract_type, template.description,
            template.source_document_id, template.source_version_id,
            document.title as source_document_title,
            version.version_number as source_version_number, template.status
          from public.legal_contract_templates template
          join public.documents document on document.id = template.source_document_id
          join public.document_versions version on version.id = template.source_version_id
          where template.organization_id = ${organizationId}::uuid
          order by template.status, template.name
        `,
        database<VersionRow[]>`
          select version.id, version.contract_id, version.version_number, version.document_id,
            version.document_version_id, document.title as document_title,
            private_file.original_filename as file_name, version.version_kind, version.status,
            version.note, coalesce(profile.display_name, account.email) as uploaded_by_name,
            version.created_at,
            private.legal_contract_membership_access_allowed(
              version.contract_id, ${membershipId}::uuid, ${legalPermissionKeys.download}
            ) as can_open
          from public.legal_contract_versions version
          join public.documents document on document.id = version.document_id
          join public.document_versions document_version on document_version.id = version.document_version_id
          join public.private_files private_file on private_file.id = document_version.private_file_id
          join public.memberships uploader on uploader.id = version.uploaded_by_membership_id
          join public.identity_accounts account on account.id = uploader.user_id
          left join public.profiles profile on profile.id = uploader.user_id
          where version.organization_id = ${organizationId}::uuid
            and private.legal_contract_membership_access_allowed(
              version.contract_id, ${membershipId}::uuid, ${legalPermissionKeys.view}
            )
          order by version.contract_id, version.version_number desc
        `,
        database<EventRow[]>`
          select event.id, event.contract_id, event.event_type,
            coalesce(profile.display_name, account.email) as actor_name, event.created_at
          from public.legal_contract_events event
          left join public.memberships actor on actor.id = event.actor_membership_id
          left join public.identity_accounts account on account.id = actor.user_id
          left join public.profiles profile on profile.id = actor.user_id
          where event.organization_id = ${organizationId}::uuid
            and private.legal_contract_membership_access_allowed(
              event.contract_id, ${membershipId}::uuid, ${legalPermissionKeys.view}
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
        database<Array<{ id: string; name: string }>>`
          select company.id, coalesce(company.display_name, company.legal_name) as name
          from public.crm_companies company
          where ${canViewCompanies}
            and company.organization_id = ${organizationId}::uuid
            and company.deleted_at is null
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${companyScope},
              company.account_owner_membership_id, company.created_by_membership_id
            )
          order by name
        `,
        database<
          Array<{
            id: string;
            title: string;
            version_id: string;
            version_number: number;
            file_name: string;
            file_status: string;
          }>
        >`
          select document.id, document.title, version.id as version_id,
            version.version_number, private_file.original_filename as file_name,
            private_file.status as file_status
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

    const versionMap = new Map<string, LegalContractVersionSummary[]>();
    for (const version of versions) {
      const items = versionMap.get(version.contract_id) ?? [];
      items.push({
        id: version.id,
        versionNumber: version.version_number,
        documentId: version.document_id,
        documentVersionId: version.document_version_id,
        documentTitle: version.document_title,
        documentFileName: version.file_name,
        versionKind: version.version_kind,
        status: version.status,
        note: version.note,
        uploadedByName: version.uploaded_by_name,
        createdAt: version.created_at.toISOString(),
        canOpen: version.can_open,
      });
      versionMap.set(version.contract_id, items);
    }
    const eventMap = new Map<string, LegalContractSummary["events"]>();
    for (const event of events) {
      const items = eventMap.get(event.contract_id) ?? [];
      if (items.length < 20) {
        items.push({
          id: event.id,
          eventType: event.event_type,
          actorName: event.actor_name,
          createdAt: event.created_at.toISOString(),
        });
      }
      eventMap.set(event.contract_id, items);
    }

    const contractData = contracts.map((contract): LegalContractSummary => {
      const timingState = legalContractTimingState({
        status: contract.status,
        renewalDate: contract.renewal_date,
        endDate: contract.end_date,
        noticePeriodDays: contract.notice_period_days,
      });
      return {
        id: contract.id,
        internalReference: contract.internal_reference,
        title: contract.title,
        contractType: contract.contract_type,
        contractTypeLabel: legalContractTypeLabels[contract.contract_type],
        counterpartyName: contract.counterparty_name,
        counterpartyCompanyId: contract.counterparty_company_id,
        responsibleOwnerMembershipId: contract.responsible_owner_membership_id,
        ownerName: contract.owner_name,
        departmentId: contract.department_id,
        departmentName: contract.department_name,
        templateId: contract.template_id,
        templateName: contract.template_name,
        status: contract.status,
        statusLabel: legalContractStatusLabels[contract.status],
        effectiveDate: contract.effective_date,
        endDate: contract.end_date,
        renewalDate: contract.renewal_date,
        noticePeriodDays: contract.notice_period_days,
        jurisdiction: contract.jurisdiction,
        governingLaw: contract.governing_law,
        contractValueMinor:
          contract.contract_value_minor === null ? null : Number(contract.contract_value_minor),
        currency: contract.currency,
        signatureStatus: contract.signature_status,
        signatureStatusLabel: legalSignatureStatusLabels[contract.signature_status],
        financeReviewRequired: contract.finance_review_required,
        ownerApprovalRequired: contract.owner_approval_required,
        approvalRequestId: contract.approval_request_id,
        timingState,
        versions: versionMap.get(contract.id) ?? [],
        events: eventMap.get(contract.id) ?? [],
        canEdit: contract.can_edit_scope && ["request", "draft"].includes(contract.status),
        canReview: contract.can_review_scope,
        canManageSignatures: contract.can_manage_signatures_scope,
        canManageLifecycle: contract.can_manage_lifecycle_scope,
      };
    });

    const documentMap = new Map<string, LegalWorkspaceData["documents"][number]>();
    for (const row of documentRows) {
      let item = documentMap.get(row.id);
      if (!item) {
        item = { id: row.id, title: row.title, versions: [] };
        documentMap.set(row.id, item);
      }
      item.versions.push({
        id: row.version_id,
        versionNumber: row.version_number,
        fileName: row.file_name,
        status: row.file_status,
      });
    }

    return {
      allowed: true,
      data: {
        contracts: contractData,
        templates: templates.map((template) => ({
          id: template.id,
          name: template.name,
          contractType: template.contract_type,
          description: template.description,
          sourceDocumentId: template.source_document_id,
          sourceVersionId: template.source_version_id,
          sourceDocumentTitle: template.source_document_title,
          sourceVersionNumber: template.source_version_number,
          status: template.status,
        })),
        members,
        departments,
        companies,
        documents: [...documentMap.values()],
        summary: {
          total: contractData.length,
          inReview: contractData.filter((item) => item.status === "in_review").length,
          active: contractData.filter((item) => item.status === "active").length,
          renewalDue: contractData.filter((item) => item.timingState === "renewal_due").length,
          noticeDue: contractData.filter((item) => item.timingState === "notice_due").length,
          unsigned: contractData.filter((item) =>
            ["approved", "awaiting_signature"].includes(item.status),
          ).length,
        },
        capabilities: {
          canCreate: context.permissions.has(legalPermissionKeys.create),
          canManageTemplates: context.permissions.has(legalPermissionKeys.manageTemplates),
        },
      },
    };
  } catch {
    return { allowed: false, reason: "access-check-failed" };
  }
}
