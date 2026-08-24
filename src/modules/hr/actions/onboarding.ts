"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getDatabaseClient } from "@/integrations/postgres/database";
import { writeAuditEvent } from "@/modules/audit/server/write-audit-event";
import {
  formText as text,
  HrActionError,
  isUniqueViolation,
  stateError,
} from "@/modules/hr/actions/action-utils";
import { hrPermissionKeys } from "@/modules/hr/hr";
import { hrOnboardingItemDefinitions } from "@/modules/hr/onboarding";
import {
  completeHrOnboardingOwnItemSchema,
  cancelHrOnboardingPlanSchema,
  createHrOnboardingPlanSchema,
  hrOnboardingPlanIdSchema,
  updateHrOnboardingItemSchema,
  updateHrOnboardingScheduleSchema,
} from "@/modules/hr/schemas/onboarding";
import type { HrActionState } from "@/modules/hr/schemas/hr";
import { synchronizeHrOnboardingEvidence } from "@/modules/hr/server/onboarding";
import { enqueueNotification } from "@/modules/notifications/server/notifications";
import { authorizeCurrentUser } from "@/modules/permissions/server/authorization";
import type { CurrentPermissionContext } from "@/modules/permissions/server/effective-permissions";

const derivedItemKeys = new Set<string>();
for (const item of hrOnboardingItemDefinitions) {
  if (item.derived) derivedItemKeys.add(item.key);
}

function normalizeDateTime(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function planInput(formData: FormData) {
  return {
    membershipId: text(formData, "membershipId"),
    targetStartDate: text(formData, "targetStartDate"),
    firstDayMeetingAt: normalizeDateTime(text(formData, "firstDayMeetingAt")),
    firstDayMeetingDetails: text(formData, "firstDayMeetingDetails"),
    probationReviewDate: text(formData, "probationReviewDate"),
    notes: text(formData, "notes"),
  };
}

async function authorizeOnboardingManage(): Promise<CurrentPermissionContext | null> {
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.onboardingManage,
  ]);
  return authorization.allowed ? authorization.context : null;
}

async function requireManagedOnboardingEmployee(
  context: CurrentPermissionContext,
  membershipId: string,
): Promise<void> {
  const scope = context.permissionScopes.get(hrPermissionKeys.onboardingManage) ?? "own";
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
  if (!rows[0]) throw new HrActionError("Employee is outside your onboarding scope.");
}

export async function createHrOnboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = createHrOnboardingPlanSchema.safeParse(planInput(formData));
  if (!parsed.success) {
    return stateError(
      "Check the onboarding dates and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOnboardingManage();
  if (!context) return stateError("You cannot create onboarding plans.");

  try {
    await requireManagedOnboardingEmployee(context, parsed.data.membershipId);
    const database = getDatabaseClient();
    const plan = await database.begin(async (sql) => {
      const lockKey = `${context.membership.organizationId}:${parsed.data.membershipId}:onboarding`;
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const sequences = await sql<Array<{ next_cycle: number }>>`
        select coalesce(max(cycle_number), 0)::integer + 1 as next_cycle
        from public.hr_onboarding_plans
        where organization_id = ${context.membership.organizationId}::uuid
          and membership_id = ${parsed.data.membershipId}::uuid
      `;
      const cycleNumber = sequences[0]?.next_cycle ?? 1;
      const rows = await sql<Array<{ id: string }>>`
        insert into public.hr_onboarding_plans (
          organization_id, membership_id, cycle_number, target_start_date, first_day_meeting_at,
          first_day_meeting_details, probation_review_date, notes,
          created_by_membership_id, updated_by_membership_id
        ) values (
          ${context.membership.organizationId}::uuid, ${parsed.data.membershipId}::uuid,
          ${cycleNumber}, ${parsed.data.targetStartDate}::date,
          ${parsed.data.firstDayMeetingAt}::timestamptz,
          ${parsed.data.firstDayMeetingDetails}, ${parsed.data.probationReviewDate}::date,
          ${parsed.data.notes}, ${context.membership.id}::uuid, ${context.membership.id}::uuid
        )
        returning id
      `;
      const planId = rows[0]?.id;
      if (!planId) throw new HrActionError("Onboarding plan creation returned no record.");
      await synchronizeHrOnboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: parsed.data.membershipId,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.onboarding_plan_created",
        entityType: "hr_onboarding_plan",
        entityId: planId,
        afterState: {
          targetMembershipId: parsed.data.membershipId,
          targetStartDate: parsed.data.targetStartDate,
          cycleNumber,
        },
      });
      return { id: planId, membershipId: parsed.data.membershipId, cycleNumber };
    });

    after(async () => {
      try {
        await enqueueNotification({
          organizationId: context.membership.organizationId,
          recipientMembershipId: plan.membershipId,
          category: "assignment",
          title: "Your onboarding plan is ready",
          message: `Your onboarding checklist is available for the ${parsed.data.targetStartDate} start date.`,
          deepLink: "/hr",
          sourceModule: "hr",
          sourceEntityType: "hr_onboarding_plan",
          sourceEntityId: plan.id,
          dedupeKey: `hr-onboarding-plan-${plan.id}`,
          createdByMembershipId: context.membership.id,
        });
      } catch {
        // Notification delivery is non-critical; the onboarding transaction is already committed.
      }
    });
    revalidatePath("/hr");
    return { status: "success", message: "Onboarding plan created." };
  } catch (error) {
    if (isUniqueViolation(error))
      return stateError("This employee already has an active onboarding plan.");
    return stateError(
      error instanceof HrActionError ? error.message : "Onboarding plan could not be created.",
    );
  }
}

export async function updateHrOnboardingScheduleAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = updateHrOnboardingScheduleSchema.safeParse({
    ...planInput(formData),
    planId: text(formData, "planId"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the onboarding schedule and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOnboardingManage();
  if (!context) return stateError("You cannot update onboarding plans.");

  try {
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const targets = await sql<Array<{ membership_id: string }>>`
        select plan.membership_id
        from public.hr_onboarding_plans as plan
        where plan.id = ${parsed.data.planId}::uuid
          and plan.organization_id = ${context.membership.organizationId}::uuid
          and plan.status <> 'cancelled'
        limit 1 for update
      `;
      const target = targets[0];
      if (!target) throw new HrActionError("Active onboarding plan not found.");
      await requireManagedOnboardingEmployee(context, target.membership_id);
      await sql`
        update public.hr_onboarding_plans
        set target_start_date = ${parsed.data.targetStartDate}::date,
          first_day_meeting_at = ${parsed.data.firstDayMeetingAt}::timestamptz,
          first_day_meeting_details = ${parsed.data.firstDayMeetingDetails},
          probation_review_date = ${parsed.data.probationReviewDate}::date,
          notes = ${parsed.data.notes},
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await synchronizeHrOnboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: target.membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.onboarding_schedule_updated",
        entityType: "hr_onboarding_plan",
        entityId: parsed.data.planId,
        changedFields: [
          "target_start_date",
          "first_day_meeting_at",
          "first_day_meeting_details",
          "probation_review_date",
          "notes",
        ],
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Onboarding schedule updated." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Onboarding schedule could not be updated.",
    );
  }
}

export async function updateHrOnboardingItemAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = updateHrOnboardingItemSchema.safeParse({
    itemId: text(formData, "itemId"),
    status: text(formData, "status"),
    assignedMembershipId: text(formData, "assignedMembershipId"),
    dueDate: text(formData, "dueDate"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) {
    return stateError(
      "Check the onboarding item and try again.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await authorizeOnboardingManage();
  if (!context) return stateError("You cannot update onboarding checklist items.");

  try {
    const database = getDatabaseClient();
    const result = await database.begin(async (sql) => {
      const rows = await sql<
        Array<{
          plan_id: string;
          membership_id: string;
          item_key: (typeof hrOnboardingItemDefinitions)[number]["key"];
          assigned_membership_id: string | null;
          status: string;
          completion_source: string | null;
          completed_at: string | null;
          completed_by_membership_id: string | null;
        }>
      >`
        select plan.id as plan_id, plan.membership_id, item.item_key, item.assigned_membership_id,
          item.status, item.completion_source, item.completed_at::text,
          item.completed_by_membership_id
        from public.hr_onboarding_items as item
        join public.hr_onboarding_plans as plan on plan.id = item.onboarding_plan_id
        where item.id = ${parsed.data.itemId}::uuid
          and plan.organization_id = ${context.membership.organizationId}::uuid
          and plan.status <> 'cancelled'
        limit 1 for update of item
      `;
      const item = rows[0];
      if (!item) throw new HrActionError("Active onboarding checklist item not found.");
      await requireManagedOnboardingEmployee(context, item.membership_id);
      if (
        derivedItemKeys.has(item.item_key) &&
        parsed.data.status !== item.status &&
        (parsed.data.status === "complete" || parsed.data.status === "not_applicable")
      ) {
        throw new HrActionError("This item completes automatically from its source record.");
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
          throw new HrActionError("Choose an active organization member as assignee.");
      }
      const terminal = parsed.data.status === "complete" || parsed.data.status === "not_applicable";
      const statusChanged = parsed.data.status !== item.status;
      await sql`
        update public.hr_onboarding_items
        set status = ${parsed.data.status},
          assigned_membership_id = ${parsed.data.assignedMembershipId}::uuid,
          due_date = ${parsed.data.dueDate}::date,
          notes = ${parsed.data.notes},
          completion_source = case
            when not ${terminal} then null
            when ${statusChanged} then 'manual'
            else completion_source
          end,
          completed_at = case
            when not ${terminal} then null
            when ${statusChanged} then now()
            else completed_at
          end,
          completed_by_membership_id = case
            when not ${terminal} then null
            when ${statusChanged} then ${context.membership.id}::uuid
            else completed_by_membership_id
          end,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.itemId}::uuid
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.onboarding_item_updated",
        entityType: "hr_onboarding_item",
        entityId: parsed.data.itemId,
        afterState: {
          status: parsed.data.status,
          assignedMembershipId: parsed.data.assignedMembershipId,
          dueDate: parsed.data.dueDate,
        },
        metadata: { onboardingPlanId: item.plan_id, targetMembershipId: item.membership_id },
      });
      return {
        assignedMembershipId: parsed.data.assignedMembershipId,
        assignmentChanged: parsed.data.assignedMembershipId !== item.assigned_membership_id,
        planId: item.plan_id,
      };
    });

    if (result.assignedMembershipId && result.assignmentChanged) {
      after(async () => {
        try {
          await enqueueNotification({
            organizationId: context.membership.organizationId,
            recipientMembershipId: result.assignedMembershipId!,
            category: "assignment",
            title: "Onboarding checklist assignment",
            message: "An employee onboarding checklist item has been assigned to you.",
            deepLink: "/hr",
            sourceModule: "hr",
            sourceEntityType: "hr_onboarding_plan",
            sourceEntityId: result.planId,
            dedupeKey: `hr-onboarding-assignment-${parsed.data.itemId}`,
            createdByMembershipId: context.membership.id,
          });
        } catch {
          // Notification delivery is non-critical; the checklist assignment remains authoritative.
        }
      });
    }
    revalidatePath("/hr");
    return { status: "success", message: "Onboarding item updated." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Onboarding item could not be updated.",
    );
  }
}

export async function completeHrOnboardingOwnItemAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = completeHrOnboardingOwnItemSchema.safeParse({
    itemId: text(formData, "itemId"),
  });
  if (!parsed.success) return stateError("Onboarding acknowledgement is invalid.");
  const authorization = await authorizeCurrentUser([
    hrPermissionKeys.workspace,
    hrPermissionKeys.onboardingUpdateOwn,
  ]);
  if (!authorization.allowed) return stateError("You cannot complete this onboarding item.");
  const { context } = authorization;
  try {
    const database = getDatabaseClient();
    const updated = await database.begin(async (sql) => {
      const rows = await sql<Array<{ id: string; plan_id: string; item_key: string }>>`
        update public.hr_onboarding_items as item
        set status = 'complete', completion_source = 'employee', completed_at = now(),
          completed_by_membership_id = ${context.membership.id}::uuid,
          updated_by_membership_id = ${context.membership.id}::uuid
        from public.hr_onboarding_plans as plan
        where item.id = ${parsed.data.itemId}::uuid
          and item.onboarding_plan_id = plan.id
          and item.item_key in ('offer_accepted', 'policies_acknowledged')
          and plan.organization_id = ${context.membership.organizationId}::uuid
          and plan.membership_id = ${context.membership.id}::uuid
          and plan.status <> 'cancelled'
          and item.status <> 'complete'
        returning item.id, plan.id as plan_id, item.item_key
      `;
      if (!rows[0])
        throw new HrActionError(
          "This onboarding acknowledgement is unavailable or already complete.",
        );
      await writeAuditEvent(sql, context, {
        action:
          rows[0].item_key === "offer_accepted"
            ? "hr.onboarding_offer_accepted"
            : "hr.onboarding_policies_acknowledged",
        entityType: "hr_onboarding_item",
        entityId: rows[0].id,
        metadata: { onboardingPlanId: rows[0].plan_id, itemKey: rows[0].item_key },
      });
      return rows[0];
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message:
        updated.item_key === "offer_accepted"
          ? "Offer acceptance recorded."
          : "Policies acknowledged.",
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "Onboarding acknowledgement could not be recorded.",
    );
  }
}

export async function refreshHrOnboardingEvidenceAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = hrOnboardingPlanIdSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Onboarding plan is invalid.");
  const context = await authorizeOnboardingManage();
  if (!context) return stateError("You cannot refresh onboarding evidence.");
  try {
    const database = getDatabaseClient();
    const count = await database.begin(async (sql) => {
      const rows = await sql<Array<{ membership_id: string }>>`
        select membership_id from public.hr_onboarding_plans
        where id = ${parsed.data.planId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
        limit 1 for update
      `;
      if (!rows[0]) throw new HrActionError("Onboarding plan not found.");
      await requireManagedOnboardingEmployee(context, rows[0].membership_id);
      const updated = await synchronizeHrOnboardingEvidence(sql, {
        organizationId: context.membership.organizationId,
        membershipId: rows[0].membership_id,
        actorMembershipId: context.membership.id,
      });
      await writeAuditEvent(sql, context, {
        action: "hr.onboarding_evidence_refreshed",
        entityType: "hr_onboarding_plan",
        entityId: parsed.data.planId,
        afterState: { completedDerivedItems: updated },
      });
      return updated;
    });
    revalidatePath("/hr");
    return {
      status: "success",
      message: `${count} evidence-backed item${count === 1 ? "" : "s"} completed.`,
    };
  } catch (error) {
    return stateError(
      error instanceof HrActionError
        ? error.message
        : "Onboarding evidence could not be refreshed.",
    );
  }
}

export async function cancelHrOnboardingPlanAction(
  _previous: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const parsed = cancelHrOnboardingPlanSchema.safeParse({ planId: text(formData, "planId") });
  if (!parsed.success) return stateError("Onboarding plan is invalid.");
  const context = await authorizeOnboardingManage();
  if (!context) return stateError("You cannot cancel onboarding plans.");
  try {
    const database = getDatabaseClient();
    await database.begin(async (sql) => {
      const rows = await sql<Array<{ membership_id: string }>>`
        select membership_id from public.hr_onboarding_plans
        where id = ${parsed.data.planId}::uuid
          and organization_id = ${context.membership.organizationId}::uuid
          and status not in ('completed', 'cancelled')
        limit 1 for update
      `;
      if (!rows[0]) throw new HrActionError("Only an active incomplete plan can be cancelled.");
      await requireManagedOnboardingEmployee(context, rows[0].membership_id);
      await sql`
        update public.hr_onboarding_plans
        set status = 'cancelled', cancelled_at = now(), completed_at = null,
          updated_by_membership_id = ${context.membership.id}::uuid
        where id = ${parsed.data.planId}::uuid
      `;
      await writeAuditEvent(sql, context, {
        action: "hr.onboarding_plan_cancelled",
        entityType: "hr_onboarding_plan",
        entityId: parsed.data.planId,
        metadata: { targetMembershipId: rows[0].membership_id },
      });
    });
    revalidatePath("/hr");
    return { status: "success", message: "Onboarding plan cancelled." };
  } catch (error) {
    return stateError(
      error instanceof HrActionError ? error.message : "Onboarding plan could not be cancelled.",
    );
  }
}
