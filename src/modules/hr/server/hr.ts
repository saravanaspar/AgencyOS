import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  getHrAttendanceData,
  type HrAttendanceWorkspaceData,
} from "@/modules/hr/server/attendance";
import { getHrLeaveData, type HrLeaveWorkspaceData } from "@/modules/hr/server/leave";
import {
  getHrOffboardingData,
  type HrOffboardingWorkspaceData,
} from "@/modules/hr/server/offboarding";
import {
  getHrOnboardingData,
  type HrOnboardingWorkspaceData,
} from "@/modules/hr/server/onboarding";
import { getHrDocumentsData, type HrDocumentsWorkspaceData } from "@/modules/hr/server/documents";
import { getHrSalaryData, type HrSalaryWorkspaceData } from "@/modules/hr/server/salary";
import {
  getHrSupportingDocumentsData,
  type HrSupportingDocumentsWorkspaceData,
} from "@/modules/hr/server/supporting-documents";
import {
  hrPermissionKeys,
  type EmployeeLifecycleStatus,
  type EmploymentType,
  type WorkMode,
} from "@/modules/hr/hr";
import type { AuthorizationFailureReason } from "@/modules/permissions/server/authorization";
import { getCurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrDesignation {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "active" | "inactive";
  employeeCount: number;
}

export interface HrEmployee {
  membershipId: string;
  userId: string;
  profileId: string | null;
  employeeNumber: string | null;
  membershipStatus: "active" | "invited" | "suspended" | "deactivated";
  legalName: string | null;
  preferredName: string | null;
  displayName: string;
  workEmail: string;
  personalEmail: string | null;
  personalPhone: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  designationId: string | null;
  designationName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  managerMembershipId: string | null;
  managerName: string | null;
  joiningDate: string | null;
  employmentType: EmploymentType | null;
  workLocation: string | null;
  workMode: WorkMode | null;
  lifecycleStatus: EmployeeLifecycleStatus;
  weeklyHours: number | null;
  isSelf: boolean;
}

export interface HrMemberOption {
  membershipId: string;
  displayName: string;
}

export interface HrWorkspaceData {
  employees: HrEmployee[];
  designations: HrDesignation[];
  departments: Array<{ id: string; name: string }>;
  managers: HrMemberOption[];
  attendance: HrAttendanceWorkspaceData;
  leave: HrLeaveWorkspaceData;
  salary: HrSalaryWorkspaceData;
  documents: HrDocumentsWorkspaceData;
  supportingDocuments: HrSupportingDocumentsWorkspaceData;
  onboarding: HrOnboardingWorkspaceData;
  offboarding: HrOffboardingWorkspaceData;
  summary: {
    visibleEmployees: number;
    activeEmployees: number;
    preboardingEmployees: number;
    noticePeriodEmployees: number;
  };
  capabilities: {
    canCreateEmployee: boolean;
    canUpdateEmployee: boolean;
    canUpdateSelf: boolean;
    canManageDesignations: boolean;
  };
}

export type HrWorkspaceResult =
  { allowed: true; data: HrWorkspaceData } | { allowed: false; reason: AuthorizationFailureReason };

interface EmployeeRow {
  membership_id: string;
  user_id: string;
  profile_id: string | null;
  employee_number: string | null;
  membership_status: HrEmployee["membershipStatus"];
  legal_name: string | null;
  preferred_name: string | null;
  display_name: string;
  work_email: string;
  personal_email: string | null;
  personal_phone: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  designation_id: string | null;
  designation_name: string | null;
  department_id: string | null;
  department_name: string | null;
  manager_membership_id: string | null;
  manager_name: string | null;
  joining_date: string | null;
  employment_type: EmploymentType | null;
  work_location: string | null;
  work_mode: WorkMode | null;
  lifecycle_status: EmployeeLifecycleStatus | null;
  weekly_hours: string | number | null;
}

interface DesignationRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "active" | "inactive";
  employee_count: number;
}

export async function getHrWorkspaceData(): Promise<HrWorkspaceResult> {
  const permissionResult = await getCurrentPermissionContext();
  if (!permissionResult.allowed) return permissionResult;

  const context = permissionResult.context;
  if (!context.permissions.has(hrPermissionKeys.workspace)) {
    return { allowed: false, reason: "insufficient-permission" };
  }

  const canViewEmployees = context.permissions.has(hrPermissionKeys.employeeView);
  const canViewDesignations = context.permissions.has(hrPermissionKeys.designationView);
  const canCreateEmployee = context.permissions.has(hrPermissionKeys.employeeCreate);
  const canUpdateEmployee = context.permissions.has(hrPermissionKeys.employeeUpdate);
  const canUpdateSelf = context.permissions.has(hrPermissionKeys.employeeUpdateSelf);
  const canManageDesignations = context.permissions.has(hrPermissionKeys.designationManage);
  const canManageEmployeeDirectory = canCreateEmployee || canUpdateEmployee;
  if (!canViewEmployees) return { allowed: false, reason: "insufficient-permission" };

  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const viewScope = context.permissionScopes.get(hrPermissionKeys.employeeView) ?? "own";
  const database = getDatabaseClient();

  try {
    const [
      employeeRows,
      designationRows,
      departmentRows,
      managerRows,
      attendance,
      leave,
      salary,
      documents,
      supportingDocuments,
      onboarding,
      offboarding,
    ] = await Promise.all([
      database<EmployeeRow[]>`
        with member_directory as (
          select membership.id,
            coalesce(
              employee_profile.preferred_name,
              employee_profile.legal_name,
              profile.display_name,
              nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1),
              'AgencyOS user'
            ) as display_name
          from public.memberships as membership
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee_profile
            on employee_profile.membership_id = membership.id
           and employee_profile.organization_id = membership.organization_id
          where membership.organization_id = ${organizationId}::uuid
        )
        select
          membership.id as membership_id,
          membership.user_id,
          employee_profile.id as profile_id,
          membership.employee_number,
          membership.status as membership_status,
          employee_profile.legal_name,
          employee_profile.preferred_name,
          directory.display_name,
          coalesce(auth_user.email, '') as work_email,
          employee_profile.personal_email,
          employee_profile.personal_phone,
          employee_profile.date_of_birth::text,
          employee_profile.nationality,
          employee_profile.designation_id,
          designation.name as designation_name,
          membership.department_id,
          department.name as department_name,
          membership.manager_membership_id,
          manager_directory.display_name as manager_name,
          employee_profile.joining_date::text,
          employee_profile.employment_type,
          employee_profile.work_location,
          employee_profile.work_mode,
          employee_profile.lifecycle_status,
          employee_profile.weekly_hours
        from public.memberships as membership
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        join member_directory as directory on directory.id = membership.id
        left join public.hr_employee_profiles as employee_profile
          on employee_profile.membership_id = membership.id
         and employee_profile.organization_id = membership.organization_id
        left join public.hr_designations as designation on designation.id = employee_profile.designation_id
        left join public.departments as department on department.id = membership.department_id
        left join member_directory as manager_directory on manager_directory.id = membership.manager_membership_id
        where membership.organization_id = ${organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${membershipId}::uuid,
            ${viewScope},
            membership.id,
            membership.id
          )
        order by
          case membership.status when 'active' then 1 when 'invited' then 2 else 3 end,
          lower(directory.display_name)
        limit 1000
      `,
      canViewDesignations
        ? database<DesignationRow[]>`
            select designation.id, designation.name, designation.code, designation.description,
              designation.status,
              case when ${canManageEmployeeDirectory || canManageDesignations}
                then count(employee.id)::integer else 0 end as employee_count
            from public.hr_designations as designation
            left join public.hr_employee_profiles as employee on employee.designation_id = designation.id
            where designation.organization_id = ${organizationId}::uuid
            group by designation.id
            order by case designation.status when 'active' then 1 else 2 end, lower(designation.name)
            limit 500
          `
        : Promise.resolve([] as DesignationRow[]),
      database<Array<{ id: string; name: string }>>`
        select department.id, department.name
        from public.departments as department
        where department.organization_id = ${organizationId}::uuid
          and (
            department.status = 'active'
            or exists (
              select 1 from public.memberships as assigned_member
              where assigned_member.organization_id = department.organization_id
                and assigned_member.department_id = department.id
            )
          )
        order by case department.status when 'active' then 1 else 2 end, lower(department.name)
      `,
      canManageEmployeeDirectory
        ? database<Array<{ membership_id: string; display_name: string }>>`
        select membership.id as membership_id,
          coalesce(
            employee.preferred_name,
            employee.legal_name,
            profile.display_name,
            nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
            split_part(coalesce(auth_user.email, ''), '@', 1),
            'AgencyOS user'
          ) as display_name
        from public.memberships as membership
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.profiles as profile on profile.id = membership.user_id
        left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
        where membership.organization_id = ${organizationId}::uuid
          and (
            membership.status = 'active'
            or exists (
              select 1 from public.memberships as report
              where report.organization_id = membership.organization_id
                and report.manager_membership_id = membership.id
            )
          )
        order by case membership.status when 'active' then 1 else 2 end, display_name
        limit 1000
      `
        : Promise.resolve([] as Array<{ membership_id: string; display_name: string }>),
      getHrAttendanceData(context),
      getHrLeaveData(context),
      getHrSalaryData(context),
      getHrDocumentsData(context),
      getHrSupportingDocumentsData(context),
      getHrOnboardingData(context),
      getHrOffboardingData(context),
    ]);

    const employees: HrEmployee[] = employeeRows.map((row) => {
      const isSelf = row.membership_id === membershipId;
      const canSeePersonalDetails = canUpdateEmployee || isSelf;
      return {
        membershipId: row.membership_id,
        userId: row.user_id,
        profileId: row.profile_id,
        employeeNumber: row.employee_number,
        membershipStatus: row.membership_status,
        legalName: canSeePersonalDetails ? row.legal_name : null,
        preferredName: row.preferred_name,
        displayName: row.display_name,
        workEmail: row.work_email,
        personalEmail: canSeePersonalDetails ? row.personal_email : null,
        personalPhone: canSeePersonalDetails ? row.personal_phone : null,
        dateOfBirth: canSeePersonalDetails ? row.date_of_birth : null,
        nationality: canSeePersonalDetails ? row.nationality : null,
        designationId: row.designation_id,
        designationName: row.designation_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        managerMembershipId: row.manager_membership_id,
        managerName: row.manager_name,
        joiningDate: row.joining_date,
        employmentType: row.employment_type,
        workLocation: row.work_location,
        workMode: row.work_mode,
        lifecycleStatus: row.lifecycle_status ?? "preboarding",
        weeklyHours: row.weekly_hours === null ? null : Number(row.weekly_hours),
        isSelf,
      };
    });

    return {
      allowed: true,
      data: {
        employees,
        designations: designationRows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          description: row.description,
          status: row.status,
          employeeCount: row.employee_count,
        })),
        departments: departmentRows,
        attendance,
        leave,
        salary,
        documents,
        supportingDocuments,
        onboarding,
        offboarding,
        managers: managerRows.map((row) => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
        })),
        summary: {
          visibleEmployees: employees.length,
          activeEmployees: employees.filter(
            (employee) =>
              employee.lifecycleStatus === "active" || employee.lifecycleStatus === "confirmed",
          ).length,
          preboardingEmployees: employees.filter(
            (employee) => employee.lifecycleStatus === "preboarding",
          ).length,
          noticePeriodEmployees: employees.filter(
            (employee) => employee.lifecycleStatus === "notice_period",
          ).length,
        },
        capabilities: {
          canCreateEmployee,
          canUpdateEmployee,
          canUpdateSelf,
          canManageDesignations,
        },
      },
    };
  } catch (error) {
    console.warn("[AgencyOS] HR workspace load failed.", {
      code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    });
    return { allowed: false, reason: "access-check-failed" };
  }
}
