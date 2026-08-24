"use server";

import { revalidatePath } from "next/cache";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import {
  cancelApprovalRequest,
  submitApprovalForRecordAtomically,
} from "@/modules/approvals/server/approvals";
import { ensureHrApprovalPolicy } from "@/modules/hr/actions/approval-policies";
import {
  formText,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import {
  leaveBalanceAdjustmentSchema,
  leaveCancellationSchema,
  leaveDraftSchema,
  leaveRequestIdSchema,
  leaveTypeSchema,
  leaveTypeStatusSchema,
} from "@/modules/hr/schemas/leave";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import {
  purgePrivateFileObjects,
  softDeletePrivateFile,
} from "@/modules/private-files/server/private-files";

const LEAVE_MANAGER_POLICY_KEY = "hr_leave_manager";
const LEAVE_MANAGER_HR_POLICY_KEY = "hr_leave_manager_hr";

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function leaveTypeInput(formData: FormData) {
  return {
    leaveTypeId: formText(formData, "leaveTypeId"),
    name: formText(formData, "name"),
    code: formText(formData, "code"),
    description: formText(formData, "description"),
    isPaid: checked(formData, "isPaid"),
    balanceRequired: checked(formData, "balanceRequired"),
    accrualFrequency: formText(formData, "accrualFrequency"),
    annualAllowanceDays: formText(formData, "annualAllowanceDays"),
    accrualRateDays: formText(formData, "accrualRateDays"),
    carryForwardLimitDays: formText(formData, "carryForwardLimitDays"),
    attachmentRequiredAfterDays: formText(formData, "attachmentRequiredAfterDays"),
    requiresHrApproval: checked(formData, "requiresHrApproval"),
  };
}

async function ensureLeaveApprovalPolicies(
  context: Parameters<typeof ensureHrApprovalPolicy>[0],
): Promise<void> {
  const managerStep = {
    name: "Manager review",
    stageOrder: 1,
    sortOrder: 1,
    selectorType: "manager" as const,
    selectorRoleKey: null,
    selectorMembershipId: null,
    decisionMode: "any" as const,
    conditions: {},
    commentRequired: false,
    reminderAfterHours: 24,
    escalationAfterHours: 72,
    expiresAfterHours: 168,
  };
  await ensureHrApprovalPolicy(context, {
    key: LEAVE_MANAGER_POLICY_KEY,
    name: "Employee leave",
    description: "Routes employee leave to the assigned manager.",
    sourceModule: "hr",
    entityType: "leave_request",
    allowSelfApproval: false,
    allowReassignment: true,
    steps: [managerStep],
  });
  await ensureHrApprovalPolicy(context, {
    key: LEAVE_MANAGER_HR_POLICY_KEY,
    name: "Employee leave with HR review",
    description: "Routes employee leave to the assigned manager and then HR.",
    sourceModule: "hr",
    entityType: "leave_request",
    allowSelfApproval: false,
    allowReassignment: true,
    steps: [
      managerStep,
      {
        name: "HR review",
        stageOrder: 2,
        sortOrder: 1,
        selectorType: "role",
        selectorRoleKey: "hr_manager",
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

export async function saveLeaveTypeAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveTypeSchema.safeParse(leaveTypeInput(formData));
  if (!parsed.success) {
    return stateError("Check the leave policy fields.", parsed.error.flatten().fieldErrors);
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveTypeManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot manage leave policies.");

  const { context } = authorization;
  const database = getDatabaseClient();
  try {
    const leaveTypeId = await database.begin(async (sql) => {
      const values = parsed.data;
      if (values.leaveTypeId) {
        const rows = await sql<Array<{ id: string }>>`
          update public.hr_leave_types
          set name = ${values.name}, code = ${values.code}, description = ${values.description},
            is_paid = ${values.isPaid}, balance_required = ${values.balanceRequired},
            accrual_frequency = ${values.accrualFrequency},
            annual_allowance_days = ${values.annualAllowanceDays},
            accrual_rate_days = ${values.accrualRateDays},
            carry_forward_limit_days = ${values.carryForwardLimitDays},
            attachment_required_after_days = ${values.attachmentRequiredAfterDays},
            requires_hr_approval = ${values.requiresHrApproval},
            updated_by_membership_id = ${context.membership.id}::uuid
          where id = ${values.leaveTypeId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
          returning id
        `;
        if (!rows[0]) throw new HrActionError("Leave policy was not found.");
        await writeAuditEvent(sql, context, {
          action: "hr.leave_type_updated",
          entityType: "hr_leave_type",
          entityId: rows[0].id,
          afterState: values,
        });
        return rows[0].id;
      }
      const rows = await sql<Array<{ id: string }>>`
        insert into public.hr_leave_types (
          organization_id, name, code, description, is_paid, balance_required,
          accrual_frequency, annual_allowance_days, accrual_rate_days,
          carry_forward_limit_days, attachment_required_after_days, requires_hr_approval,
          created_by_membership_id, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${values.name}, ${values.code},
          ${values.description}, ${values.isPaid}, ${values.balanceRequired},
          ${values.accrualFrequency}, ${values.annualAllowanceDays}, ${values.accrualRateDays},
          ${values.carryForwardLimitDays}, ${values.attachmentRequiredAfterDays},
          ${values.requiresHrApproval}, ${context.membership.id}::uuid,
          ${context.membership.id}::uuid
        ) returning id
      `;
      if (!rows[0]) throw new Error("leave-type-create-failed");
      await writeAuditEvent(sql, context, {
        action: "hr.leave_type_created",
        entityType: "hr_leave_type",
        entityId: rows[0].id,
        afterState: values,
      });
      return rows[0].id;
    });

    await database`
      select private.refresh_hr_leave_balance(
        employee.organization_id, employee.membership_id, ${leaveTypeId}::uuid,
        extract(year from timezone(organization.timezone, now()))::integer,
        ${context.membership.id}::uuid
      )
      from public.hr_employee_profiles as employee
      join public.memberships as membership on membership.id = employee.membership_id
      join public.organizations as organization on organization.id = employee.organization_id
      where employee.organization_id = ${context.membership.organizationId}::uuid
        and membership.status = 'active'
    `;
    revalidatePath("/hr");
    return {
      status: "success",
      message: parsed.data.leaveTypeId ? "Leave policy updated." : "Leave policy created.",
    };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("A leave policy already uses that name or code.");
    return stateError(
      error instanceof HrActionError ? error.message : "Leave policy could not be saved.",
    );
  }
}

export async function changeLeaveTypeStatusAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveTypeStatusSchema.safeParse({
    leaveTypeId: formText(formData, "leaveTypeId"),
    status: formText(formData, "status"),
  });
  if (!parsed.success) return stateError("Choose a valid leave policy status.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveTypeManage,
  ]);
  if (!authorization.allowed) return stateError("You cannot manage leave policies.");
  const { context } = authorization;
  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
        update public.hr_leave_types
        set status = ${parsed.data.status},
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.leaveTypeId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        returning id
      `;
      if (!rows[0]) throw new HrActionError("Leave policy was not found.");
      await writeAuditEvent(sql, context, {
        action: "hr.leave_type_status_changed",
        entityType: "hr_leave_type",
        entityId: rows[0].id,
        afterState: { status: parsed.data.status },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: `Leave policy ${parsed.data.status}.` };
  } catch (error) {
    if (error instanceof HrActionError) return stateError(error.message);
    return stateError("Leave policy status could not be changed.");
  }
}

export async function refreshLeaveBalancesAction(_previous: HrActionState): Promise<HrActionState> {
  void _previous;
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveBalanceAdjust,
  ]);
  if (!authorization.allowed) return stateError("You cannot refresh leave balances.");
  const { context } = authorization;
  try {
    const refreshed = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<Array<{ id: string }>>`
      select private.refresh_hr_leave_balance(
        employee.organization_id, employee.membership_id, leave_type.id,
        extract(year from timezone(organization.timezone, now()))::integer,
        ${context.membership.id}::uuid
      )
      from public.hr_employee_profiles as employee
      join public.memberships as membership on membership.id = employee.membership_id
      join public.organizations as organization on organization.id = employee.organization_id
      cross join public.hr_leave_types as leave_type
      where employee.organization_id = ${context.membership.organizationId}::uuid
        and leave_type.organization_id = employee.organization_id
        and leave_type.status = 'active'
        and membership.status = 'active'
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.leave_balances_refreshed",
        entityType: "organization",
        entityId: context.membership.organizationId,
        afterState: { refreshedBalanceCount: rows.length },
      });
      return rows.length;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: `Leave accruals and carry-forward refreshed for ${refreshed} balance(s).`,
    };
  } catch {
    return stateError("Leave balances could not be refreshed.");
  }
}

export async function adjustLeaveBalanceAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveBalanceAdjustmentSchema.safeParse({
    membershipId: formText(formData, "membershipId"),
    leaveTypeId: formText(formData, "leaveTypeId"),
    balanceYear: formText(formData, "balanceYear"),
    adjustmentDays: formText(formData, "adjustmentDays"),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success)
    return stateError("Check the balance adjustment fields.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveBalanceAdjust,
  ]);
  if (!authorization.allowed) return stateError("You cannot adjust leave balances.");
  const { context } = authorization;
  const scope = context.permissionScopes.get(hrPermissionKeys.leaveBalanceAdjust) ?? "own";
  try {
    await getDatabaseClient().begin(async (sql) => {
      const allowed = await sql<Array<{ id: string }>>`
        select membership.id from public.memberships as membership
        where membership.id = ${parsed.data.membershipId}::uuid
          and membership.organization_id = ${context.membership.organizationId}::uuid
          and private.crm_scope_allows_membership(
            ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
          )
        limit 1
      `;
      if (!allowed[0]) throw new HrActionError("Employee is outside your leave scope.");
      const balanceRows = await sql<Array<{ id: string }>>`
        select private.refresh_hr_leave_balance(
          ${context.membership.organizationId}::uuid, ${parsed.data.membershipId}::uuid,
          ${parsed.data.leaveTypeId}::uuid, ${parsed.data.balanceYear},
          ${context.membership.id}::uuid
        ) as id
      `;
      const balanceId = balanceRows[0]?.id;
      if (!balanceId) throw new Error("leave-balance-not-found");
      await sql`
        update public.hr_leave_balances
        set adjustment_days = adjustment_days + ${parsed.data.adjustmentDays}, updated_at = now()
        where id = ${balanceId}::uuid
      `;
      await sql`
        insert into public.hr_leave_balance_events (
          organization_id, balance_id, membership_id, leave_type_id, balance_year,
          event_type, adjustment_delta, reason, actor_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${balanceId}::uuid,
          ${parsed.data.membershipId}::uuid, ${parsed.data.leaveTypeId}::uuid,
          ${parsed.data.balanceYear}, 'adjustment', ${parsed.data.adjustmentDays},
          ${parsed.data.reason}, ${context.membership.id}::uuid
        )
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.leave_balance_adjusted",
        entityType: "hr_leave_balance",
        entityId: balanceId,
        afterState: parsed.data,
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Leave balance adjusted." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Leave balance could not be adjusted.",
    );
  }
}

export async function saveLeaveDraftAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveDraftSchema.safeParse({
    leaveTypeId: formText(formData, "leaveTypeId"),
    startDate: formText(formData, "startDate"),
    endDate: formText(formData, "endDate"),
    dayPart: formText(formData, "dayPart"),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success)
    return stateError("Check the leave dates and reason.", parsed.error.flatten().fieldErrors);
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
    hrPermissionKeys.leaveRequestCreate,
  ]);
  if (!authorization.allowed) return stateError("You cannot create a leave request.");
  const { context } = authorization;
  try {
    const draft = await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{ id: string; requested_days: string | number; team_conflict_count: number }>
      >`
        insert into public.hr_leave_requests (
          organization_id, membership_id, leave_type_id, start_date, end_date,
          day_part, reason, requested_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
          ${parsed.data.leaveTypeId}::uuid, ${parsed.data.startDate}::date,
          ${parsed.data.endDate}::date, ${parsed.data.dayPart}, ${parsed.data.reason},
          ${context.membership.id}::uuid
        ) returning id, requested_days, team_conflict_count
      `;
      const created = rows[0];
      if (!created) throw new Error("leave-draft-create-failed");
      await writeAuditEvent(sql, context, {
        action: "hr.leave_request_draft_created",
        entityType: "hr_leave_request",
        entityId: created.id,
        afterState: { ...parsed.data, requestedDays: Number(created.requested_days) },
      });
      return created;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: `Draft saved for ${Number(draft.requested_days)} day(s)${draft.team_conflict_count > 0 ? ` with ${draft.team_conflict_count} team conflict warning(s)` : ""}. Add evidence if required, then submit.`,
    };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("An identical leave draft or overlapping request already exists.");
    const message = error instanceof Error ? error.message : "";
    if (/past/i.test(message)) return stateError("Leave requests cannot start in the past.");
    return stateError("Leave draft could not be saved.");
  }
}

export async function submitLeaveRequestAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveRequestIdSchema.safeParse({
    leaveRequestId: formText(formData, "leaveRequestId"),
  });
  if (!parsed.success) return stateError("Leave draft was not found.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
    hrPermissionKeys.leaveRequestCreate,
    "approvals.request.create",
  ]);
  if (!authorization.allowed) return stateError("You cannot submit a leave request.");
  const { context } = authorization;
  const database = getDatabaseClient();
  try {
    await ensureLeaveApprovalPolicies(context);
    const rows = await database<
      Array<{
        id: string;
        membership_id: string;
        display_name: string;
        department_id: string | null;
        leave_type_id: string;
        leave_type_name: string;
        balance_required: boolean;
        attachment_required_after_days: string | number | null;
        requires_hr_approval: boolean;
        start_date: string;
        end_date: string;
        day_part: string;
        requested_days: string | number;
        reason: string;
        team_conflict_count: number;
        attachment_id: string | null;
      }>
    >`
      select request.id, request.membership_id,
        coalesce(employee.preferred_name, employee.legal_name, profile.display_name,
          nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
          split_part(coalesce(auth_user.email, ''), '@', 1), 'AgencyOS user') as display_name,
        membership.department_id, request.leave_type_id, leave_type.name as leave_type_name,
        leave_type.balance_required, leave_type.attachment_required_after_days,
        leave_type.requires_hr_approval, request.start_date::text, request.end_date::text,
        request.day_part, request.requested_days, request.reason, request.team_conflict_count,
        attachment.id as attachment_id
      from public.hr_leave_requests as request
      join public.hr_leave_types as leave_type on leave_type.id = request.leave_type_id
      join public.memberships as membership on membership.id = request.membership_id
      join public.identity_accounts as auth_user on auth_user.id = membership.user_id
      left join public.profiles as profile on profile.id = membership.user_id
      left join public.hr_employee_profiles as employee on employee.membership_id = membership.id
      left join public.hr_leave_request_attachments as attachment on attachment.leave_request_id = request.id
      where request.id = ${parsed.data.leaveRequestId}::uuid
        and request.organization_id = ${context.membership.organizationId}::uuid
        and request.membership_id = ${context.membership.id}::uuid
        and request.status = 'draft'
      limit 1
    `;
    const draft = rows[0];
    if (!draft) return stateError("Only your draft leave request can be submitted.");
    const requestedDays = Number(draft.requested_days);
    const attachmentThreshold =
      draft.attachment_required_after_days === null
        ? null
        : Number(draft.attachment_required_after_days);
    if (
      attachmentThreshold !== null &&
      requestedDays >= attachmentThreshold &&
      !draft.attachment_id
    ) {
      return stateError("This leave policy requires evidence before submission.");
    }

    const policyKey = draft.requires_hr_approval
      ? LEAVE_MANAGER_HR_POLICY_KEY
      : LEAVE_MANAGER_POLICY_KEY;
    await submitApprovalForRecordAtomically(
      context,
      {
        definitionKey: policyKey,
        title: `${draft.leave_type_name} · ${draft.display_name} · ${draft.start_date} to ${draft.end_date}`,
        sourceModule: "hr",
        entityType: "leave_request",
        entityId: draft.id,
        deepLink: "/hr#leave-requests",
        departmentId: draft.department_id,
        amount: null,
        currency: null,
        snapshot: {
          membershipId: draft.membership_id,
          leaveTypeId: draft.leave_type_id,
          leaveTypeName: draft.leave_type_name,
          startDate: draft.start_date,
          endDate: draft.end_date,
          dayPart: draft.day_part,
          requestedDays,
          reason: draft.reason,
          teamConflictCount: draft.team_conflict_count,
          hasAttachment: Boolean(draft.attachment_id),
        },
        dueAt: null,
      },
      async (sql, approvalRequestId) => {
        const lockedRows = await sql<
          Array<{
            id: string;
            requested_days: string | number;
            leave_type_id: string;
            start_date: string;
            balance_required: boolean;
          }>
        >`
          select request.id, request.requested_days, request.leave_type_id,
            request.start_date::text, leave_type.balance_required
          from public.hr_leave_requests as request
          join public.hr_leave_types as leave_type on leave_type.id = request.leave_type_id
          where request.id = ${draft.id}::uuid
            and request.organization_id = ${context.membership.organizationId}::uuid
            and request.membership_id = ${context.membership.id}::uuid
            and request.status = 'draft'
          for update of request
        `;
        const locked = lockedRows[0];
        if (!locked) throw new HrActionError("Leave draft changed before submission.");
        let balanceId: string | null = null;
        if (locked.balance_required) {
          const year = Number(locked.start_date.slice(0, 4));
          const balanceRows = await sql<Array<{ id: string }>>`
            select private.refresh_hr_leave_balance(
              ${context.membership.organizationId}::uuid, ${context.membership.id}::uuid,
              ${locked.leave_type_id}::uuid, ${year}, ${context.membership.id}::uuid
            ) as id
          `;
          balanceId = balanceRows[0]?.id ?? null;
          if (!balanceId) throw new Error("leave-balance-not-found");
          const availableRows = await sql<Array<{ available_days: string | number }>>`
            select opening_days + accrued_days + carried_forward_days + adjustment_days
              - reserved_days - used_days as available_days
            from public.hr_leave_balances where id = ${balanceId}::uuid for update
          `;
          const available = Number(availableRows[0]?.available_days ?? 0);
          if (available < Number(locked.requested_days)) {
            throw new HrActionError(`Only ${available} leave day(s) are available.`);
          }
          await sql`
            update public.hr_leave_balances
            set reserved_days = reserved_days + ${locked.requested_days}, updated_at = now()
            where id = ${balanceId}::uuid
          `;
          await sql`
            insert into public.hr_leave_balance_events (
              organization_id, balance_id, membership_id, leave_type_id, balance_year,
              leave_request_id, event_type, reserved_delta, reason, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${balanceId}::uuid,
              ${context.membership.id}::uuid, ${locked.leave_type_id}::uuid, ${year},
              ${draft.id}::uuid, 'reserved', ${locked.requested_days},
              'Leave request submitted', ${context.membership.id}::uuid
            )
          `;
        }
        await sql`
          update public.hr_leave_requests
          set status = 'pending', approval_request_id = ${approvalRequestId}::uuid,
            balance_id = ${balanceId}::uuid
          where id = ${draft.id}::uuid
        `;
        await writeAuditEvent(sql, context, {
          action: "hr.leave_request_submitted",
          entityType: "hr_leave_request",
          entityId: draft.id,
          afterState: { status: "pending", approvalRequestId, requestedDays, balanceId },
        });
      },
    );

    revalidatePath("/hr");
    revalidatePath("/approvals");
    return {
      status: "success",
      message: `Leave sent for approval${draft.team_conflict_count > 0 ? ` with ${draft.team_conflict_count} team conflict warning(s)` : ""}.`,
    };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("This leave overlaps an existing pending or approved request.");
    const message = error instanceof Error ? error.message : "";
    if (/eligible approver|manager/i.test(message)) {
      return stateError(
        "Assign an active manager and required HR approver before submitting leave.",
      );
    }
    return stateError(
      error instanceof HrActionError ? error.message : "Leave request could not be submitted.",
    );
  }
}

export async function cancelLeaveRequestAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = leaveCancellationSchema.safeParse({
    leaveRequestId: formText(formData, "leaveRequestId"),
    reason: formText(formData, "reason"),
  });
  if (!parsed.success) return stateError("Add a cancellation reason.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.leaveRequestView,
    hrPermissionKeys.leaveRequestCancel,
  ]);
  if (!authorization.allowed) return stateError("You cannot cancel this leave request.");
  const { context } = authorization;
  const database = getDatabaseClient();
  try {
    const rows = await database<
      Array<{
        id: string;
        status: string;
        start_date: string;
        requested_days: string | number;
        balance_id: string | null;
        leave_type_id: string;
        approval_request_id: string | null;
        attachment_id: string | null;
        private_file_id: string | null;
      }>
    >`
      select request.id, request.status, request.start_date::text, request.requested_days,
        request.balance_id, request.leave_type_id, request.approval_request_id,
        attachment.id as attachment_id, attachment.private_file_id
      from public.hr_leave_requests as request
      left join public.hr_leave_request_attachments as attachment on attachment.leave_request_id = request.id
      where request.id = ${parsed.data.leaveRequestId}::uuid
        and request.organization_id = ${context.membership.organizationId}::uuid
        and request.membership_id = ${context.membership.id}::uuid
      limit 1
    `;
    const request = rows[0];
    if (!request) return stateError("Leave request was not found.");

    if (request.status === "pending" && request.approval_request_id) {
      await cancelApprovalRequest(context, request.approval_request_id, parsed.data.reason);
    } else if (request.status === "draft") {
      const purge = await database.begin(async (sql) => {
        let fileToPurge: {
          privateFileId: string;
          locations: Awaited<ReturnType<typeof softDeletePrivateFile>>;
        } | null = null;
        if (request.attachment_id && request.private_file_id) {
          await sql`delete from public.hr_leave_request_attachments where id = ${request.attachment_id}::uuid`;
          const locations = await softDeletePrivateFile(sql, {
            fileId: request.private_file_id,
            organizationId: context.membership.organizationId,
            actorMembershipId: context.membership.id,
          });
          fileToPurge = { privateFileId: request.private_file_id, locations };
        }
        await sql`
          delete from public.hr_leave_requests
          where id = ${request.id}::uuid and status = 'draft'
        `;
        await writeAuditEvent(sql, context, {
          action: "hr.leave_draft_cancelled",
          entityType: "hr_leave_request",
          entityId: request.id,
          beforeState: { status: "draft" },
          afterState: { reason: parsed.data.reason },
        });
        return fileToPurge;
      });
      if (purge) {
        await purgePrivateFileObjects({
          fileId: purge.privateFileId,
          organizationId: context.membership.organizationId,
          ...purge.locations,
        }).catch(() => false);
      }
    } else if (request.status === "approved") {
      await database.begin(async (sql) => {
        const currentRows = await sql<Array<{ current_date: string }>>`
          select timezone(timezone, now())::date::text as current_date
          from public.organizations where id = ${context.membership.organizationId}::uuid
        `;
        if (request.start_date <= (currentRows[0]?.current_date ?? request.start_date)) {
          throw new HrActionError("Approved leave can be cancelled only before it starts.");
        }
        if (request.balance_id) {
          await sql`
            update public.hr_leave_balances
            set used_days = greatest(used_days - ${request.requested_days}, 0), updated_at = now()
            where id = ${request.balance_id}::uuid
          `;
          await sql`
            insert into public.hr_leave_balance_events (
              organization_id, balance_id, membership_id, leave_type_id, balance_year,
              leave_request_id, event_type, used_delta, reason, actor_membership_id
            ) values (
              ${context.membership.organizationId}::uuid, ${request.balance_id}::uuid,
              ${context.membership.id}::uuid, ${request.leave_type_id}::uuid,
              ${Number(request.start_date.slice(0, 4))}, ${request.id}::uuid,
              'approved_cancelled', ${-Number(request.requested_days)}, ${parsed.data.reason},
              ${context.membership.id}::uuid
            )
          `;
        }
        await sql`
          update public.hr_leave_requests
          set status = 'cancelled', cancelled_by_membership_id = ${context.membership.id}::uuid,
            cancelled_at = now()
          where id = ${request.id}::uuid and status = 'approved'
        `;
        await writeAuditEvent(sql, context, {
          action: "hr.leave_request_cancelled",
          entityType: "hr_leave_request",
          entityId: request.id,
          beforeState: { status: "approved" },
          afterState: { status: "cancelled", reason: parsed.data.reason },
          changedFields: ["status"],
        });
      });
    } else {
      return stateError("This leave request can no longer be cancelled.");
    }
    revalidatePath("/hr");
    revalidatePath("/approvals");
    return { status: "success", message: "Leave request cancelled." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Leave request could not be cancelled.",
    );
  }
}
