import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type { SalaryComponentType, SalarySlipSource } from "@/modules/hr/salary";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrSalaryComponent {
  id: string;
  type: SalaryComponentType;
  name: string;
  amountMinor: number;
  taxable: boolean;
  sortOrder: number;
}

export interface HrSalaryStructure {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string | null;
  revisionNumber: number;
  currency: string;
  baseSalaryMinor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  isCurrent: boolean;
  components: HrSalaryComponent[];
  createdAt: string;
}

export interface HrSalarySlip {
  id: string;
  membershipId: string;
  employeeName: string;
  version: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  baseSalaryMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  bonusMinor: number;
  reimbursementMinor: number;
  grossMinor: number;
  netMinor: number;
  source: SalarySlipSource;
  fileName: string | null;
  fileStatus: string | null;
  acknowledgedAt: string | null;
  isSelf: boolean;
  createdAt: string;
}

export class HrSalaryTargetError extends Error {}

export interface HrSalaryTarget {
  membershipId: string;
  employeeName: string;
  employeeNumber: string | null;
  designationName: string | null;
  organizationName: string;
}

export async function requireHrSalaryTarget(
  context: CurrentPermissionContext,
  membershipId: string,
  permissionKey: string,
): Promise<HrSalaryTarget> {
  const scope = context.permissionScopes.get(permissionKey) ?? "organization";
  const rows = await getDatabaseClient()<
    Array<{
      membership_id: string;
      employee_name: string;
      employee_number: string | null;
      designation_name: string | null;
      organization_name: string;
    }>
  >`
    select membership.id as membership_id,
      coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
        nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
        split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
      membership.employee_number, designation.name as designation_name,
      organization.name as organization_name
    from public.memberships as membership
    join public.organizations as organization on organization.id = membership.organization_id
    join public.identity_accounts as auth_user on auth_user.id = membership.user_id
    left join public.profiles as profile on profile.id = membership.user_id
    left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
    left join public.hr_designations as designation on designation.id = employee.designation_id
    where membership.id = ${membershipId}::uuid
      and membership.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
      )
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HrSalaryTargetError("Employee is outside your salary-management scope.");
  return {
    membershipId: row.membership_id,
    employeeName: row.employee_name,
    employeeNumber: row.employee_number,
    designationName: row.designation_name,
    organizationName: row.organization_name,
  };
}

export interface HrSalaryWorkspaceData {
  structures: HrSalaryStructure[];
  slips: HrSalarySlip[];
  capabilities: {
    canViewSalary: boolean;
    canManageSalary: boolean;
    canViewSlips: boolean;
    canManageSlips: boolean;
    canAcknowledgeSlips: boolean;
  };
}

interface StructureRow {
  id: string;
  membership_id: string;
  employee_name: string;
  employee_number: string | null;
  revision_number: number;
  currency: string;
  base_salary_minor: string | number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  is_current: boolean;
  created_at: string;
  components: Array<{
    id: string;
    componentType: SalaryComponentType;
    name: string;
    amountMinor: number | string;
    taxable: boolean;
    sortOrder: number;
  }> | null;
}

interface SlipRow {
  id: string;
  membership_id: string;
  employee_name: string;
  version: number;
  period_start: string;
  period_end: string;
  currency: string;
  base_salary_minor: string | number;
  allowances_minor: string | number;
  deductions_minor: string | number;
  bonus_minor: string | number;
  reimbursement_minor: string | number;
  gross_minor: string | number;
  net_minor: string | number;
  source: SalarySlipSource;
  original_file_name: string | null;
  file_status: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export async function getHrSalaryData(
  context: CurrentPermissionContext,
): Promise<HrSalaryWorkspaceData> {
  const canViewSalary = context.permissions.has(hrPermissionKeys.salaryView);
  const canManageSalary = context.permissions.has(hrPermissionKeys.salaryManage);
  const canViewSlips = context.permissions.has(hrPermissionKeys.salarySlipView);
  const canManageSlips = context.permissions.has(hrPermissionKeys.salarySlipManage);
  const canAcknowledgeSlips = context.permissions.has(hrPermissionKeys.salarySlipAcknowledge);
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const database = getDatabaseClient();
  const salaryScope = context.permissionScopes.get(hrPermissionKeys.salaryView) ?? "own";
  const slipScope = context.permissionScopes.get(hrPermissionKeys.salarySlipView) ?? "own";

  const [structureRows, slipRows] = await Promise.all([
    canViewSalary
      ? database<StructureRow[]>`
        with member_directory as (
          select membership.id,
            coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as display_name
          from public.memberships as membership
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
          where membership.organization_id = ${organizationId}::uuid
        )
        select structure.id, structure.membership_id, directory.display_name as employee_name,
          membership.employee_number, structure.revision_number, structure.currency,
          structure.base_salary_minor, structure.effective_from::text, structure.effective_to::text,
          structure.notes,
          current_date between structure.effective_from and coalesce(structure.effective_to, 'infinity'::date) as is_current,
          structure.created_at::text,
          coalesce(jsonb_agg(jsonb_build_object(
            'id', component.id,
            'componentType', component.component_type,
            'name', component.name,
            'amountMinor', component.amount_minor,
            'taxable', component.taxable,
            'sortOrder', component.sort_order
          ) order by component.component_type, component.sort_order, lower(component.name))
          filter (where component.id is not null), '[]'::jsonb) as components
        from public.hr_salary_structures as structure
        join public.memberships as membership on membership.id = structure.membership_id
        join member_directory as directory on directory.id = structure.membership_id
        left join public.hr_salary_structure_components as component
          on component.salary_structure_id = structure.id
        where structure.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${salaryScope}, structure.membership_id, structure.membership_id
          )
        group by structure.id, directory.display_name, membership.employee_number
        order by lower(directory.display_name), structure.effective_from desc, structure.revision_number desc
        limit 1000
      `
      : Promise.resolve([] as StructureRow[]),
    canViewSlips
      ? database<SlipRow[]>`
        with member_directory as (
          select membership.id,
            coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as display_name
          from public.memberships as membership
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
          where membership.organization_id = ${organizationId}::uuid
        )
        select slip.id, slip.membership_id, directory.display_name as employee_name, slip.version,
          slip.period_start::text, slip.period_end::text, slip.currency, slip.base_salary_minor,
          slip.allowances_minor, slip.deductions_minor, slip.bonus_minor,
          slip.reimbursement_minor, slip.gross_minor, slip.net_minor, slip.source,
          slip.original_file_name, private_file.status as file_status,
          slip.acknowledged_at::text, slip.created_at::text
        from public.hr_salary_slips as slip
        join member_directory as directory on directory.id = slip.membership_id
        left join public.private_files as private_file on private_file.id = slip.private_file_id
        where slip.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid, ${slipScope}, slip.membership_id, slip.membership_id
          )
        order by slip.period_end desc, lower(directory.display_name), slip.version desc
        limit 500
      `
      : Promise.resolve([] as SlipRow[]),
  ]);

  return {
    structures: structureRows.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      employeeNumber: row.employee_number,
      revisionNumber: row.revision_number,
      currency: row.currency,
      baseSalaryMinor: Number(row.base_salary_minor),
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      notes: row.notes,
      isCurrent: row.is_current,
      components: (row.components ?? []).map((component) => ({
        id: component.id,
        type: component.componentType,
        name: component.name,
        amountMinor: Number(component.amountMinor),
        taxable: component.taxable,
        sortOrder: component.sortOrder,
      })),
      createdAt: row.created_at,
    })),
    slips: slipRows.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      version: row.version,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      currency: row.currency,
      baseSalaryMinor: Number(row.base_salary_minor),
      allowancesMinor: Number(row.allowances_minor),
      deductionsMinor: Number(row.deductions_minor),
      bonusMinor: Number(row.bonus_minor),
      reimbursementMinor: Number(row.reimbursement_minor),
      grossMinor: Number(row.gross_minor),
      netMinor: Number(row.net_minor),
      source: row.source,
      fileName: row.original_file_name,
      fileStatus: row.file_status,
      acknowledgedAt: row.acknowledged_at,
      isSelf: row.membership_id === membershipId,
      createdAt: row.created_at,
    })),
    capabilities: {
      canViewSalary,
      canManageSalary,
      canViewSlips,
      canManageSlips,
      canAcknowledgeSlips,
    },
  };
}
