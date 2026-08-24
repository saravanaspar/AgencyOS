"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { TransactionSql } from "postgres";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import {
  formText as text,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { hrOffboardingItemDefinitions } from "@/modules/hr/offboarding";
import {
  createHrOffboardingPlanSchema,
  hrOffboardingPlanIdSchema,
  reassignHrOffboardingWorkSchema,
  submitHrResignationSchema,
  updateHrOffboardingItemSchema,
  updateHrOffboardingPlanSchema,
} from "@/modules/hr/schemas/offboarding";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import { synchronizeHrOffboardingEvidence } from "@/modules/hr/server/offboarding";
import {
  MembershipStatusError,
  updateMembershipStatusInTransaction,
} from "@/modules/identity/server/membership-status";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const derivedItemKeys = new Set<string>();
for (const item of hrOffboardingItemDefinitions) {
  if (item.derived) derivedItemKeys.add(item.key);
}
derivedItemKeys.add("final_clearance");

function normalizeDateTime(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function planInput(formData: FormData) {
  return {
    membershipId: text(formData, "membershipId"),
    separationType: text(formData, "separationType"),
    noticeDate: text(formData, "noticeDate"),
    lastWorkingDate: text(formData, "lastWorkingDate"),
    reason: text(formData, "reason"),
    replacementMembershipId: text(formData, "replacementMembershipId"),
    exitInterviewAt: normalizeDateTime(text(formData, "exitInterviewAt")),
    exitInterviewDetails: text(formData, "exitInterviewDetails"),
    notes: text(formData, "notes"),
  };
}

async function authorizeOffboardingManage(): Promise<CurrentPermissionContext | null> {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.offboardingManage,
  ]);
  return authorization.allowed ? authorization.context : null;
}

async function requireManagedOffboardingEmployee(
  context: CurrentPermissionContext,
  membershipId: string,
): Promise<void> {
  const scope = context.permissionScopes.get(hrPermissionKeys.offboardingManage) ?? "own";
  const rows = await getDatabaseClient()<Array<{ id: string }>>`
    select membership.id
    from public.memberships as membership
    where membership.id = ${membershipId}::uuid
      and membership.organization_id = ${context.membership.organizationId}::uuid
      and private.crm_scope_allows_membership(
        ${context.membership.id}::uuid, ${scope}, membership.id, membership.id
      )
    limit 1
  `;
  if (!rows[0]) throw new HrActionError("Employee is outside your offboarding scope.");
}

async function insertOffboardingPlan(
  sql: TransactionSql,
  input: {
    context: CurrentPermissionContext;
    membershipId: string;
    separationType: string;
    noticeDate: string;
    lastWorkingDate: string;
    reason: string | null;
    replacementMembershipId: string | null;
    exitInterviewAt: string | null;
    exitInterviewDetails: string | null;
    notes: string | null;
  },
): Promise<{ id: string; cycleNumber: number; priorLifecycleStatus: string }> {
  const lockKey = `${input.context.membership.organizationId}:${input.membershipId}:offboarding`;
  await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const employees = await sql<Array<{ lifecycle_status: string }>>`
    select employee.lifecycle_status
    from public.hr_employee_profiles as employee
    where employee.organization_id = ${input.context.membership.organizationId}::uuid
      and employee.membership_id = ${input.membershipId}::uuid
    limit 1 for update
  `;
  const employee = employees[0];
  if (!employee) throw new HrActionError("Create the employee record before starting offboarding.");
  if (employee.lifecycle_status === "archived") {
    throw new HrActionError("Archived employees cannot start another offboarding cycle.");
  }

  const sequences = await sql<Array<{ next_cycle: number }>>`
    select coalesce(max(cycle_number), 0)::integer + 1 as next_cycle
    from public.hr_offboarding_plans
    where organization_id = ${input.context.membership.organizationId}::uuid
      and membership_id = ${input.membershipId}::uuid
  `;
  const cycleNumber = sequences[0]?.next_cycle ?? 1;
  const rows = await sql<Array<{ id: string }>>`
    insert into public.hr_offboarding_plans (
      organization_id, membership_id, cycle_number, separation_type, prior_lifecycle_status,
      notice_date, last_working_date, reason, replacement_membership_id,
      exit_interview_at, exit_interview_details, notes,
      created_by_membership_id, updated_by_membership_id
    ) values (
      ${input.context.membership.organizationId}::uuid, ${input.membershipId}::uuid,
      ${cycleNumber}, ${input.separationType}, ${employee.lifecycle_status},
      ${input.noticeDate}::date, ${input.lastWorkingDate}::date, ${input.reason},
      ${input.replacementMembershipId}::uuid, ${input.exitInterviewAt}::timestamptz,
      ${input.exitInterviewDetails}, ${input.notes},
      ${input.context.membership.id}::uuid, ${input.context.membership.id}::uuid
    ) returning id
  `;
  const planId = rows[0]?.id;
  if (!planId) throw new HrActionError("Offboarding plan creation returned no record.");

  await sql`
    update public.hr_employee_profiles
    set lifecycle_status = 'notice_period',
      updated_by_membership_id = ${input.context.membership.id}::uuid,
      updated_by = ${input.context.user.id}::uuid
    where organization_id = ${input.context.membership.organizationId}::uuid
      and membership_id = ${input.membershipId}::uuid
  `;
  await synchronizeHrOffboardingEvidence(sql, {
    organizationId: input.context.membership.organizationId,
    membershipId: input.membershipId,
    actorMembershipId: input.context.membership.id,
  });
  await writeAuditEvent(sql, input.context, {
    action: "hr.offboarding_plan_created",
    entityType: "hr_offboarding_plan",
    entityId: planId,
    afterState: {
      targetMembershipId: input.membershipId,
      separationType: input.separationType,
      noticeDate: input.noticeDate,
      lastWorkingDate: input.lastWorkingDate,
      cycleNumber,
    },
  });
  return { id: planId, cycleNumber, priorLifecycleStatus: employee.lifecycle_status };
}

function notifyPlanCreated(
  context: CurrentPermissionContext,
  plan: { id: string; membershipId: string },
  lastWorkingDate: string,
): void {
  after(async () => {
    try {
      await enqueueNotification({
        organizationId: context.membership.organizationId,
        recipientMembershipId: plan.membershipId,
        category: "assignment",
        title: "Offboarding plan created",
        message: `Your offboarding checklist is available. Last working date: ${lastWorkingDate}.`,
        deepLink: "/hr",
        sourceModule: "hr",
        sourceEntityType: "hr_offboarding_plan",
        sourceEntityId: plan.id,
        dedupeKey: `hr-offboarding-plan-${plan.id}`,
        createdByMembershipId: context.membership.id,
      });
    } catch {
      // Notification delivery is non-critical after the transaction commits.
    }
  });
}

export async function createHrOffboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = createHrOffboardingPlanSchema.safeParse(planInput(formData));
  if (!parsed.success) {
    return stateError(
      "Check the separation details and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot create offboarding plans.");

  try {
    await requireManagedOffboardingEmployee(context, parsed.data.membershipId);
    const plan = await getDatabaseClient().begin((sql) =>
      insertOffboardingPlan(sql, { context, ...parsed.data }),
    );
    notifyPlanCreated(
      context,
      { id: plan.id, membershipId: parsed.data.membershipId },
      parsed.data.lastWorkingDate,
    );
    revalidatePath("/hr");
    return { status: "success", message: "Offboarding plan created." };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("This employee already has an active offboarding plan.");
    return stateError(
      error instanceof HrActionError ? error.message : "Offboarding plan could not be created.",
    );
  }
}

export async function submitHrResignationAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = submitHrResignationSchema.safeParse({
    noticeDate: text(formData, "noticeDate"),
    lastWorkingDate: text(formData, "lastWorkingDate"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the resignation dates and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.offboardingCreateOwn,
  ]);
  if (!authorization.allowed)
    return stateError("You cannot submit a resignation from this account.");
  const context = authorization.context;

  try {
    const plan = await getDatabaseClient().begin(async (sql) => {
      const dates = await sql<Array<{ local_date: string }>>`
        select timezone(organization.timezone, now())::date::text as local_date
        from public.organizations as organization
        where organization.id = ${context.membership.organizationId}::uuid
      `;
      const localDate = dates[0]?.local_date;
      if (
        !localDate ||
        parsed.data.noticeDate < localDate ||
        parsed.data.lastWorkingDate < localDate
      ) {
        throw new HrActionError("Resignation dates cannot be in the past.");
      }
      return insertOffboardingPlan(sql, {
        context,
        membershipId: context.membership.id,
        separationType: "resignation",
        noticeDate: parsed.data.noticeDate,
        lastWorkingDate: parsed.data.lastWorkingDate,
        reason: parsed.data.reason,
        replacementMembershipId: null,
        exitInterviewAt: null,
        exitInterviewDetails: null,
        notes: null,
      });
    });
    notifyPlanCreated(
      context,
      { id: plan.id, membershipId: context.membership.id },
      parsed.data.lastWorkingDate,
    );
    revalidatePath("/hr");
    return { status: "success", message: "Resignation submitted to HR." };
  } catch (error) {
    if (isUniqueViolation(error)) return stateError("You already have an active offboarding plan.");
    return stateError(
      error instanceof HrActionError ? error.message : "Resignation could not be submitted.",
    );
  }
}

export async function updateHrOffboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = updateHrOffboardingPlanSchema.safeParse({
    ...planInput(formData),
    planId: text(formData, "planId"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the offboarding schedule and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot update offboarding plans.");

  try {
    await getDatabaseClient().begin(async (sql) => {
      const targets = await sql<Array<{ membership_id: string }>>`
        select membership_id from public.hr_offboarding_plans
        where id = ${parsed.data.planId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status not in ('completed', 'cancelled')
        limit 1 for update
      `;
      const target = targets[0];
      if (!target) throw new HrActionError("Active offboarding plan not found.");
      await requireManagedOffboardingEmployee(context, target.membership_id);
      if (parsed.data.membershipId !== target.membership_id) {
        throw new HrActionError("Offboarding plan employee cannot be changed.");
      }
      await sql`
        update public.hr_offboarding_plans
        set separation_type = ${parsed.data.separationType},
          notice_date = ${parsed.data.noticeDate}::date,
          last_working_date = ${parsed.data.lastWorkingDate}::date,
          reason = ${parsed.data.reason},
          replacement_membership_id = ${parsed.data.replacementMembershipId}::uuid,
          exit_interview_at = ${parsed.data.exitInterviewAt}::timestamptz,
          exit_interview_details = ${parsed.data.exitInterviewDetails},
          notes = ${parsed.data.notes},
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: target.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_plan_updated",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
        changedFields: [
          "separation_type",
          "notice_date",
          "last_working_date",
          "reason",
          "replacement_membership_id",
          "exit_interview_at",
          "exit_interview_details",
          "notes",
        ],
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Offboarding plan updated." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Offboarding plan could not be updated.",
    );
  }
}

export async function updateHrOffboardingItemAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = updateHrOffboardingItemSchema.safeParse({
    itemId: text(formData, "itemId"),
    status: text(formData, "status"),
    assignedMembershipId: text(formData, "assignedMembershipId"),
    dueDate: text(formData, "dueDate"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the clearance item and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot update offboarding checklist items.");

  try {
    await getDatabaseClient().begin(async (sql) => {
      const rows = await sql<
        Array<{ offboarding_plan_id: string; membership_id: string; item_key: string }>
      >`
        select item.offboarding_plan_id, plan.membership_id, item.item_key
        from public.hr_offboarding_items as item
        join public.hr_offboarding_plans as plan on plan.id = item.offboarding_plan_id
        where item.id = ${parsed.data.itemId}::uuid
          and item.organization_id = ${context.membership.organizationId}::uuid
          and plan.status not in ('completed', 'cancelled')
        limit 1 for update of item
      `;
      const item = rows[0];
      if (!item) throw new HrActionError("Active offboarding checklist item not found.");
      await requireManagedOffboardingEmployee(context, item.membership_id);
      if (derivedItemKeys.has(item.item_key)) {
        throw new HrActionError(
          "This item is synchronized from its source record and cannot be edited manually.",
        );
      }
      if (parsed.data.assignedMembershipId) {
        const assignees = await sql<Array<{ id: string }>>`
          select id from public.memberships
          where id = ${parsed.data.assignedMembershipId}::uuid
            and organization_id = ${context.membership.organizationId}::uuid
            and status in ('active', 'invited')
          limit 1
        `;
        if (!assignees[0])
          throw new HrActionError("Checklist assignee is not an active organization member.");
      }
      await sql`
        update public.hr_offboarding_items
        set status = ${parsed.data.status},
          assigned_membership_id = ${parsed.data.assignedMembershipId}::uuid,
          due_date = ${parsed.data.dueDate}::date,
          notes = ${parsed.data.notes},
          completion_source = case
            when ${parsed.data.status} in ('complete', 'not_applicable') then 'manual' else null end,
          completed_at = case
            when ${parsed.data.status} in ('complete', 'not_applicable') then now() else null end,
          completed_by_membership_id = case
            when ${parsed.data.status} in ('complete', 'not_applicable')
              then ${context.membership.id}::uuid else null end,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.itemId}::uuid
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_item_updated",
        entityType: "hr_offboarding_item",
        entityId: parsed.data.itemId,
        afterState: { status: parsed.data.status, itemKey: item.item_key },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Clearance item updated." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Clearance item could not be updated.",
    );
  }
}

export async function reassignHrOffboardingWorkAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = reassignHrOffboardingWorkSchema.safeParse({
    planId: text(formData, "planId"),
    replacementMembershipId: text(formData, "replacementMembershipId"),
  });
  if (!parsed.success) return stateError("Choose an active replacement employee.");
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot reassign offboarding work.");

  try {
    const result = await getDatabaseClient().begin(async (sql) => {
      const plans = await sql<Array<{ membership_id: string; status: string }>>`
        select membership_id, status from public.hr_offboarding_plans
        where id = ${parsed.data.planId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        limit 1 for update
      `;
      const plan = plans[0];
      if (!plan || ["completed", "cancelled"].includes(plan.status)) {
        throw new HrActionError("Active offboarding plan not found.");
      }
      await requireManagedOffboardingEmployee(context, plan.membership_id);
      if (plan.membership_id === parsed.data.replacementMembershipId) {
        throw new HrActionError("Choose another employee as the replacement.");
      }
      const replacements = await sql<Array<{ id: string }>>`
        select id from public.memberships
        where id = ${parsed.data.replacementMembershipId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status = 'active'
        limit 1
      `;
      if (!replacements[0]) throw new HrActionError("Replacement employee is not active.");

      const affectedProjects = await sql<Array<{ id: string; role: string }>>`
        select project.id,
          case when project.owner_membership_id = ${plan.membership_id}::uuid then 'owner'
            else coalesce(project_member.role, 'member') end as role
        from public.projects as project
        left join public.project_members as project_member
          on project_member.project_id = project.id
         and project_member.membership_id = ${plan.membership_id}::uuid
        where project.organization_id = ${context.membership.organizationId}::uuid
          and project.status in ('planned', 'active', 'on_hold')
          and (project.owner_membership_id = ${plan.membership_id}::uuid or project_member.membership_id is not null)
        for update of project
      `;
      await sql`
        insert into public.project_members as existing (project_id, membership_id, role, added_by_membership_id)
        select project.id, ${parsed.data.replacementMembershipId}::uuid,
          case when project.owner_membership_id = ${plan.membership_id}::uuid then 'owner'
            else coalesce(project_member.role, 'member') end,
          ${context.membership.id}::uuid
        from public.projects as project
        left join public.project_members as project_member
          on project_member.project_id = project.id
         and project_member.membership_id = ${plan.membership_id}::uuid
        where project.organization_id = ${context.membership.organizationId}::uuid
          and project.status in ('planned', 'active', 'on_hold')
          and (project.owner_membership_id = ${plan.membership_id}::uuid or project_member.membership_id is not null)
        on conflict (project_id, membership_id) do update
        set role = case
          when excluded.role = 'owner' then 'owner'
          when existing.role = 'viewer' then excluded.role
          else existing.role end
      `;
      const workCounts = await sql<Array<{ owned_project_count: number; open_task_count: number }>>`
        with updated_projects as (
          update public.projects
          set owner_membership_id = ${parsed.data.replacementMembershipId}::uuid
          where organization_id = ${context.membership.organizationId}::uuid
            and owner_membership_id = ${plan.membership_id}::uuid
            and status in ('planned', 'active', 'on_hold')
          returning id
        )
        select
          (select count(*)::integer from updated_projects) as owned_project_count,
          (
            select count(*)::integer
            from public.project_task_assignees as assignment
            join public.project_tasks as task on task.id = assignment.task_id
            join public.project_task_statuses as task_status on task_status.id = task.status_id
            where assignment.membership_id = ${plan.membership_id}::uuid
              and task.organization_id = ${context.membership.organizationId}::uuid
              and not task_status.is_terminal
          ) as open_task_count
      `;
      const workCount = workCounts[0] ?? { owned_project_count: 0, open_task_count: 0 };
      await sql`
        insert into public.project_task_assignees (task_id, membership_id, assigned_by_membership_id)
        select assignment.task_id, ${parsed.data.replacementMembershipId}::uuid,
          ${context.membership.id}::uuid
        from public.project_task_assignees as assignment
        join public.project_tasks as task on task.id = assignment.task_id
        join public.project_task_statuses as task_status on task_status.id = task.status_id
        where assignment.membership_id = ${plan.membership_id}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and not task_status.is_terminal
        on conflict (task_id, membership_id) do nothing
      `;
      await sql`
        delete from public.project_task_assignees as assignment
        using public.project_tasks as task, public.project_task_statuses as task_status
        where assignment.task_id = task.id
          and task.status_id = task_status.id
          and assignment.membership_id = ${plan.membership_id}::uuid
          and task.organization_id = ${context.membership.organizationId}::uuid
          and not task_status.is_terminal
      `;
      await sql`
        delete from public.project_members as member
        using public.projects as project
        where member.project_id = project.id
          and member.membership_id = ${plan.membership_id}::uuid
          and project.organization_id = ${context.membership.organizationId}::uuid
          and project.status in ('planned', 'active', 'on_hold')
      `;
      await sql`
        update public.hr_offboarding_plans
        set replacement_membership_id = ${parsed.data.replacementMembershipId}::uuid,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: plan.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_work_reassigned",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
        afterState: {
          replacementMembershipId: parsed.data.replacementMembershipId,
          projectCount: affectedProjects.length,
          ownedProjectCount: workCount.owned_project_count,
          openTaskCount: workCount.open_task_count,
        },
      });
      return { projects: affectedProjects.length, tasks: workCount.open_task_count };
    });
    revalidatePath("/hr");
    revalidatePath("/projects");
    return {
      status: "success",
      message: `Reassigned ${result.projects} project(s) and ${result.tasks} open task(s).`,
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "Project and task work could not be reassigned.",
    );
  }
}

export async function suspendHrOffboardingAccountAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrOffboardingPlanIdSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Invalid offboarding plan.");
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot suspend employee access.");

  try {
    await getDatabaseClient().begin(async (sql) => {
      const plans = await sql<
        Array<{
          membership_id: string;
          status: string;
          local_date: string;
          last_working_date: string;
        }>
      >`
        select plan.membership_id, plan.status,
          timezone(organization.timezone, now())::date::text as local_date,
          plan.last_working_date::text
        from public.hr_offboarding_plans as plan
        join public.organizations as organization on organization.id = plan.organization_id
        where plan.id = ${parsed.data.planId}::uuid
          and plan.organization_id = ${context.membership.organizationId}::uuid
        limit 1 for update of plan
      `;
      const plan = plans[0];
      if (!plan || ["completed", "cancelled"].includes(plan.status)) {
        throw new HrActionError("Active offboarding plan not found.");
      }
      await requireManagedOffboardingEmployee(context, plan.membership_id);
      if (plan.local_date < plan.last_working_date) {
        throw new HrActionError("Account access cannot be suspended before the last working date.");
      }
      await updateMembershipStatusInTransaction(sql, {
        organizationId: context.membership.organizationId,
        actorUserId: context.user.id,
        actorMembershipId: context.membership.id,
        targetMembershipId: plan.membership_id,
        status: "suspended",
        auditMetadata: { offboardingPlanId: parsed.data.planId },
      });
      await sql`
        update public.hr_offboarding_plans
        set account_suspended_at = now(), updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: plan.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_account_suspended",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
      });
    });
    revalidatePath("/hr");
    revalidatePath("/settings/users");
    return { status: "success", message: "Employee account suspended." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError || error instanceof MembershipStatusError
        ? error.message
        : "Employee account could not be suspended.",
    );
  }
}

export async function refreshHrOffboardingEvidenceAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrOffboardingPlanIdSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Invalid offboarding plan.");
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot refresh offboarding evidence.");

  try {
    const count = await getDatabaseClient().begin(async (sql) => {
      const plans = await sql<Array<{ membership_id: string }>>`
        select membership_id from public.hr_offboarding_plans
        where id = ${parsed.data.planId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status not in ('completed', 'cancelled')
        limit 1
      `;
      const plan = plans[0];
      if (!plan) throw new HrActionError("Active offboarding plan not found.");
      await requireManagedOffboardingEmployee(context, plan.membership_id);
      const changed = await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: plan.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_evidence_refreshed",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
        metadata: { changedItems: changed },
      });
      return changed;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: `Offboarding evidence refreshed (${count} item(s) changed).`,
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "Offboarding evidence could not be refreshed.",
    );
  }
}

export async function completeHrOffboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrOffboardingPlanIdSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Invalid offboarding plan.");
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot complete offboarding plans.");

  try {
    await getDatabaseClient().begin(async (sql) => {
      const plans = await sql<
        Array<{
          membership_id: string;
          status: string;
          local_date: string;
          last_working_date: string;
        }>
      >`
        select plan.membership_id, plan.status,
          timezone(organization.timezone, now())::date::text as local_date,
          plan.last_working_date::text
        from public.hr_offboarding_plans as plan
        join public.organizations as organization on organization.id = plan.organization_id
        where plan.id = ${parsed.data.planId}::uuid
          and plan.organization_id = ${context.membership.organizationId}::uuid
        limit 1 for update of plan
      `;
      const plan = plans[0];
      if (!plan || ["completed", "cancelled"].includes(plan.status)) {
        throw new HrActionError("Active offboarding plan not found.");
      }
      await requireManagedOffboardingEmployee(context, plan.membership_id);
      if (plan.local_date < plan.last_working_date) {
        throw new HrActionError("Final clearance cannot complete before the last working date.");
      }
      await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: plan.membership_id,
        actorMembershipId: context.membership.id,
      });
      const blockers = await sql<Array<{ label: string }>>`
        select label from public.hr_offboarding_items
        where offboarding_plan_id = ${parsed.data.planId}::uuid
          and item_key not in ('final_clearance', 'employee_archive')
          and status not in ('complete', 'not_applicable')
        order by position
      `;
      if (blockers.length > 0) {
        throw new HrActionError(
          `Complete or exempt: ${blockers.map((item) => item.label).join(", ")}.`,
        );
      }

      await sql`
        update public.hr_offboarding_items
        set status = 'complete', completion_source = 'system', completed_at = now(),
          completed_by_membership_id = ${context.membership.id}::uuid,
          updated_by_membership_id = ${context.membership.id}::uuid,
          notes = 'Final clearance approved by HR.'
        where offboarding_plan_id = ${parsed.data.planId}::uuid
          and item_key = 'final_clearance'
      `;
      await updateMembershipStatusInTransaction(sql, {
        organizationId: context.membership.organizationId,
        actorUserId: context.user.id,
        actorMembershipId: context.membership.id,
        targetMembershipId: plan.membership_id,
        status: "deactivated",
        auditMetadata: { offboardingPlanId: parsed.data.planId, finalClearance: true },
      });
      await sql`
        update public.hr_employee_profiles
        set lifecycle_status = 'archived',
          updated_by_membership_id = ${context.membership.id}::uuid,
          updated_by = ${context.user.id}::uuid
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${plan.membership_id}::uuid
      `;
      await sql`
        update public.hr_offboarding_plans
        set final_clearance_at = now(), archived_at = now(),
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await synchronizeHrOffboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: plan.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_completed",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
        afterState: { membershipId: plan.membership_id, lifecycleStatus: "archived" },
      });
    });
    revalidatePath("/hr");
    revalidatePath("/settings/users");
    return { status: "success", message: "Final clearance completed and employee archived." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError || error instanceof MembershipStatusError
        ? error.message
        : "Offboarding plan could not be completed.",
    );
  }
}

export async function cancelHrOffboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrOffboardingPlanIdSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Invalid offboarding plan.");
  const context = await authorizeOffboardingManage();
  if (!context) return stateError("You cannot cancel offboarding plans.");

  try {
    await getDatabaseClient().begin(async (sql) => {
      const plans = await sql<
        Array<{
          membership_id: string;
          prior_lifecycle_status: string;
          status: string;
          account_suspended_at: string | null;
          membership_status: "active" | "deactivated" | "invited" | "suspended";
        }>
      >`
        select plan.membership_id, plan.prior_lifecycle_status, plan.status,
          plan.account_suspended_at::text, membership.status as membership_status
        from public.hr_offboarding_plans as plan
        join public.memberships as membership on membership.id = plan.membership_id
        where plan.id = ${parsed.data.planId}::uuid
          and plan.organization_id = ${context.membership.organizationId}::uuid
        limit 1 for update of plan, membership
      `;
      const plan = plans[0];
      if (!plan || ["completed", "cancelled"].includes(plan.status)) {
        throw new HrActionError("Active offboarding plan not found.");
      }
      await requireManagedOffboardingEmployee(context, plan.membership_id);
      await sql`
        update public.hr_offboarding_plans
        set status = 'cancelled', cancelled_at = now(),
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await sql`
        update public.hr_employee_profiles
        set lifecycle_status = ${plan.prior_lifecycle_status},
          updated_by_membership_id = ${context.membership.id}::uuid,
          updated_by = ${context.user.id}::uuid
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${plan.membership_id}::uuid
          and lifecycle_status = 'notice_period'
      `;
      if (plan.account_suspended_at && plan.membership_status === "suspended") {
        await updateMembershipStatusInTransaction(sql, {
          organizationId: context.membership.organizationId,
          actorUserId: context.user.id,
          actorMembershipId: context.membership.id,
          targetMembershipId: plan.membership_id,
          status: "active",
          auditMetadata: { offboardingPlanId: parsed.data.planId, cancellation: true },
        });
      }
      await writeAuditEvent(sql, context, {
        action: "hr.offboarding_cancelled",
        entityType: "hr_offboarding_plan",
        entityId: parsed.data.planId,
        afterState: { restoredLifecycleStatus: plan.prior_lifecycle_status },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Offboarding plan cancelled." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError || error instanceof MembershipStatusError
        ? error.message
        : "Offboarding plan could not be cancelled.",
    );
  }
}
