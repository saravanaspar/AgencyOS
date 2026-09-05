import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  getHrBuiltinDocumentTemplate,
  hrBuiltinDocumentTemplates,
  type HrDocumentTemplateSource,
  type HrDocumentType,
} from "@/modules/hr/documents";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  resolveBuiltinHrTemplate,
  resolveObjectStorageHrTemplate,
  type HrResolvedTemplate,
} from "@/modules/hr/server/document-template-compiler";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrDocumentTemplateOption {
  selection: string;
  id: string | null;
  source: HrDocumentTemplateSource;
  documentType: HrDocumentType;
  name: string;
  description: string | null;
  version: number;
  status: "active" | "inactive";
  isDefault: boolean;
  originalFileName: string | null;
  customFields: string[];
}

export interface HrEmployeeDocumentSummary {
  id: string;
  membershipId: string;
  employeeName: string;
  documentType: HrDocumentType;
  title: string;
  reference: string;
  version: number;
  effectiveDate: string;
  expiryDate: string | null;
  status: "issued" | "superseded";
  templateName: string;
  templateVersion: number;
  fileStatus: string;
  acknowledgedAt: string | null;
  createdAt: string;
  isSelf: boolean;
}

export interface HrDocumentsWorkspaceData {
  templates: HrDocumentTemplateOption[];
  documents: HrEmployeeDocumentSummary[];
  capabilities: {
    canViewTemplates: boolean;
    canManageTemplates: boolean;
    canViewDocuments: boolean;
    canManageDocuments: boolean;
    canAcknowledgeDocuments: boolean;
  };
}

interface CustomTemplateRow {
  id: string;
  document_type: HrDocumentType;
  name: string;
  description: string | null;
  version: number;
  status: "active" | "inactive";
  storage_bucket: string;
  storage_path: string;
  sha256: string;
  original_file_name: string;
  placeholder_keys: string[];
}

export async function getHrDocumentsData(
  context: CurrentPermissionContext,
): Promise<HrDocumentsWorkspaceData> {
  const canViewTemplates = context.permissions.has(hrPermissionKeys.documentTemplateView);
  const canManageTemplates = context.permissions.has(hrPermissionKeys.documentTemplateManage);
  const canViewDocuments = context.permissions.has(hrPermissionKeys.employeeDocumentView);
  const canManageDocuments = context.permissions.has(hrPermissionKeys.employeeDocumentManage);
  const canAcknowledgeDocuments = context.permissions.has(
    hrPermissionKeys.employeeDocumentAcknowledge,
  );
  const organizationId = context.membership.organizationId;
  const database = getDatabaseClient();
  const [customTemplates, defaults, documents] = await Promise.all([
    canViewTemplates
      ? database<CustomTemplateRow[]>`
        select id, document_type, name, description, version, status, storage_bucket,
          storage_path, sha256, original_file_name, placeholder_keys
        from public.hr_document_templates
        where organization_id = ${organizationId}::uuid
        order by document_type, lower(name), version desc
        limit 500
      `
      : Promise.resolve([] as CustomTemplateRow[]),
    canViewTemplates
      ? database<
          Array<{
            document_type: HrDocumentType;
            source_type: HrDocumentTemplateSource;
            builtin_key: string | null;
            custom_template_id: string | null;
          }>
        >`
        select document_type, source_type, builtin_key, custom_template_id
        from public.hr_document_template_defaults
        where organization_id = ${organizationId}::uuid
      `
      : Promise.resolve([]),
    canViewDocuments
      ? database<
          Array<{
            id: string;
            membership_id: string;
            employee_name: string;
            document_type: HrDocumentType;
            title: string;
            internal_reference: string;
            version: number;
            effective_date: string;
            expiry_date: string | null;
            status: "issued" | "superseded";
            template_name: string;
            template_version: number;
            file_status: string;
            acknowledged_at: string | null;
            created_at: string;
          }>
        >`
        select document.id, document.membership_id,
          coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
            nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
          document.document_type, document.title, document.internal_reference,
          document.version, document.effective_date::text, document.expiry_date::text,
          document.status, document.template_name, document.template_version,
          file.status as file_status, document.acknowledged_at::text,
          document.created_at::text
        from public.hr_employee_documents as document
        join public.memberships as membership on membership.id = document.membership_id
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.profiles as profile on profile.id = membership.user_id
        left join public.hr_employee_profiles as employee
          on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
        join public.private_files as file on file.id = document.private_file_id
        where document.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid,
            ${context.permissionScopes.get(hrPermissionKeys.employeeDocumentView) ?? "own"},
            document.membership_id,
            document.membership_id
          )
        order by document.created_at desc
        limit 500
      `
      : Promise.resolve([]),
  ]);

  const defaultByType = new Map(
    defaults.map((item) => [
      item.document_type,
      item.source_type === "builtin"
        ? `builtin:${item.builtin_key}`
        : `object-storage:${item.custom_template_id}`,
    ]),
  );
  const templates: HrDocumentTemplateOption[] = [];
  if (canViewTemplates) {
    for (const builtin of hrBuiltinDocumentTemplates) {
      const selection = `builtin:${builtin.key}`;
      templates.push({
        selection,
        id: null,
        source: "builtin",
        documentType: builtin.documentType,
        name: builtin.name,
        description: builtin.description,
        version: 1,
        status: "active",
        isDefault: (defaultByType.get(builtin.documentType) ?? selection) === selection,
        originalFileName: builtin.fileName,
        customFields: [...builtin.customFields],
      });
    }
    for (const template of customTemplates) {
      const selection = `object-storage:${template.id}`;
      const customFields: string[] = [];
      for (const key of template.placeholder_keys ?? []) {
        if (key.startsWith("custom.")) customFields.push(key.slice("custom.".length));
      }
      templates.push({
        selection,
        id: template.id,
        source: "object_storage",
        documentType: template.document_type,
        name: template.name,
        description: template.description,
        version: template.version,
        status: template.status,
        isDefault: defaultByType.get(template.document_type) === selection,
        originalFileName: template.original_file_name,
        customFields,
      });
    }
  }

  return {
    templates,
    documents: documents.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      documentType: row.document_type,
      title: row.title,
      reference: row.internal_reference,
      version: row.version,
      effectiveDate: row.effective_date,
      expiryDate: row.expiry_date,
      status: row.status,
      templateName: row.template_name,
      templateVersion: row.template_version,
      fileStatus: row.file_status,
      acknowledgedAt: row.acknowledged_at,
      createdAt: row.created_at,
      isSelf: row.membership_id === context.membership.id,
    })),
    capabilities: {
      canViewTemplates,
      canManageTemplates,
      canViewDocuments,
      canManageDocuments,
      canAcknowledgeDocuments,
    },
  };
}

export async function resolveHrDocumentTemplateSelection(input: {
  context: CurrentPermissionContext;
  documentType: HrDocumentType;
  selection: string;
}): Promise<HrResolvedTemplate> {
  const [source, key] = input.selection.split(":", 2);
  if (!source || !key) throw new Error("hr-document-template-selection-invalid");
  if (source === "builtin") {
    const builtin = getHrBuiltinDocumentTemplate(key);
    if (builtin.documentType !== input.documentType) {
      throw new Error("hr-document-template-type-mismatch");
    }
    return resolveBuiltinHrTemplate(key);
  }
  if (source !== "object-storage") {
    throw new Error("hr-document-template-selection-invalid");
  }
  const rows = await getDatabaseClient()<CustomTemplateRow[]>`
    select id, document_type, name, description, version, status, storage_bucket,
      storage_path, sha256, original_file_name, placeholder_keys
    from public.hr_document_templates
    where id = ${key}::uuid
      and organization_id = ${input.context.membership.organizationId}::uuid
      and status = 'active'
    limit 1
  `;
  const row = rows[0];
  if (!row || row.document_type !== input.documentType) {
    throw new Error("hr-document-template-not-found");
  }
  return resolveObjectStorageHrTemplate({
    id: row.id,
    name: row.name,
    version: row.version,
    documentType: row.document_type,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    sha256: row.sha256,
  });
}

export class HrDocumentTargetError extends Error {}

export interface HrDocumentTarget {
  membershipId: string;
  legalName: string;
  preferredName: string | null;
  employeeNumber: string | null;
  workEmail: string;
  personalAddress: Record<string, unknown>;
  designation: string | null;
  department: string | null;
  managerName: string | null;
  joiningDate: string | null;
  workLocation: string | null;
  workMode: string | null;
  organizationLegalName: string;
  organizationDisplayName: string;
  organizationAddress: Record<string, unknown>;
}

export async function requireHrDocumentTarget(
  context: CurrentPermissionContext,
  membershipId: string,
): Promise<HrDocumentTarget> {
  const scope =
    context.permissionScopes.get(hrPermissionKeys.employeeDocumentManage) ?? "organization";
  const rows = await getDatabaseClient()<
    Array<{
      membership_id: string;
      legal_name: string;
      preferred_name: string | null;
      employee_number: string | null;
      work_email: string;
      residential_address: Record<string, unknown>;
      designation_name: string | null;
      department_name: string | null;
      manager_name: string | null;
      joining_date: string | null;
      work_location: string | null;
      work_mode: string | null;
      organization_legal_name: string;
      organization_display_name: string;
      organization_address: Record<string, unknown>;
    }>
  >`
    with directory as (
      select membership.id,
        coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
          nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as display_name
      from public.memberships as membership
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      left join public.profiles as profile on profile.id = membership.user_id
      left join public.hr_employee_profiles as employee
        on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
      where membership.organization_id = ${context.membership.organizationId}::uuid
    )
    select membership.id as membership_id,
      coalesce(employee.legal_name, target_directory.display_name) as legal_name,
      employee.preferred_name, membership.employee_number, coalesce(auth_user.email, '') as work_email,
      employee.residential_address, designation.name as designation_name,
      department.name as department_name, manager_directory.display_name as manager_name,
      employee.joining_date::text, employee.work_location, employee.work_mode,
      organization.legal_name as organization_legal_name,
      coalesce(organization.trading_name, organization.legal_name) as organization_display_name,
      organization.registered_address as organization_address
    from public.memberships as membership
    join public.organizations as organization on organization.id = membership.organization_id
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    join directory as target_directory on target_directory.id = membership.id
    left join public.hr_employee_profiles as employee
      on employee.membership_id = membership.id and employee.organization_id = membership.organization_id
    left join public.hr_designations as designation on designation.id = employee.designation_id
    left join public.departments as department on department.id = membership.department_id
    left join directory as manager_directory on manager_directory.id = membership.manager_membership_id
    where membership.id = ${membershipId}::uuid
      and membership.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
      )
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HrDocumentTargetError("Employee is outside your document-management scope.");
  return {
    membershipId: row.membership_id,
    legalName: row.legal_name,
    preferredName: row.preferred_name,
    employeeNumber: row.employee_number,
    workEmail: row.work_email,
    personalAddress: row.residential_address ?? {},
    designation: row.designation_name,
    department: row.department_name,
    managerName: row.manager_name,
    joiningDate: row.joining_date,
    workLocation: row.work_location,
    workMode: row.work_mode,
    organizationLegalName: row.organization_legal_name,
    organizationDisplayName: row.organization_display_name,
    organizationAddress: row.organization_address ?? {},
  };
}
