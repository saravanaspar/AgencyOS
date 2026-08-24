import "server-only";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  leaveBalanceAvailable,
  type LeaveAccrualFrequency,
  type LeaveDayPart,
  type LeaveRequestStatus,
} from "@/modules/hr/leave";
import { hrPermissionKeys } from "@/modules/hr/hr";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

export interface HrLeaveType {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "active" | "inactive";
  isPaid: boolean;
  balanceRequired: boolean;
  accrualFrequency: LeaveAccrualFrequency;
  annualAllowanceDays: number;
  accrualRateDays: number;
  carryForwardLimitDays: number;
  attachmentRequiredAfterDays: number | null;
  requiresHrApproval: boolean;
}

export interface HrLeaveBalance {
  id: string;
  membershipId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  balanceYear: number;
  openingDays: number;
  accruedDays: number;
  carriedForwardDays: number;
  adjustmentDays: number;
  reservedDays: number;
  usedDays: number;
  availableDays: number;
  lastAccruedThrough: string | null;
  isSelf: boolean;
}

export interface HrLeaveRequestAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
}

export interface HrLeaveRequest {
  id: string;
  membershipId: string;
  employeeName: string;
  departmentName: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  dayPart: LeaveDayPart;
  requestedDays: number;
  reason: string;
  status: LeaveRequestStatus;
  teamConflictCount: number;
  approvalRequestId: string | null;
  attachment: HrLeaveRequestAttachment | null;
  createdAt: string;
  isSelf: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

export interface HrLeaveBalanceEvent {
  id: string;
  membershipId: string;
  employeeName: string;
  leaveTypeName: string;
  balanceYear: number;
  eventType: string;
  deltaDays: number;
  reason: string | null;
  createdAt: string;
}

export interface HrLeaveWorkspaceData {
  timezone: string;
  currentDate: string;
  currentYear: number;
  currentMembershipId: string;
  types: HrLeaveType[];
  balances: HrLeaveBalance[];
  requests: HrLeaveRequest[];
  events: HrLeaveBalanceEvent[];
  summary: {
    ownAvailableDays: number;
    pendingRequests: number;
    approvedUpcoming: number;
    teamConflicts: number;
  };
  capabilities: {
    canView: boolean;
    canManageTypes: boolean;
    canAdjustBalances: boolean;
    canCreateRequest: boolean;
    canCancelRequest: boolean;
  };
}

interface LeaveTypeRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "active" | "inactive";
  is_paid: boolean;
  balance_required: boolean;
  accrual_frequency: LeaveAccrualFrequency;
  annual_allowance_days: string | number;
  accrual_rate_days: string | number;
  carry_forward_limit_days: string | number;
  attachment_required_after_days: string | number | null;
  requires_hr_approval: boolean;
}

interface BalanceRow {
  id: string;
  membership_id: string;
  employee_name: string;
  leave_type_id: string;
  leave_type_name: string;
  balance_year: number;
  opening_days: string | number;
  accrued_days: string | number;
  carried_forward_days: string | number;
  adjustment_days: string | number;
  reserved_days: string | number;
  used_days: string | number;
  last_accrued_through: string | null;
}

interface RequestRow {
  id: string;
  membership_id: string;
  employee_name: string;
  department_name: string | null;
  leave_type_id: string;
  leave_type_name: string;
  is_paid: boolean;
  balance_required: boolean;
  attachment_required_after_days: string | number | null;
  start_date: string;
  end_date: string;
  day_part: LeaveDayPart;
  requested_days: string | number;
  reason: string;
  status: LeaveRequestStatus;
  team_conflict_count: number;
  approval_request_id: string | null;
  attachment_id: string | null;
  attachment_file_name: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: string | number | null;
  attachment_status: string | null;
  created_at: Date;
}

interface EventRow {
  id: string;
  membership_id: string;
  employee_name: string;
  leave_type_name: string;
  balance_year: number;
  event_type: string;
  opening_delta: string | number;
  accrued_delta: string | number;
  carried_forward_delta: string | number;
  adjustment_delta: string | number;
  reserved_delta: string | number;
  used_delta: string | number;
  reason: string | null;
  created_at: Date;
}

const numberValue = (value: string | number | null): number => Number(value ?? 0);

export async function getHrLeaveData(
  context: CurrentPermissionContext,
): Promise<HrLeaveWorkspaceData> {
  const canView = context.permissions.has(hrPermissionKeys.leaveRequestView);
  const canViewTypes = context.permissions.has(hrPermissionKeys.leaveTypeView);
  const canViewBalances = context.permissions.has(hrPermissionKeys.leaveBalanceView);
  const canManageTypes = context.permissions.has(hrPermissionKeys.leaveTypeManage);
  const canAdjustBalances = context.permissions.has(hrPermissionKeys.leaveBalanceAdjust);
  const canCreateRequest = context.permissions.has(hrPermissionKeys.leaveRequestCreate);
  const canCancelRequest = context.permissions.has(hrPermissionKeys.leaveRequestCancel);
  const organizationId = context.membership.organizationId;
  const membershipId = context.membership.id;
  const requestScope = context.permissionScopes.get(hrPermissionKeys.leaveRequestView) ?? "own";
  const balanceScope = context.permissionScopes.get(hrPermissionKeys.leaveBalanceView) ?? "own";
  const database = getDatabaseClient();

  const [clockRows, typeRows, balanceRows, requestRows, eventRows] = await Promise.all([
    database<Array<{ timezone: string; current_date: string; current_year: number }>>`
      select organization.timezone,
        timezone(organization.timezone, now())::date::text as current_date,
        extract(year from timezone(organization.timezone, now()))::integer as current_year
      from public.organizations as organization
      where organization.id = ${organizationId}::uuid
      limit 1
    `,
    canViewTypes
      ? database<LeaveTypeRow[]>`
          select id, name, code, description, status, is_paid, balance_required,
            accrual_frequency, annual_allowance_days, accrual_rate_days,
            carry_forward_limit_days, attachment_required_after_days, requires_hr_approval
          from public.hr_leave_types
          where organization_id = ${organizationId}::uuid
          order by case status when 'active' then 1 else 2 end, lower(name)
          limit 200
        `
      : Promise.resolve([] as LeaveTypeRow[]),
    canViewBalances
      ? database<BalanceRow[]>`
          select balance.id, balance.membership_id,
            coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
            balance.leave_type_id, leave_type.name as leave_type_name, balance.balance_year,
            balance.opening_days, balance.accrued_days, balance.carried_forward_days,
            balance.adjustment_days, balance.reserved_days, balance.used_days,
            balance.last_accrued_through::text
          from public.hr_leave_balances as balance
          join public.hr_leave_types as leave_type on leave_type.id = balance.leave_type_id
          join public.memberships as membership on membership.id = balance.membership_id
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
          where balance.organization_id = ${organizationId}::uuid
            and balance.balance_year between extract(year from current_date)::integer - 1
              and extract(year from current_date)::integer
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${balanceScope}, balance.membership_id, balance.membership_id
            )
          order by balance.balance_year desc, employee_name, lower(leave_type.name)
          limit 2000
        `
      : Promise.resolve([] as BalanceRow[]),
    canView
      ? database<RequestRow[]>`
          select request.id, request.membership_id,
            coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
            department.name as department_name, request.leave_type_id,
            leave_type.name as leave_type_name, leave_type.is_paid, leave_type.balance_required,
            leave_type.attachment_required_after_days, request.start_date::text,
            request.end_date::text, request.day_part, request.requested_days, request.reason,
            request.status, request.team_conflict_count, request.approval_request_id,
            attachment.id as attachment_id, attachment.file_name as attachment_file_name,
            attachment.mime_type as attachment_mime_type,
            attachment.size_bytes as attachment_size_bytes, private_file.status as attachment_status,
            request.created_at
          from public.hr_leave_requests as request
          join public.hr_leave_types as leave_type on leave_type.id = request.leave_type_id
          join public.memberships as membership on membership.id = request.membership_id
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
          left join public.departments as department on department.id = membership.department_id
          left join public.hr_leave_request_attachments as attachment
            on attachment.leave_request_id = request.id
          left join public.private_files as private_file on private_file.id = attachment.private_file_id
          where request.organization_id = ${organizationId}::uuid
            and request.end_date >= current_date - interval '90 days'
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${requestScope}, request.membership_id, request.membership_id
            )
          order by request.start_date desc, request.created_at desc
          limit 1000
        `
      : Promise.resolve([] as RequestRow[]),
    canViewBalances
      ? database<EventRow[]>`
          select event.id, event.membership_id,
            coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as employee_name,
            leave_type.name as leave_type_name, event.balance_year, event.event_type,
            event.opening_delta, event.accrued_delta, event.carried_forward_delta,
            event.adjustment_delta, event.reserved_delta, event.used_delta,
            event.reason, event.created_at
          from public.hr_leave_balance_events as event
          join public.hr_leave_types as leave_type on leave_type.id = event.leave_type_id
          join public.memberships as membership on membership.id = event.membership_id
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
          where event.organization_id = ${organizationId}::uuid
            and private.crm_scope_allows_membership(
              ${membershipId}::uuid, ${balanceScope}, event.membership_id, event.membership_id
            )
          order by event.created_at desc
          limit 200
        `
      : Promise.resolve([] as EventRow[]),
  ]);

  const clock = clockRows[0] ?? {
    timezone: "UTC",
    current_date: "",
    current_year: new Date().getUTCFullYear(),
  };
  const types = typeRows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    isPaid: row.is_paid,
    balanceRequired: row.balance_required,
    accrualFrequency: row.accrual_frequency,
    annualAllowanceDays: numberValue(row.annual_allowance_days),
    accrualRateDays: numberValue(row.accrual_rate_days),
    carryForwardLimitDays: numberValue(row.carry_forward_limit_days),
    attachmentRequiredAfterDays:
      row.attachment_required_after_days === null
        ? null
        : numberValue(row.attachment_required_after_days),
    requiresHrApproval: row.requires_hr_approval,
  }));
  const balances = balanceRows.map((row) => {
    const values = {
      openingDays: numberValue(row.opening_days),
      accruedDays: numberValue(row.accrued_days),
      carriedForwardDays: numberValue(row.carried_forward_days),
      adjustmentDays: numberValue(row.adjustment_days),
      reservedDays: numberValue(row.reserved_days),
      usedDays: numberValue(row.used_days),
    };
    return {
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      leaveTypeId: row.leave_type_id,
      leaveTypeName: row.leave_type_name,
      balanceYear: row.balance_year,
      ...values,
      availableDays: leaveBalanceAvailable(values),
      lastAccruedThrough: row.last_accrued_through,
      isSelf: row.membership_id === membershipId,
    };
  });
  const requests = requestRows.map((row) => {
    const requestedDays = numberValue(row.requested_days);
    const attachmentRequired =
      row.attachment_required_after_days !== null &&
      requestedDays >= numberValue(row.attachment_required_after_days);
    const isSelf = row.membership_id === membershipId;
    return {
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      departmentName: row.department_name,
      leaveTypeId: row.leave_type_id,
      leaveTypeName: row.leave_type_name,
      isPaid: row.is_paid,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPart: row.day_part,
      requestedDays,
      reason: row.reason,
      status: row.status,
      teamConflictCount: row.team_conflict_count,
      approvalRequestId: row.approval_request_id,
      attachment:
        row.attachment_id && row.attachment_file_name && row.attachment_mime_type
          ? {
              id: row.attachment_id,
              fileName: row.attachment_file_name,
              mimeType: row.attachment_mime_type,
              sizeBytes: numberValue(row.attachment_size_bytes),
              status: row.attachment_status ?? "quarantined",
            }
          : null,
      createdAt: row.created_at.toISOString(),
      isSelf,
      canSubmit:
        isSelf && row.status === "draft" && (!attachmentRequired || Boolean(row.attachment_id)),
      canCancel:
        isSelf &&
        canCancelRequest &&
        (row.status === "draft" || row.status === "pending" || row.status === "approved"),
    };
  });
  const events = eventRows.map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    employeeName: row.employee_name,
    leaveTypeName: row.leave_type_name,
    balanceYear: row.balance_year,
    eventType: row.event_type,
    deltaDays:
      numberValue(row.opening_delta) +
      numberValue(row.accrued_delta) +
      numberValue(row.carried_forward_delta) +
      numberValue(row.adjustment_delta) -
      numberValue(row.reserved_delta) -
      numberValue(row.used_delta),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }));

  return {
    timezone: clock.timezone,
    currentDate: clock.current_date,
    currentYear: clock.current_year,
    currentMembershipId: membershipId,
    types,
    balances,
    requests,
    events,
    summary: {
      ownAvailableDays: balances
        .filter((balance) => balance.isSelf && balance.balanceYear === clock.current_year)
        .reduce((total, balance) => total + balance.availableDays, 0),
      pendingRequests: requests.filter((request) => request.status === "pending").length,
      approvedUpcoming: requests.filter(
        (request) => request.status === "approved" && request.endDate >= clock.current_date,
      ).length,
      teamConflicts: requests.reduce((total, request) => total + request.teamConflictCount, 0),
    },
    capabilities: {
      canView,
      canManageTypes,
      canAdjustBalances,
      canCreateRequest,
      canCancelRequest,
    },
  };
}
