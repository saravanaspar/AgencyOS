"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { submitApprovalForRecord } from "@/modules/approvals/server/approvals";
import { ensureHrApprovalPolicy } from "@/modules/hr/actions/approval-policies";
import {
  formText,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  attendanceCheckSchema,
  attendanceCorrectionSchema,
  manualAttendanceSchema,
} from "@/modules/hr/schemas/attendance";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";

const ATTENDANCE_CORRECTION_POLICY_KEY = "hr_attendance_correction";

function attendanceInput(formData: FormData) {
  return {
    membershipId: formText(formData, "membershipId"),
    attendanceDate: formText(formData, "attendanceDate"),
    checkInTime: formText(formData, "checkInTime"),
    checkOutTime: formText(formData, "checkOutTime"),
    attendanceStatus: formText(formData, "attendanceStatus"),
    lateMinutes: formText(formData, "lateMinutes"),
    earlyDepartureMinutes: formText(formData, "earlyDepartureMinutes"),
    overtimeMinutes: formText(formData, "overtimeMinutes"),
    notes: formText(formData, "notes"),
  };
}

async function ensureAttendanceCorrectionPolicy(
  context: Parameters<typeof ensureHrApprovalPolicy>[0],
): Promise<void> {
  await ensureHrApprovalPolicy(context, {
    key: ATTENDANCE_CORRECTION_POLICY_KEY,
    name: "Attendance correction",
    description: "Routes employee attendance corrections to the employee's assigned manager.",
    sourceModule: "hr",
    entityType: "attendance_correction",
    allowSelfApproval: false,
    allowReassignment: true,
    steps: [
      {
        name: "Manager review",
        stageOrder: 1,
        sortOrder: 1,
        selectorType: "manager",
        selectorRoleKey: null,
        selectorMembershipId: null,
        decisionMode: "any",
        conditions: {},
        commentRequired: false,
        reminderAfterHours: 24,
        escalationAfterHours: 72,
        expiresAfterHours: 168,
      },
    ],
  });
}

export async function attendanceCheckAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = attendanceCheckSchema.safeParse({ operation: formText(formData, "operation") });
  if (!parsed.success) return stateError("Choose a valid attendance action.");

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.attendanceCheck,
  ]);
  if (!authorization.allowed) return stateError("Your attendance access is no longer active.");

  const { context } = authorization;
  const database = getDatabaseClient();
  try {
    await database.begin(async (sql) => {
      if (parsed.data.operation === "check_in") {
        const rows = await sql<Array<{ id: string }>>`
          insert into public.hr_attendance_records (
            organization_id, membership_id, attendance_date, check_in_at,
            attendance_status, source, created_by_membership_id, updated_by_membership_id
          )
          select organization.id, ${context.membership.id}::uuid,
            timezone(organization.timezone, now())::date, now(),
            'present', 'self', ${context.membership.id}::uuid, ${context.membership.id}::uuid
          from public.organizations as organization
          where organization.id = ${context.membership.organizationId}::uuid
          on conflict (organization_id, membership_id, attendance_date) do update set
            check_in_at = excluded.check_in_at,
            attendance_status = case
              when public.hr_attendance_records.attendance_status = 'absent' then 'present'
              else public.hr_attendance_records.attendance_status
            end,
            source = 'self',
            revision = public.hr_attendance_records.revision + 1,
            updated_by_membership_id = excluded.updated_by_membership_id
          where public.hr_attendance_records.check_in_at is null
          returning id
        `;
        if (!rows[0]) throw new HrActionError("You are already checked in for today.");
      } else {
        const rows = await sql<Array<{ id: string }>>`
          update public.hr_attendance_records as attendance
          set check_out_at = now(), source = 'self', revision = revision + 1,
            updated_by_membership_id = ${context.membership.id}::uuid
          from public.organizations as organization
          where attendance.organization_id = ${context.membership.organizationId}::uuid
            and attendance.membership_id = ${context.membership.id}::uuid
            and organization.id = attendance.organization_id
            and attendance.attendance_date = timezone(organization.timezone, now())::date
            and attendance.check_in_at is not null
            and attendance.check_out_at is null
          returning attendance.id
        `;
        if (!rows[0])
          throw new HrActionError("Check in before checking out, or you are already checked out.");
      }

      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          ${`hr.attendance_${parsed.data.operation}`}, 'hr_attendance',
          ${context.membership.id}, 'web',
          ${sql.json({ actorMembershipId: context.membership.id })}
        )
      `;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: parsed.data.operation === "check_in" ? "Checked in." : "Checked out.",
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Attendance could not be updated.",
    );
  }
}

export async function saveManualAttendanceAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = manualAttendanceSchema.safeParse(attendanceInput(formData));
  if (!parsed.success) {
    return stateError(
      "Check the attendance fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.attendanceManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot manage attendance records.");

  const { context } = authorization;
  const scope = context.permissionScopes.get(hrPermissionKeys.attendanceManage) ?? "own";
  const database = getDatabaseClient();
  try {
    await database.begin(async (sql) => {
      const targets = await sql<Array<{ id: string; timezone: string }>>`
        select membership.id, organization.timezone
        from public.memberships as membership
        join public.organizations as organization on organization.id = membership.organization_id
        where membership.id = ${parsed.data.membershipId}::uuid
          and membership.organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid,
            ${scope},
            membership.id,
            membership.id
          )
        limit 1
      `;
      const target = targets[0];
      if (!target) throw new HrActionError("The employee is outside your attendance scope.");

      await sql`
        insert into public.hr_attendance_records (
          organization_id, membership_id, attendance_date, check_in_at, check_out_at,
          attendance_status, late_minutes, early_departure_minutes, overtime_minutes,
          notes, source, created_by_membership_id, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.membershipId}::uuid,
          ${parsed.data.attendanceDate}::date,
          case when ${parsed.data.checkInTime}::text is null then null
            else (${parsed.data.attendanceDate}::date + ${parsed.data.checkInTime}::time)
              at time zone ${target.timezone} end,
          case when ${parsed.data.checkOutTime}::text is null then null
            else (${parsed.data.attendanceDate}::date + ${parsed.data.checkOutTime}::time)
              at time zone ${target.timezone} end,
          ${parsed.data.attendanceStatus}, ${parsed.data.lateMinutes ?? 0},
          ${parsed.data.earlyDepartureMinutes ?? 0}, ${parsed.data.overtimeMinutes ?? 0},
          ${parsed.data.notes}, 'manual', ${context.membership.id}::uuid,
          ${context.membership.id}::uuid
        )
        on conflict (organization_id, membership_id, attendance_date) do update set
          check_in_at = excluded.check_in_at,
          check_out_at = excluded.check_out_at,
          attendance_status = excluded.attendance_status,
          late_minutes = excluded.late_minutes,
          early_departure_minutes = excluded.early_departure_minutes,
          overtime_minutes = excluded.overtime_minutes,
          notes = excluded.notes,
          source = 'manual',
          revision = public.hr_attendance_records.revision + 1,
          updated_by_membership_id = excluded.updated_by_membership_id
      `;
      await sql`
        insert into public.audit_events (
          organization_id, actor_user_id, action, entity_type, entity_id, source, metadata
        ) values (
          ${context.membership.organizationId}::uuid, ${context.user.id}::uuid,
          'hr.attendance_manual_saved', 'hr_attendance',
          ${`${parsed.data.membershipId}:${parsed.data.attendanceDate}`}, 'web',
          ${sql.json({
            actorMembershipId: context.membership.id,
            targetMembershipId: parsed.data.membershipId,
            attendanceDate: parsed.data.attendanceDate,
          })}
        )
      `;
    });
    revalidatePath("/hr");
    return { status: "success", message: "Attendance record saved." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Attendance could not be saved.",
    );
  }
}

export async function requestAttendanceCorrectionAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = attendanceCorrectionSchema.safeParse({
    ...attendanceInput(formData),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the correction fields and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.attendanceView,
    hrPermissionKeys.attendanceCorrectionCreate,
    "approvals.request.create",
  ]);
  if (!authorization.allowed) return stateError("You cannot submit an attendance correction.");
  const { context } = authorization;
  if (parsed.data.membershipId !== context.membership.id) {
    return stateError("You can request a correction only for your own attendance.");
  }

  const database = getDatabaseClient();
  let correctionId: string | null = null;
  try {
    await ensureAttendanceCorrectionPolicy(context);
    const rows = await database<
      Array<{ id: string; department_id: string | null; display_name: string }>
    >`
      with clock as (
        select organization.timezone,
          timezone(organization.timezone, now())::date as current_date
        from public.organizations as organization
        where organization.id = ${context.membership.organizationId}::uuid
      ), target as (
        select membership.id, membership.department_id,
          coalesce(
            employee.preferred_name,
            employee.legal_name,
            profile.display_name,
            nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
            split_part(coalesce(auth_user.email, ''), '@', 1),
            'AgencyOS user'
          ) as display_name,
          clock.timezone, clock.current_date
        from public.memberships as membership
        join public.identity_accounts as auth_user on auth_user.id = membership.user_id
        left join public.profiles as profile on profile.id = membership.user_id
        left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
        cross join clock
        where membership.id = ${context.membership.id}::uuid
          and membership.organization_id = ${context.membership.organizationId}::uuid
          and ${parsed.data.attendanceDate}::date <= clock.current_date
      )
      insert into public.hr_attendance_corrections (
        organization_id, membership_id, attendance_record_id, attendance_date,
        proposed_check_in_at, proposed_check_out_at, proposed_attendance_status,
        proposed_late_minutes, proposed_early_departure_minutes, proposed_overtime_minutes,
        proposed_notes, reason, requested_by_membership_id
      )
      select ${context.membership.organizationId}::uuid, target.id, attendance.id,
        ${parsed.data.attendanceDate}::date,
        case when ${parsed.data.checkInTime}::text is null then null
          else (${parsed.data.attendanceDate}::date + ${parsed.data.checkInTime}::time)
            at time zone target.timezone end,
        case when ${parsed.data.checkOutTime}::text is null then null
          else (${parsed.data.attendanceDate}::date + ${parsed.data.checkOutTime}::time)
            at time zone target.timezone end,
        ${parsed.data.attendanceStatus}, ${parsed.data.lateMinutes ?? 0},
        ${parsed.data.earlyDepartureMinutes ?? 0}, ${parsed.data.overtimeMinutes ?? 0},
        ${parsed.data.notes}, ${parsed.data.reason}, ${context.membership.id}::uuid
      from target
      left join public.hr_attendance_records as attendance
        on attendance.organization_id = ${context.membership.organizationId}::uuid
       and attendance.membership_id = target.id
       and attendance.attendance_date = ${parsed.data.attendanceDate}::date
      returning id,
        (select department_id from target) as department_id,
        (select display_name from target) as display_name
    `;
    const correction = rows[0];
    if (!correction) throw new HrActionError("Future attendance dates cannot be corrected.");
    correctionId = correction.id;

    const approvalRequestId = await submitApprovalForRecord(context, {
      definitionKey: ATTENDANCE_CORRECTION_POLICY_KEY,
      title: `Attendance correction · ${correction.display_name} · ${parsed.data.attendanceDate}`,
      sourceModule: "hr",
      entityType: "attendance_correction",
      entityId: correction.id,
      deepLink: "/hr#attendance-corrections",
      departmentId: correction.department_id,
      amount: null,
      currency: null,
      snapshot: {
        membershipId: context.membership.id,
        attendanceDate: parsed.data.attendanceDate,
        attendanceStatus: parsed.data.attendanceStatus,
        checkInTime: parsed.data.checkInTime,
        checkOutTime: parsed.data.checkOutTime,
        lateMinutes: parsed.data.lateMinutes ?? 0,
        earlyDepartureMinutes: parsed.data.earlyDepartureMinutes ?? 0,
        overtimeMinutes: parsed.data.overtimeMinutes ?? 0,
        reason: parsed.data.reason,
      },
      dueAt: null,
    });

    await database`
      update public.hr_attendance_corrections
      set approval_request_id = ${approvalRequestId}::uuid
      where id = ${correction.id}::uuid
        and organization_id = ${context.membership.organizationId}::uuid
    `;
    revalidatePath("/hr");
    revalidatePath("/approvals");
    return { status: "success", message: "Attendance correction sent to your manager." };
  } catch (error) {
    if (correctionId) {
      await database`
        delete from public.hr_attendance_corrections
        where id = ${correctionId}::uuid
          and approval_request_id is null
      `.catch(() => undefined);
    }
    if (isUniqueViolation(error)) {
      return stateError("A correction for this attendance date is already pending.");
    }
    const message = error instanceof Error ? error.message : "";
    if (/eligible approver|manager/i.test(message)) {
      return stateError(
        "Assign an active manager with approval access before submitting a correction.",
      );
    }
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "The attendance correction could not be submitted.",
    );
  }
}
