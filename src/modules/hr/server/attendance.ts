import "server-only";

import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

import { getDatabaseClient } from "@/integrations/postgres/database";
import {
  attendanceDurationMinutes,
  type AttendanceCorrectionStatus,
  type AttendanceSource,
  type AttendanceStatus,
} from "@/modules/hr/attendance";
import { hrPermissionKeys } from "@/modules/hr/hr";

export interface HrAttendanceRecord {
  id: string;
  membershipId: string;
  employeeName: string;
  attendanceDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  attendanceStatus: AttendanceStatus;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  notes: string | null;
  source: AttendanceSource;
  revision: number;
  durationMinutes: number | null;
}

export interface HrAttendanceCorrection {
  id: string;
  membershipId: string;
  employeeName: string;
  attendanceDate: string;
  proposedCheckInAt: string | null;
  proposedCheckOutAt: string | null;
  proposedAttendanceStatus: AttendanceStatus;
  proposedLateMinutes: number;
  proposedEarlyDepartureMinutes: number;
  proposedOvertimeMinutes: number;
  proposedNotes: string | null;
  reason: string;
  status: AttendanceCorrectionStatus;
  approvalRequestId: string | null;
  createdAt: string;
}

export interface HrAttendanceWorkspaceData {
  timezone: string;
  currentDate: string;
  currentMonth: string;
  currentMembershipId: string;
  records: HrAttendanceRecord[];
  corrections: HrAttendanceCorrection[];
  todayRecord: HrAttendanceRecord | null;
  summary: {
    recordedDays: number;
    presentDays: number;
    workFromHomeDays: number;
    halfDays: number;
    absentDays: number;
    workedMinutes: number;
    lateMinutes: number;
    earlyDepartureMinutes: number;
    overtimeMinutes: number;
  };
  capabilities: {
    canView: boolean;
    canCheck: boolean;
    canManage: boolean;
    canRequestCorrection: boolean;
  };
}

interface AttendanceRow {
  id: string;
  membership_id: string;
  employee_name: string;
  attendance_date: string;
  check_in_at: Date | null;
  check_out_at: Date | null;
  attendance_status: AttendanceStatus;
  late_minutes: number;
  early_departure_minutes: number;
  overtime_minutes: number;
  notes: string | null;
  source: AttendanceSource;
  revision: number;
}

interface CorrectionRow {
  id: string;
  membership_id: string;
  employee_name: string;
  attendance_date: string;
  proposed_check_in_at: Date | null;
  proposed_check_out_at: Date | null;
  proposed_attendance_status: AttendanceStatus;
  proposed_late_minutes: number;
  proposed_early_departure_minutes: number;
  proposed_overtime_minutes: number;
  proposed_notes: string | null;
  reason: string;
  status: AttendanceCorrectionStatus;
  approval_request_id: string | null;
  created_at: Date;
}

function toAttendanceRecord(row: AttendanceRow): HrAttendanceRecord {
  const checkInAt = row.check_in_at?.toISOString() ?? null;
  const checkOutAt = row.check_out_at?.toISOString() ?? null;
  return {
    id: row.id,
    membershipId: row.membership_id,
    employeeName: row.employee_name,
    attendanceDate: row.attendance_date,
    checkInAt,
    checkOutAt,
    attendanceStatus: row.attendance_status,
    lateMinutes: row.late_minutes,
    earlyDepartureMinutes: row.early_departure_minutes,
    overtimeMinutes: row.overtime_minutes,
    notes: row.notes,
    source: row.source,
    revision: row.revision,
    durationMinutes: attendanceDurationMinutes(checkInAt, checkOutAt),
  };
}

export async function getHrAttendanceData(
  context: CurrentPermissionContext,
): Promise<HrAttendanceWorkspaceData> {
  const canView = context.permissions.has(hrPermissionKeys.attendanceView);
  const canCheck = context.permissions.has(hrPermissionKeys.attendanceCheck);
  const canManage = context.permissions.has(hrPermissionKeys.attendanceManage);
  const canRequestCorrection = context.permissions.has(hrPermissionKeys.attendanceCorrectionCreate);
  const organizationId = context.membership.organizationId;
  const currentMembershipId = context.membership.id;
  const viewScope = context.permissionScopes.get(hrPermissionKeys.attendanceView) ?? "own";
  const database = getDatabaseClient();

  const [clockRows, attendanceRows, correctionRows] = await Promise.all([
    database<Array<{ timezone: string; current_date: string; current_month: string }>>`
      select organization.timezone,
        timezone(organization.timezone, now())::date::text as current_date,
        to_char(date_trunc('month', timezone(organization.timezone, now())), 'YYYY-MM') as current_month
      from public.organizations as organization
      where organization.id = ${organizationId}::uuid
      limit 1
    `,
    canView
      ? database<AttendanceRow[]>`
          select attendance.id, attendance.membership_id,
            coalesce(
              employee.preferred_name,
              employee.legal_name,
              profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1),
              'AgencyOS user'
            ) as employee_name,
            attendance.attendance_date::text, attendance.check_in_at, attendance.check_out_at,
            attendance.attendance_status, attendance.late_minutes,
            attendance.early_departure_minutes, attendance.overtime_minutes,
            attendance.notes, attendance.source, attendance.revision
          from public.hr_attendance_records as attendance
          join public.memberships as membership on membership.id = attendance.membership_id
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee
            on employee.membership_id = membership.id
           and employee.organization_id = membership.organization_id
          join public.organizations as organization on organization.id = attendance.organization_id
          where attendance.organization_id = ${organizationId}::uuid
            and attendance.attendance_date >= date_trunc(
              'month', timezone(organization.timezone, now())
            )::date
            and private.crm_scope_allows_membership(
              ${currentMembershipId}::uuid,
              ${viewScope},
              attendance.membership_id,
              attendance.membership_id
            )
          order by attendance.attendance_date desc, employee_name
          limit 1000
        `
      : Promise.resolve([] as AttendanceRow[]),
    canView
      ? database<CorrectionRow[]>`
          select correction.id, correction.membership_id,
            coalesce(
              employee.preferred_name,
              employee.legal_name,
              profile.display_name,
              nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
              split_part(coalesce(auth_user.email, ''), '@', 1),
              'AgencyOS user'
            ) as employee_name,
            correction.attendance_date::text, correction.proposed_check_in_at,
            correction.proposed_check_out_at, correction.proposed_attendance_status,
            correction.proposed_late_minutes, correction.proposed_early_departure_minutes,
            correction.proposed_overtime_minutes, correction.proposed_notes,
            correction.reason, correction.status, correction.approval_request_id,
            correction.created_at
          from public.hr_attendance_corrections as correction
          join public.memberships as membership on membership.id = correction.membership_id
          join public.identity_accounts as auth_user on auth_user.id = membership.user_id
          left join public.profiles as profile on profile.id = membership.user_id
          left join public.hr_employee_profiles as employee
            on employee.membership_id = membership.id
           and employee.organization_id = membership.organization_id
          where correction.organization_id = ${organizationId}::uuid
            and private.crm_scope_allows_membership(
              ${currentMembershipId}::uuid,
              ${viewScope},
              correction.membership_id,
              correction.membership_id
            )
          order by correction.created_at desc
          limit 200
        `
      : Promise.resolve([] as CorrectionRow[]),
  ]);

  const clock = clockRows[0] ?? { timezone: "UTC", current_date: "", current_month: "" };
  const records = attendanceRows.map(toAttendanceRecord);
  const todayRecord =
    records.find(
      (record) =>
        record.membershipId === currentMembershipId && record.attendanceDate === clock.current_date,
    ) ?? null;

  return {
    timezone: clock.timezone,
    currentDate: clock.current_date,
    currentMonth: clock.current_month,
    currentMembershipId,
    records,
    corrections: correctionRows.map((row) => ({
      id: row.id,
      membershipId: row.membership_id,
      employeeName: row.employee_name,
      attendanceDate: row.attendance_date,
      proposedCheckInAt: row.proposed_check_in_at?.toISOString() ?? null,
      proposedCheckOutAt: row.proposed_check_out_at?.toISOString() ?? null,
      proposedAttendanceStatus: row.proposed_attendance_status,
      proposedLateMinutes: row.proposed_late_minutes,
      proposedEarlyDepartureMinutes: row.proposed_early_departure_minutes,
      proposedOvertimeMinutes: row.proposed_overtime_minutes,
      proposedNotes: row.proposed_notes,
      reason: row.reason,
      status: row.status,
      approvalRequestId: row.approval_request_id,
      createdAt: row.created_at.toISOString(),
    })),
    todayRecord,
    summary: {
      recordedDays: records.length,
      presentDays: records.filter((record) => record.attendanceStatus === "present").length,
      workFromHomeDays: records.filter((record) => record.attendanceStatus === "work_from_home")
        .length,
      halfDays: records.filter((record) => record.attendanceStatus === "half_day").length,
      absentDays: records.filter((record) => record.attendanceStatus === "absent").length,
      workedMinutes: records.reduce((total, record) => total + (record.durationMinutes ?? 0), 0),
      lateMinutes: records.reduce((total, record) => total + record.lateMinutes, 0),
      earlyDepartureMinutes: records.reduce(
        (total, record) => total + record.earlyDepartureMinutes,
        0,
      ),
      overtimeMinutes: records.reduce((total, record) => total + record.overtimeMinutes, 0),
    },
    capabilities: { canView, canCheck, canManage, canRequestCorrection },
  };
}
